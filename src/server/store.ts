// Persistence operations shared by routes, import, seed and the job runner.
import type pg from 'pg';
import { z } from 'zod';
import { HttpError, type User } from './auth';
import { one, q, type Db } from './db';
import { newId, validateModel, type Layout, type Model } from '../shared/model';
import { importSchema, linkSchema, noteSchema, insightSchema, opportunitySchema, optionSchema, sourceSchema, WORKSPACE_FORMAT, WORKSPACE_SCHEMA_VERSION, type Bundle, type ProjectMeta } from '../shared/workspace';

export interface BranchRow { id: string; kind: 'baseline' | 'scenario'; name: string; hypothesis: string; parentBranchId: string | null; baseRevisionId: string | null; headRevisionId: string; layout: Layout; layoutVersion: number; origin: { type: string; id: string | null } | null; status: string; createdAt: string }
export interface RevisionRow { id: string; branchId: string; parentRevisionId: string | null; seq: number; summary: string; author: string; createdAt: string; restoredFrom: string | null; model: Model }

const BRANCH_COLS = `id, kind, name, hypothesis, parent_branch_id AS "parentBranchId", base_revision_id AS "baseRevisionId", head_revision_id AS "headRevisionId", layout, layout_version AS "layoutVersion", origin, status, created_at AS "createdAt"`;
const REV_COLS = `id, branch_id AS "branchId", parent_revision_id AS "parentRevisionId", seq, summary, author, created_at AS "createdAt", restored_from AS "restoredFrom"`;

export const getBranches = (db: Db, pid: string) => q<BranchRow>(db, `SELECT ${BRANCH_COLS} FROM branches WHERE project_id = $1 ORDER BY (kind = 'baseline') DESC, created_at, id`, [pid]);
export async function getBranch(db: Db, pid: string, bid: string, forUpdate = false): Promise<BranchRow> {
  const b = await one<BranchRow>(db, `SELECT ${BRANCH_COLS} FROM branches WHERE project_id = $1 AND id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`, [pid, bid]);
  if (!b) throw new HttpError(404, 'That map or scenario no longer exists.');
  return b;
}
export async function getRevision(db: Db, pid: string, rid: string): Promise<RevisionRow> {
  const r = await one<RevisionRow>(db, `SELECT ${REV_COLS}, model FROM revisions WHERE project_id = $1 AND id = $2`, [pid, rid]);
  if (!r) throw new HttpError(404, 'Revision not found.');
  return r;
}
export const listRevisions = (db: Db, pid: string, bid: string) =>
  q<Omit<RevisionRow, 'model'>>(db, `SELECT ${REV_COLS} FROM revisions WHERE project_id = $1 AND branch_id = $2 ORDER BY seq DESC LIMIT 200`, [pid, bid]);

export async function audit(db: Db, pid: string, user: User | null, action: string, entity = '', entityId = '', detail: Record<string, unknown> = {}) {
  await db.query('INSERT INTO audit_log (project_id, user_id, actor, action, entity, entity_id, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)', [pid, user?.id ?? null, user?.name ?? 'system', action, entity, entityId, JSON.stringify(detail)]);
}
const touch = (db: Db, pid: string) => db.query('UPDATE projects SET updated_at = now() WHERE id = $1', [pid]);

/** Appends an immutable revision and moves the head, only if the caller saw the current head. */
export async function saveModel(c: pg.PoolClient, pid: string, bid: string, user: User | null, expectedRevisionId: string | null, input: unknown, summary: string, restoredFrom: string | null = null) {
  const branch = await getBranch(c, pid, bid, true);
  if (expectedRevisionId !== null && branch.headRevisionId !== expectedRevisionId) {
    const current = await getRevision(c, pid, branch.headRevisionId);
    throw new HttpError(409, 'Someone else saved a newer version of this map.', { conflict: true, current: { revision: current, layout: branch.layout, layoutVersion: branch.layoutVersion } });
  }
  const v = validateModel(input);
  if (!v.model) throw new HttpError(422, 'The model is not valid, so nothing was saved.', { issues: v.issues });
  const [{ next }] = await q<{ next: number }>(c, 'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM revisions WHERE project_id = $1 AND branch_id = $2', [pid, bid]);
  const id = newId('rev');
  await c.query('INSERT INTO revisions (project_id, id, branch_id, parent_revision_id, seq, summary, model, restored_from, author, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [pid, id, bid, branch.headRevisionId, next, summary.slice(0, 500), JSON.stringify(v.model), restoredFrom, user?.name ?? 'system', user?.id ?? null]);
  await c.query('UPDATE branches SET head_revision_id = $3 WHERE project_id = $1 AND id = $2', [pid, bid, id]);
  await touch(c, pid);
  return getRevision(c, pid, id);
}

export async function createBranch(c: pg.PoolClient, pid: string, user: User | null, opts: { name: string; hypothesis?: string; fromBranchId: string; fromRevisionId?: string | null; origin?: BranchRow['origin'] }) {
  const from = await getBranch(c, pid, opts.fromBranchId);
  const baseRev = await getRevision(c, pid, opts.fromRevisionId ?? from.headRevisionId);
  if (baseRev.branchId !== from.id) throw new HttpError(422, 'That revision does not belong to the chosen starting point.');
  const taken = (await q<{ id: string }>(c, 'SELECT id FROM branches WHERE project_id = $1', [pid])).map((r) => r.id);
  const id = newId('sc', taken), revId = newId('rev');
  await c.query(`INSERT INTO branches (project_id, id, kind, name, hypothesis, parent_branch_id, base_revision_id, head_revision_id, layout, origin, created_by) VALUES ($1,$2,'scenario',$3,$4,$5,$6,$7,$8,$9,$10)`,
    [pid, id, opts.name.slice(0, 200), opts.hypothesis ?? '', from.kind === 'scenario' ? from.id : null, baseRev.id, revId, JSON.stringify(from.layout), opts.origin ? JSON.stringify(opts.origin) : null, user?.id ?? null]);
  await c.query('INSERT INTO revisions (project_id, id, branch_id, parent_revision_id, seq, summary, model, author, created_by) VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8)',
    [pid, revId, id, baseRev.id, `Branched from ${from.name} (revision ${baseRev.seq})`, JSON.stringify(baseRev.model), user?.name ?? 'system', user?.id ?? null]);
  await audit(c, pid, user, 'scenario.create', 'branch', id, { from: from.id, baseRevisionId: baseRev.id });
  return getBranch(c, pid, id);
}

// ---- evidence and decision collections -------------------------------------------------------------
export const COLLECTIONS = {
  sources: { schema: sourceSchema, prefix: 'src' }, notes: { schema: noteSchema, prefix: 't' }, insights: { schema: insightSchema, prefix: 'in' },
  links: { schema: linkSchema, prefix: 'l' }, opportunities: { schema: opportunitySchema, prefix: 'op' }, options: { schema: optionSchema, prefix: 'o' },
  imports: { schema: importSchema, prefix: 'im' },
} as const;
export type CollectionName = keyof typeof COLLECTIONS;
export const isCollection = (s: string): s is CollectionName => s in COLLECTIONS;

export async function listCollection<T = any>(db: Db, pid: string, name: CollectionName): Promise<(T & { version: number })[]> {
  const rows = await q<{ data: T; version: number }>(db, `SELECT data, version FROM ${name} WHERE project_id = $1 ORDER BY ord`, [pid]);
  return rows.map((r) => ({ ...r.data, version: r.version }));
}
const exists = async (db: Db, pid: string, table: string, id: string) => !!(await one(db, `SELECT 1 FROM ${table} WHERE project_id = $1 AND id = $2`, [pid, id]));

/** Cross-record reference checks. Everything is looked up inside the same project, so foreign IDs can never attach. */
async function checkRefs(db: Db, pid: string, name: CollectionName, d: any) {
  const need = async (table: string, id: string | null | undefined, what: string) => { if (id && !(await exists(db, pid, table, id))) throw new HttpError(422, `${what} “${id}” does not exist in this project.`); };
  if (name === 'notes') {
    await need('sources', d.sourceId, 'Source');
    if (d.targetId) {
      const bid = d.anchorBranchId ?? (await one<{ id: string }>(db, `SELECT id FROM branches WHERE project_id = $1 AND kind = 'baseline'`, [pid]))!.id;
      const b = await getBranch(db, pid, bid);
      const rev = await getRevision(db, pid, d.anchorRevisionId ?? b.headRevisionId);
      const m = rev.model;
      if (![...m.nodes, ...m.edges, ...m.activities].some((x) => x.id === d.targetId)) throw new HttpError(422, `“${d.targetId}” is not on the map this note is anchored to.`);
      d.anchorBranchId = b.id; d.anchorRevisionId = rev.id;
    } else { d.anchorBranchId = null; d.anchorRevisionId = null; }
  }
  if (name === 'links') {
    await need(d.fromType === 'note' ? 'notes' : 'insights', d.fromId, 'Record');
    await need(d.toType === 'note' ? 'notes' : 'insights', d.toId, 'Record');
    if (d.fromType === d.toType && d.fromId === d.toId) throw new HttpError(422, 'A record cannot link to itself.');
  }
  if (name === 'opportunities') {
    for (const id of d.insightIds) await need('insights', id, 'Insight');
    for (const id of d.noteIds) await need('notes', id, 'Note');
    await need('options', d.recommendedOptionId, 'Option');
  }
  if (name === 'options') { await need('opportunities', d.opportunityId, 'Opportunity'); await need('branches', d.scenarioBranchId, 'Scenario'); }
}

export async function upsertDoc(c: pg.PoolClient, pid: string, user: User | null, name: CollectionName, input: Record<string, unknown>, opts: { id?: string; expectedVersion?: number } = {}) {
  const { schema, prefix } = COLLECTIONS[name];
  const now = new Date().toISOString();
  const existing = opts.id ? await one<{ data: any; version: number }>(c, `SELECT data, version FROM ${name} WHERE project_id = $1 AND id = $2 FOR UPDATE`, [pid, opts.id]) : null;
  if (opts.id && !existing) throw new HttpError(404, 'That record no longer exists.');
  if (existing && opts.expectedVersion !== undefined && opts.expectedVersion !== existing.version) {
    throw new HttpError(409, 'This record was changed in another session.', { conflict: true, current: { ...existing.data, version: existing.version } });
  }
  const { version: _v, ...clean } = input as any;
  const merged = existing ? { ...existing.data, ...clean, id: opts.id, updatedAt: now } : { createdAt: now, updatedAt: now, ...clean, id: (clean.id as string) ?? newId(prefix) };
  if (name === 'notes' && !existing && !merged.rawText) merged.rawText = merged.text; // keep the note as first captured
  if (name === 'notes' && existing) merged.rawText = existing.data.rawText || existing.data.text;
  const parsed = (schema as z.ZodTypeAny).safeParse(merged);
  if (!parsed.success) throw new HttpError(422, 'Some fields are not valid.', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  const data = parsed.data;
  await checkRefs(c, pid, name, data);
  if (existing) await c.query(`UPDATE ${name} SET data = $3, version = version + 1, updated_at = now() WHERE project_id = $1 AND id = $2`, [pid, data.id, JSON.stringify(data)]);
  else {
    if (await exists(c, pid, name, data.id)) throw new HttpError(409, `ID “${data.id}” is already in use.`);
    await c.query(`INSERT INTO ${name} (project_id, id, data, created_by) VALUES ($1, $2, $3, $4)`, [pid, data.id, JSON.stringify(data), user?.id ?? null]);
  }
  await touch(c, pid);
  return { ...data, version: (existing?.version ?? 0) + 1 };
}

export async function deleteDoc(c: pg.PoolClient, pid: string, name: CollectionName, id: string) {
  const r = await c.query(`DELETE FROM ${name} WHERE project_id = $1 AND id = $2`, [pid, id]);
  if (!r.rowCount) throw new HttpError(404, 'That record no longer exists.');
  // Detach dependents; raw notes are never deleted as a side effect.
  if (name === 'notes' || name === 'insights') {
    const type = name === 'notes' ? 'note' : 'insight';
    await c.query(`DELETE FROM links WHERE project_id = $1 AND ((data->>'fromType' = $2 AND data->>'fromId' = $3) OR (data->>'toType' = $2 AND data->>'toId' = $3))`, [pid, type, id]);
    const key = name === 'notes' ? 'noteIds' : 'insightIds';
    await c.query(`UPDATE opportunities SET data = jsonb_set(data, '{${key}}', COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(data->'${key}') x WHERE x <> to_jsonb($2::text)), '[]'::jsonb)), version = version + 1 WHERE project_id = $1 AND data->'${key}' ? $2`, [pid, id]);
  }
  if (name === 'sources') await c.query(`UPDATE notes SET data = jsonb_set(data, '{sourceId}', 'null'), version = version + 1 WHERE project_id = $1 AND data->>'sourceId' = $2`, [pid, id]);
  if (name === 'opportunities') await c.query(`DELETE FROM options WHERE project_id = $1 AND data->>'opportunityId' = $2`, [pid, id]);
  if (name === 'options') await c.query(`UPDATE opportunities SET data = jsonb_set(data, '{recommendedOptionId}', 'null'), version = version + 1 WHERE project_id = $1 AND data->>'recommendedOptionId' = $2`, [pid, id]);
  await touch(c, pid);
}

// ---- whole-project import / export -----------------------------------------------------------------
export async function writeBundle(c: pg.PoolClient, pid: string, user: User | null, b: Bundle) {
  for (const br of b.branches) {
    await c.query(`INSERT INTO branches (project_id, id, kind, name, hypothesis, parent_branch_id, base_revision_id, head_revision_id, layout, origin, status, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13::timestamptz, now()))`,
      [pid, br.id, br.kind, br.name, br.hypothesis, br.parentBranchId, br.baseRevisionId, br.headRevisionId, JSON.stringify(br.layout), br.origin ? JSON.stringify(br.origin) : null, br.status, user?.id ?? null, br.createdAt || null]);
  }
  for (const r of b.revisions) {
    await c.query(`INSERT INTO revisions (project_id, id, branch_id, parent_revision_id, seq, summary, model, restored_from, author, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11::timestamptz, now()))`,
      [pid, r.id, r.branchId, r.parentRevisionId, r.seq, r.summary, JSON.stringify(r.model), r.restoredFrom, r.author || 'import', user?.id ?? null, r.createdAt || null]);
  }
  const docs: [CollectionName, { id: string }[]][] = [['sources', b.sources], ['imports', b.imports], ['notes', b.notes], ['insights', b.insights], ['links', b.links], ['opportunities', b.opportunities], ['options', b.options]];
  for (const [name, list] of docs) for (const d of list) await c.query(`INSERT INTO ${name} (project_id, id, data, created_by) VALUES ($1, $2, $3, $4)`, [pid, d.id, JSON.stringify(d), user?.id ?? null]);
  for (const r of b.runs) {
    // Imported runs are history only; anything unfinished is recorded as cancelled so it is never executed here.
    const status = r.status === 'queued' || r.status === 'running' ? 'cancelled' : r.status;
    await c.query(`INSERT INTO research_runs (project_id, id, mode, status, question, provider, input, result, error, created_at, finished_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10::timestamptz, now()), $11::timestamptz)`,
      [pid, r.id, r.mode, status, r.question, r.provider, JSON.stringify(r.input), r.result ? JSON.stringify(r.result) : null, r.error, r.createdAt || null, r.finishedAt || null]);
  }
  const { candidateFingerprint } = await import('../shared/candidates');
  for (const cd of b.candidates) {
    await c.query(`INSERT INTO candidates (project_id, id, run_id, origin, schema_version, payload, original_payload, fingerprint, status, base_revision_id, duplicate_of, reviewer, reviewed_at, review_note, applied) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13,$14)`,
      [pid, cd.id, cd.runId, cd.origin, cd.schemaVersion, JSON.stringify(cd.payload), candidateFingerprint(cd.payload as any), cd.status, cd.baseRevisionId, cd.duplicateOf, cd.reviewer, cd.reviewedAt || null, cd.reviewNote, cd.applied ? JSON.stringify(cd.applied) : null]);
  }
}

export async function createProject(c: pg.PoolClient, user: User, meta: ProjectMeta, opts: { synthetic?: boolean } = {}): Promise<string> {
  const org = await one<{ org_id: string }>(c, 'SELECT org_id FROM org_members WHERE user_id = $1 ORDER BY role DESC LIMIT 1', [user.id]);
  if (!org) throw new HttpError(403, 'Your account has no organization.');
  const { name, status, ...rest } = meta;
  const [p] = await q<{ id: string }>(c, 'INSERT INTO projects (org_id, owner_id, name, status, meta, is_synthetic) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [org.org_id, user.id, name, status, JSON.stringify(rest), !!opts.synthetic]);
  await c.query(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`, [p.id, user.id]);
  return p.id;
}

export async function exportBundle(db: Db, pid: string): Promise<Bundle> {
  const p = await one<{ name: string; status: ProjectMeta['status']; meta: Omit<ProjectMeta, 'name' | 'status'> }>(db, 'SELECT name, status, meta FROM projects WHERE id = $1', [pid]);
  if (!p) throw new HttpError(404, 'Project not found.');
  const branches = await getBranches(db, pid);
  const revisions = await q<RevisionRow>(db, `SELECT ${REV_COLS}, model FROM revisions WHERE project_id = $1 ORDER BY branch_id, seq`, [pid]);
  const strip = <T>(xs: (T & { version: number })[]) => xs.map(({ version: _v, ...rest }) => rest as unknown as T);
  const runs = await q(db, `SELECT id, mode, status, question, provider, input, result, error, created_at AS "createdAt", COALESCE(finished_at::text, '') AS "finishedAt" FROM research_runs WHERE project_id = $1 ORDER BY ord`, [pid]);
  const candidates = await q(db, `SELECT id, run_id AS "runId", origin, schema_version AS "schemaVersion", payload, status, base_revision_id AS "baseRevisionId", duplicate_of AS "duplicateOf", reviewer, COALESCE(reviewed_at::text, '') AS "reviewedAt", review_note AS "reviewNote", applied FROM candidates WHERE project_id = $1 ORDER BY ord`, [pid]);
  return {
    format: WORKSPACE_FORMAT, schemaVersion: WORKSPACE_SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    project: { ...({ researchQuestion: '', orgUnit: '', scopeDescription: '', startLabel: '', intendedOutcome: '', externalInterfaces: '' } as Omit<ProjectMeta, 'name' | 'status'>), ...p.meta, name: p.name, status: p.status },
    branches: branches.map(({ layoutVersion: _lv, ...b }) => ({ ...b, origin: b.origin as any, status: b.status as any })),
    revisions, sources: strip(await listCollection(db, pid, 'sources')), notes: strip(await listCollection(db, pid, 'notes')), insights: strip(await listCollection(db, pid, 'insights')),
    links: strip(await listCollection(db, pid, 'links')), opportunities: strip(await listCollection(db, pid, 'opportunities')), options: strip(await listCollection(db, pid, 'options')),
    runs: runs as any, candidates: candidates as any, imports: strip(await listCollection(db, pid, 'imports')),
  };
}
