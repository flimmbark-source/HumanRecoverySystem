import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { HttpError, createUser, endSession, projectRole, requireUser, startSession, verifyPassword, type Env, type Role, type User } from './auth';
import { config } from './config';
import { one, pool, q, tx } from './db';
import { blankBundle, demoBundle } from './demo';
import { providerStatus } from './providers';
import { buildBrief } from './reports/brief';
import { briefPdf, mapPdf } from './reports/pdf';
import { opportunityCsv, opportunityXlsx } from './reports/sheet';
import { acceptCandidate, cancelRun, enqueueRun, importCandidates, listResearch, retryRun, reviewCandidate } from './research';
import { audit, createBranch, createProject, deleteDoc, exportBundle, getBranch, getBranches, getRevision, isCollection, listCollection, listRevisions, saveModel, upsertDoc, writeBundle, COLLECTIONS, type CollectionName } from './store';
import { parseImport } from '../shared/legacy';
import { layoutSchema } from '../shared/model';
import { projectMetaSchema } from '../shared/workspace';
import { IMPORT_KINDS, mapItems, splitOffline } from '../shared/fieldnotes';
import { proposalsFromOutput } from '../shared/fieldnotes-ai';
import { splitFieldNotes } from './providers/anthropic';

export const app = new Hono<Env>();
const api = new Hono<Env>();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, ...err.body }, err.status as 400);
  if (err instanceof SyntaxError) return c.json({ error: 'The request body is not valid JSON.' }, 400);
  console.error('[api] unexpected error:', err instanceof Error ? err.message : err); // message only; never request bodies
  return c.json({ error: 'Something went wrong on the server. Your draft is still in this browser; try again.' }, 500);
});

api.use('*', bodyLimit({ maxSize: config.maxBodyBytes, onError: (c) => c.json({ error: `That is larger than the ${Math.round(config.maxBodyBytes / 1000)} kB limit.` }, 413) }));
api.get('/health', async (c) => { await pool.query('SELECT 1'); return c.json({ ok: true }); });

const body = async <T extends z.ZodTypeAny>(c: { req: { json: () => Promise<unknown> } }, schema: T): Promise<z.infer<T>> => {
  const parsed = schema.safeParse(await c.req.json().catch(() => { throw new HttpError(400, 'The request body is not valid JSON.'); }));
  if (!parsed.success) throw new HttpError(422, 'Some fields are not valid.', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  return parsed.data;
};

// ---- auth ------------------------------------------------------------------------------------------
const credentials = z.object({ email: z.string().email().max(200), password: z.string().min(8).max(200), name: z.string().max(100).optional() });
api.post('/auth/signup', async (c) => {
  if (!config.allowSignup) throw new HttpError(403, 'Sign-up is closed. Ask a project owner for an account.');
  const b = await body(c, credentials);
  const user = await tx((db) => createUser(db, b.email, b.name ?? '', b.password));
  await startSession(c, user.id);
  return c.json({ user });
});
// Slows password guessing: after 8 failures for one email, sign-in for it pauses for 10 minutes. Per process, in memory.
const failures = new Map<string, { n: number; until: number }>();
api.post('/auth/login', async (c) => {
  const b = await body(c, credentials);
  const key = b.email.toLowerCase(), now = Date.now(), f = failures.get(key);
  if (f && f.n >= 8 && f.until > now) throw new HttpError(429, 'Too many failed sign-in attempts. Try again in a few minutes.');
  const row = await one<User & { password_hash: string }>(pool, 'SELECT id, email, name, password_hash FROM users WHERE lower(email) = lower($1)', [b.email]);
  if (!row || !(await verifyPassword(b.password, row.password_hash))) {
    failures.set(key, { n: (f && f.until > now ? f.n : 0) + 1, until: now + 600_000 });
    if (failures.size > 5000) for (const [k, v] of failures) if (v.until < now) failures.delete(k);
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  failures.delete(key);
  await startSession(c, row.id);
  return c.json({ user: { id: row.id, email: row.email, name: row.name } });
});
api.post('/auth/logout', async (c) => { await endSession(c); return c.json({ ok: true }); });

api.use('*', async (c, next) => (c.req.path.startsWith('/api/auth/') || c.req.path === '/api/health' ? next() : requireUser(c, next)));
api.get('/me', (c) => c.json({ user: c.get('user'), allowSignup: config.allowSignup }));

// ---- projects --------------------------------------------------------------------------------------
api.get('/projects', async (c) => {
  const rows = await q(pool, `SELECT p.id, p.name, p.status, p.meta, p.is_synthetic AS "isSynthetic", p.updated_at AS "updatedAt", m.role,
      (SELECT count(*)::int FROM notes n WHERE n.project_id = p.id) AS "noteCount", (SELECT count(*)::int FROM branches b WHERE b.project_id = p.id AND b.kind = 'scenario') AS "scenarioCount"
    FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id = $1 ORDER BY p.updated_at DESC`, [c.get('user').id]);
  return c.json({ projects: rows });
});

const newProject = projectMetaSchema.extend({ template: z.enum(['blank', 'demo']).default('blank'), outcomeLabel: z.string().max(140).default('') });
api.post('/projects', async (c) => {
  const user = c.get('user');
  const { template, outcomeLabel, ...meta } = await body(c, newProject);
  const id = await tx(async (db) => {
    const bundle = template === 'demo' ? demoBundle() : blankBundle(meta, meta.startLabel, outcomeLabel);
    if (template === 'demo' && meta.name.trim()) bundle.project.name = meta.name;
    const pid = await createProject(db, user, bundle.project, { synthetic: template === 'demo' });
    await writeBundle(db, pid, user, bundle);
    await audit(db, pid, user, 'project.create', 'project', pid, { template });
    return pid;
  });
  return c.json({ id });
});

const pid = (c: { req: { param: (k: string) => string | undefined } }) => c.req.param('pid')!;
const need = (c: any, min: Role = 'reader') => projectRole(pool, c.get('user').id, pid(c), min);

api.get('/projects/:pid', async (c) => {
  const role = await need(c);
  const p = await one(pool, `SELECT id, name, status, meta, is_synthetic AS "isSynthetic", updated_at AS "updatedAt" FROM projects WHERE id = $1`, [pid(c)]);
  const members = await q(pool, `SELECT u.id, u.name, u.email, m.role FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY m.role, u.name`, [pid(c)]);
  const view = await one<{ state: unknown }>(pool, 'SELECT state FROM view_state WHERE user_id = $1 AND project_id = $2', [c.get('user').id, pid(c)]);
  return c.json({ project: p, role, members, branches: await getBranches(pool, pid(c)), provider: providerStatus(), viewState: view?.state ?? {} });
});
api.patch('/projects/:pid', async (c) => {
  await need(c, 'editor');
  const b = await body(c, projectMetaSchema.partial());
  const { name, status, ...meta } = b;
  await pool.query(`UPDATE projects SET name = COALESCE($2, name), status = COALESCE($3, status), meta = meta || $4::jsonb, updated_at = now() WHERE id = $1`, [pid(c), name ?? null, status ?? null, JSON.stringify(meta)]);
  await audit(pool, pid(c), c.get('user'), 'project.update', 'project', pid(c));
  return c.json({ ok: true });
});
api.delete('/projects/:pid', async (c) => {
  await need(c, 'owner');
  await pool.query('DELETE FROM projects WHERE id = $1', [pid(c)]);
  return c.json({ ok: true });
});

api.post('/projects/:pid/members', async (c) => {
  await need(c, 'owner');
  const b = await body(c, z.object({ email: z.string().email(), role: z.enum(['owner', 'editor', 'reader']) }));
  const u = await one<{ id: string }>(pool, 'SELECT id FROM users WHERE lower(email) = lower($1)', [b.email]);
  if (!u) throw new HttpError(404, 'No account uses that email. Ask them to sign up first.');
  await pool.query(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [pid(c), u.id, b.role]);
  const owners = await one<{ n: number }>(pool, `SELECT count(*)::int AS n FROM project_members WHERE project_id = $1 AND role = 'owner'`, [pid(c)]);
  if (!owners?.n) { await pool.query(`UPDATE project_members SET role = 'owner' WHERE project_id = $1 AND user_id = $2`, [pid(c), u.id]); throw new HttpError(422, 'A project needs at least one owner.'); }
  await audit(pool, pid(c), c.get('user'), 'member.set', 'user', u.id, { role: b.role });
  return c.json({ ok: true });
});
api.delete('/projects/:pid/members/:uid', async (c) => {
  await need(c, 'owner');
  const others = await one<{ n: number }>(pool, `SELECT count(*)::int AS n FROM project_members WHERE project_id = $1 AND role = 'owner' AND user_id <> $2`, [pid(c), c.req.param('uid')]);
  if (!others?.n) throw new HttpError(422, 'A project needs at least one owner.');
  await pool.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [pid(c), c.req.param('uid')]);
  await audit(pool, pid(c), c.get('user'), 'member.remove', 'user', c.req.param('uid'));
  return c.json({ ok: true });
});

api.put('/projects/:pid/view-state', async (c) => {
  await need(c);
  const state = await body(c, z.record(z.unknown()));
  if (JSON.stringify(state).length > 20000) throw new HttpError(413, 'View state is too large.');
  await pool.query(`INSERT INTO view_state (user_id, project_id, state) VALUES ($1, $2, $3) ON CONFLICT (user_id, project_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`, [c.get('user').id, pid(c), JSON.stringify(state)]);
  return c.json({ ok: true });
});

// ---- maps, scenarios and revisions -----------------------------------------------------------------
api.get('/projects/:pid/branches/:bid', async (c) => {
  await need(c);
  const branch = await getBranch(pool, pid(c), c.req.param('bid'));
  const revision = await getRevision(pool, pid(c), branch.headRevisionId);
  // Lineage: the pinned comparison revision of this scenario, then of its parent, back to the original baseline.
  const lineage: { branchId: string; branchName: string; revisionId: string; seq: number; createdAt: string; relation: 'parent' | 'ancestor' | 'original baseline' }[] = [];
  let cur = branch, guard = 0;
  while (cur.baseRevisionId && guard++ < 50) {
    const rev = await getRevision(pool, pid(c), cur.baseRevisionId);
    const owner = await getBranch(pool, pid(c), rev.branchId);
    lineage.push({ branchId: owner.id, branchName: owner.name, revisionId: rev.id, seq: rev.seq, createdAt: rev.createdAt, relation: owner.kind === 'baseline' ? 'original baseline' : lineage.length ? 'ancestor' : 'parent' });
    cur = owner;
  }
  return c.json({ branch, revision, lineage });
});
api.get('/projects/:pid/revisions/:rid', async (c) => { await need(c); return c.json({ revision: await getRevision(pool, pid(c), c.req.param('rid')) }); });
api.get('/projects/:pid/branches/:bid/revisions', async (c) => { await need(c); await getBranch(pool, pid(c), c.req.param('bid')); return c.json({ revisions: await listRevisions(pool, pid(c), c.req.param('bid')) }); });

api.put('/projects/:pid/branches/:bid/model', async (c) => {
  await need(c, 'editor');
  const b = await body(c, z.object({ expectedRevisionId: z.string(), model: z.unknown(), summary: z.string().max(500).default('') }));
  const revision = await tx((db) => saveModel(db, pid(c), c.req.param('bid'), c.get('user'), b.expectedRevisionId, b.model, b.summary));
  return c.json({ revision });
});
api.put('/projects/:pid/branches/:bid/layout', async (c) => {
  await need(c, 'editor');
  const b = await body(c, z.object({ layout: layoutSchema }));
  const r = await pool.query('UPDATE branches SET layout = $3, layout_version = layout_version + 1 WHERE project_id = $1 AND id = $2 RETURNING layout_version', [pid(c), c.req.param('bid'), JSON.stringify(b.layout)]);
  if (!r.rowCount) throw new HttpError(404, 'That map or scenario no longer exists.');
  return c.json({ layoutVersion: r.rows[0].layout_version });
});
api.post('/projects/:pid/branches/:bid/restore', async (c) => {
  await need(c, 'editor');
  const b = await body(c, z.object({ revisionId: z.string(), expectedRevisionId: z.string() }));
  const revision = await tx(async (db) => {
    const old = await getRevision(db, pid(c), b.revisionId);
    if (old.branchId !== c.req.param('bid')) throw new HttpError(422, 'That revision belongs to a different map.');
    const rev = await saveModel(db, pid(c), old.branchId, c.get('user'), b.expectedRevisionId, old.model, `Restored revision ${old.seq}`, old.id);
    await audit(db, pid(c), c.get('user'), 'revision.restore', 'revision', rev.id, { from: old.id });
    return rev;
  });
  return c.json({ revision });
});
api.post('/projects/:pid/branches', async (c) => {
  await need(c, 'editor');
  const b = await body(c, z.object({ name: z.string().min(1).max(200), hypothesis: z.string().max(4000).default(''), fromBranchId: z.string(), fromRevisionId: z.string().nullable().optional(), origin: z.object({ type: z.enum(['insight', 'opportunity', 'option', 'blank']), id: z.string().nullable() }).nullable().optional() }));
  const branch = await tx((db) => createBranch(db, pid(c), c.get('user'), b));
  return c.json({ branch });
});
api.patch('/projects/:pid/branches/:bid', async (c) => {
  await need(c, 'editor');
  const b = await body(c, z.object({ name: z.string().min(1).max(200).optional(), hypothesis: z.string().max(4000).optional(), status: z.enum(['draft', 'in_review', 'reviewed']).optional() }));
  const r = await pool.query('UPDATE branches SET name = COALESCE($3, name), hypothesis = COALESCE($4, hypothesis), status = COALESCE($5, status) WHERE project_id = $1 AND id = $2', [pid(c), c.req.param('bid'), b.name ?? null, b.hypothesis ?? null, b.status ?? null]);
  if (!r.rowCount) throw new HttpError(404, 'That scenario no longer exists.');
  if (b.status) await audit(pool, pid(c), c.get('user'), 'scenario.status', 'branch', c.req.param('bid'), { status: b.status });
  return c.json({ ok: true });
});
api.delete('/projects/:pid/branches/:bid', async (c) => {
  await need(c, 'editor');
  await tx(async (db) => {
    const br = await getBranch(db, pid(c), c.req.param('bid'));
    if (br.kind === 'baseline') throw new HttpError(422, 'The baseline cannot be deleted.');
    const child = await one(db, `SELECT 1 FROM branches WHERE project_id = $1 AND (parent_branch_id = $2 OR base_revision_id IN (SELECT id FROM revisions WHERE project_id = $1 AND branch_id = $2))`, [pid(c), br.id]);
    if (child) throw new HttpError(409, 'Another scenario was branched from this one. Delete that scenario first.');
    await db.query(`UPDATE options SET data = jsonb_set(data, '{scenarioBranchId}', 'null') WHERE project_id = $1 AND data->>'scenarioBranchId' = $2`, [pid(c), br.id]);
    await db.query('DELETE FROM branches WHERE project_id = $1 AND id = $2', [pid(c), br.id]);
    await audit(db, pid(c), c.get('user'), 'scenario.delete', 'branch', br.id, { name: br.name });
  });
  return c.json({ ok: true });
});

// ---- field notes import -----------------------------------------------------------------------------
// The client splits on the phone without a network; these routes split with Claude and save a reviewed import.
const modelFor = async (c: any, branchId: string | undefined) => { const b = await getBranch(pool, pid(c), branchId || 'baseline'); return { branch: b, model: (await getRevision(pool, pid(c), b.headRevisionId)).model }; };
api.post('/projects/:pid/fieldnotes/split', async (c) => {
  await need(c, 'editor');
  const { text, branchId } = await body(c, z.object({ text: z.string().trim().min(1).max(400_000), branchId: z.string().max(64).optional() }));
  const { model } = await modelFor(c, branchId);
  const items = mapItems(model);
  if (config.provider === 'fixture') return c.json({ method: 'fixture', proposals: splitOffline(text, model).map((p) => ({ ...p, why: 'Test splitter. No AI was used.' })) });
  const key = config.userKeys ? c.req.header('x-claude-key')?.trim() : undefined;
  if (config.provider !== 'anthropic' && !key) throw new HttpError(409, config.userKeys ? 'Add your Claude API key in Project settings to split with Claude.' : 'Claude is not set up on this server.');
  try {
    const out = await splitFieldNotes({ text, items }, { apiKey: key });
    return c.json({ method: 'claude', proposals: proposalsFromOutput(text, out, items) });
  } catch (e) { throw new HttpError(502, e instanceof Error ? e.message : 'Claude could not split these notes.'); }
});
const importedNote = z.object({
  text: z.string().trim().min(1).max(8000), excerpt: z.string().max(8000).default(''),
  kind: z.enum(IMPORT_KINDS), certainty: z.enum(['observed', 'reported', 'inferred']).nullable(),
  targetId: z.string().max(64).nullable(), sourceId: z.string().max(80).nullable(), category: z.string().max(100).default(''),
  start: z.number().int().min(-1), end: z.number().int().min(-1),
});
api.post('/projects/:pid/fieldnotes', async (c) => {
  await need(c, 'editor');
  const b = await body(c, z.object({
    name: z.string().trim().min(1).max(200), text: z.string().min(1).max(400_000), method: z.enum(['phone', 'claude', 'fixture']),
    branchId: z.string().max(64).optional(), sourceId: z.string().max(80).nullable().default(null),
    // Sources to create, referred to from notes as "new:<key>".
    newSources: z.array(z.object({ key: z.string().max(40), anonId: z.string().trim().min(1).max(200), type: z.string().max(40).default('interview'), participantRole: z.string().max(200).default('') })).max(50).default([]),
    notes: z.array(importedNote).min(1).max(1000),
  }));
  const { branch } = await modelFor(c, b.branchId);
  const user = c.get('user');
  const result = await tx(async (db) => {
    const created = new Map<string, string>();
    const sources = [];
    for (const s of b.newSources) { const d = await upsertDoc(db, pid(c), user, 'sources', { anonId: s.anonId, type: s.type, participantRole: s.participantRole, date: new Date().toISOString().slice(0, 10) }); created.set(`new:${s.key}`, d.id); sources.push(d); }
    const src = (id: string | null) => (id && id.startsWith('new:') ? created.get(id) ?? null : id);
    const imp = await upsertDoc(db, pid(c), user, 'imports', { name: b.name, text: b.text, sourceId: src(b.sourceId), method: b.method, noteCount: b.notes.length });
    const notes = [];
    for (const n of b.notes) {
      notes.push(await upsertDoc(db, pid(c), user, 'notes', {
        text: n.text, rawText: n.excerpt || n.text, kind: n.kind, certainty: n.certainty, sourceId: src(n.sourceId), targetId: n.targetId,
        anchorBranchId: n.targetId ? branch.id : null, group: b.name.slice(0, 200), category: n.category, origin: { importId: imp.id, start: n.start, end: n.end },
      }));
    }
    await audit(db, pid(c), user, 'fieldnotes.import', 'imports', imp.id, { notes: notes.length, method: b.method, placed: notes.filter((n) => n.targetId).length });
    return { import: imp, sources, notes };
  });
  return c.json(result);
});

// ---- evidence and decisions ------------------------------------------------------------------------
api.get('/projects/:pid/evidence', async (c) => {
  await need(c);
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(COLLECTIONS) as CollectionName[]) out[name] = await listCollection(pool, pid(c), name);
  return c.json(out);
});
const coll = (c: any): CollectionName => { const n = c.req.param('coll'); if (!isCollection(n)) throw new HttpError(404, 'Not found.'); return n; };
api.post('/projects/:pid/c/:coll', async (c) => {
  await need(c, 'editor');
  const name = coll(c);
  const input = await body(c, z.record(z.unknown()));
  const doc = await tx(async (db) => { const d = await upsertDoc(db, pid(c), c.get('user'), name, input); await audit(db, pid(c), c.get('user'), `${name}.create`, name, d.id, name === 'notes' ? { targeted: !!d.targetId, episode: !!d.episode } : {}); return d; });
  return c.json({ doc });
});
api.patch('/projects/:pid/c/:coll/:id', async (c) => {
  await need(c, 'editor');
  const name = coll(c);
  const { expectedVersion, ...input } = await body(c, z.record(z.unknown()));
  const doc = await tx(async (db) => { const d = await upsertDoc(db, pid(c), c.get('user'), name, input, { id: c.req.param('id'), expectedVersion: typeof expectedVersion === 'number' ? expectedVersion : undefined }); await audit(db, pid(c), c.get('user'), `${name}.update`, name, d.id); return d; });
  return c.json({ doc });
});
api.delete('/projects/:pid/c/:coll/:id', async (c) => {
  await need(c, 'editor');
  const name = coll(c);
  await tx(async (db) => { await deleteDoc(db, pid(c), name, c.req.param('id')); await audit(db, pid(c), c.get('user'), `${name}.delete`, name, c.req.param('id')); });
  return c.json({ ok: true });
});

// ---- research --------------------------------------------------------------------------------------
api.get('/projects/:pid/research', async (c) => { await need(c); return c.json(await listResearch(pool, pid(c))); });
api.post('/projects/:pid/research/runs', async (c) => {
  await need(c, 'editor');
  const b = await body(c, z.object({ mode: z.enum(['wide', 'deep']), question: z.string().max(4000), topics: z.array(z.string()).max(10).optional(), noteIds: z.array(z.string()).max(100).optional(), insightId: z.string().nullable().optional() }));
  return c.json(await enqueueRun(pid(c), c.get('user'), b));
});
api.post('/projects/:pid/research/runs/:id/cancel', async (c) => { await need(c, 'editor'); return c.json(await cancelRun(pid(c), c.get('user'), c.req.param('id'))); });
api.post('/projects/:pid/research/runs/:id/retry', async (c) => { await need(c, 'editor'); return c.json(await retryRun(pid(c), c.get('user'), c.req.param('id'))); });
api.post('/projects/:pid/candidates/import', async (c) => { await need(c, 'editor'); return c.json(await importCandidates(pid(c), c.get('user'), (await body(c, z.object({ bundle: z.unknown() }))).bundle)); });
api.patch('/projects/:pid/candidates/:id', async (c) => {
  await need(c, 'editor');
  return c.json(await reviewCandidate(pid(c), c.get('user'), c.req.param('id'), await body(c, z.object({ status: z.string().optional(), payload: z.unknown().optional(), reviewNote: z.string().max(2000).optional() }))));
});
api.post('/projects/:pid/candidates/:id/accept', async (c) => { await need(c, 'editor'); return c.json(await acceptCandidate(pid(c), c.get('user'), c.req.param('id'))); });

// ---- import / export -------------------------------------------------------------------------------
const summarize = (r: ReturnType<typeof parseImport>) => r.bundle ? {
  name: r.bundle.project.name, nodes: r.bundle.revisions.find((x) => x.id === r.bundle!.branches.find((b) => b.kind === 'baseline')!.headRevisionId)!.model.nodes.length,
  connections: r.bundle.revisions.find((x) => x.id === r.bundle!.branches.find((b) => b.kind === 'baseline')!.headRevisionId)!.model.edges.length,
  notes: r.bundle.notes.length, links: r.bundle.links.length, sources: r.bundle.sources.length, scenarios: r.bundle.branches.length - 1, revisions: r.bundle.revisions.length,
  insights: r.bundle.insights.length, opportunities: r.bundle.opportunities.length, candidates: r.bundle.candidates.length,
} : null;
api.post('/import/preview', async (c) => {
  const b = await body(c, z.object({ data: z.unknown() }));
  const r = parseImport(b.data);
  return c.json({ kind: r.kind, ok: !!r.bundle, issues: r.issues, decisions: r.decisions, summary: summarize(r) });
});
api.post('/import', async (c) => {
  const b = await body(c, z.object({ data: z.unknown(), name: z.string().max(200).optional() }));
  const r = parseImport(b.data);
  if (!r.bundle) throw new HttpError(422, 'This file cannot be imported. Nothing was changed.', { issues: r.issues });
  const user = c.get('user');
  const id = await tx(async (db) => {
    if (b.name?.trim()) r.bundle!.project.name = b.name.trim();
    const newPid = await createProject(db, user, r.bundle!.project, { synthetic: /synthetic|demo|illustrative/i.test(JSON.stringify(r.bundle!.project) + r.bundle!.sources.map((s) => s.anonId).join(' ')) });
    await writeBundle(db, newPid, user, r.bundle!);
    await audit(db, newPid, user, 'project.import', 'project', newPid, { kind: r.kind, decisions: r.decisions.length });
    return newPid;
  });
  return c.json({ id, decisions: r.decisions, summary: summarize(r) });
});
// Replacement is deliberate: owner only, the project name must be typed, and a restorable backup is written first.
api.post('/projects/:pid/replace', async (c) => {
  await need(c, 'owner');
  const b = await body(c, z.object({ data: z.unknown(), confirmName: z.string() }));
  const r = parseImport(b.data);
  if (!r.bundle) throw new HttpError(422, 'This file cannot be imported. Nothing was changed.', { issues: r.issues });
  const user = c.get('user');
  const backupId = await tx(async (db) => {
    const p = await one<{ name: string }>(db, 'SELECT name FROM projects WHERE id = $1 FOR UPDATE', [pid(c)]);
    if (p!.name !== b.confirmName) throw new HttpError(422, 'Type the current project name exactly to confirm replacement.');
    const [bk] = await q<{ id: string }>(db, 'INSERT INTO project_backups (project_id, reason, bundle, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [pid(c), 'before replace', JSON.stringify(await exportBundle(db, pid(c))), user.id]);
    for (const t of ['candidates', 'research_runs', 'options', 'opportunities', 'links', 'insights', 'notes', 'sources', 'revisions', 'branches']) await db.query(`DELETE FROM ${t} WHERE project_id = $1`, [pid(c)]);
    const { name, status, ...meta } = r.bundle!.project;
    await db.query('UPDATE projects SET name = $2, status = $3, meta = $4, updated_at = now() WHERE id = $1', [pid(c), name, status, JSON.stringify(meta)]);
    await writeBundle(db, pid(c), user, r.bundle!);
    await audit(db, pid(c), user, 'project.replace', 'project', pid(c), { backupId: bk.id });
    return bk.id;
  });
  return c.json({ ok: true, backupId, decisions: r.decisions });
});
api.get('/projects/:pid/backups', async (c) => { await need(c, 'owner'); return c.json({ backups: await q(pool, `SELECT id, reason, created_at AS "createdAt" FROM project_backups WHERE project_id = $1 ORDER BY created_at DESC`, [pid(c)]) }); });
api.get('/projects/:pid/backups/:id', async (c) => {
  await need(c, 'owner');
  const b = await one<{ bundle: unknown }>(pool, 'SELECT bundle FROM project_backups WHERE project_id = $1 AND id = $2', [pid(c), c.req.param('id')]);
  if (!b) throw new HttpError(404, 'Backup not found.');
  return c.json(b.bundle);
});

const download = (c: any, data: Buffer | string, type: string, name: string) => {
  c.header('Content-Type', type); c.header('Content-Disposition', `attachment; filename="${name}"`); c.header('Cache-Control', 'no-store');
  return c.body(data);
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'weave';
api.get('/projects/:pid/export/:file', async (c) => {
  await need(c);
  const file = c.req.param('file'), user = c.get('user');
  if (file === 'workspace.json') {
    const bundle = await exportBundle(pool, pid(c));
    await audit(pool, pid(c), user, 'export.workspace', 'project', pid(c));
    return download(c, JSON.stringify(bundle, null, 2), 'application/json', `${slug(bundle.project.name)}-workspace.json`);
  }
  const brief = await buildBrief(pool, pid(c));
  const base = slug(brief.projectName);
  if (file === 'brief.json') { const { model: _m, layout: _l, ...rest } = brief; return c.json(rest); }
  await audit(pool, pid(c), user, `export.${file.split('.')[0]}`, 'project', pid(c), { format: file.split('.')[1] });
  if (file === 'brief.pdf') return download(c, await briefPdf(brief), 'application/pdf', `${base}-decision-brief.pdf`);
  if (file === 'map.pdf') return download(c, await mapPdf(brief), 'application/pdf', `${base}-current-state-map.pdf`);
  if (file === 'opportunities.xlsx') return download(c, await opportunityXlsx(brief), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${base}-opportunities.xlsx`);
  if (file === 'opportunities.csv') return download(c, '﻿' + opportunityCsv(brief), 'text/csv; charset=utf-8', `${base}-opportunities.csv`);
  throw new HttpError(404, 'Unknown export.');
});

// ---- audit and research-effort log -----------------------------------------------------------------
const PHASE: [RegExp, string][] = [[/^(notes|sources)\./, 'Capture'], [/^(insights|links|opportunities|options|scenario|candidate)\b/, 'Synthesis'], [/^export\./, 'Report']];
api.get('/projects/:pid/audit', async (c) => {
  await need(c);
  const entries = await q<{ action: string; createdAt: string }>(pool, `SELECT id, actor, action, entity, entity_id AS "entityId", detail, created_at AS "createdAt" FROM audit_log WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT 400`, [pid(c)]);
  // Active time per phase: consecutive actions less than five minutes apart count as continuous work.
  const all = await q<{ action: string; t: string }>(pool, `SELECT action, created_at AS t FROM audit_log WHERE project_id = $1 ORDER BY created_at, id`, [pid(c)]);
  const effort = PHASE.map(([re, phase]) => {
    const ts = all.filter((e) => re.test(e.action)).map((e) => Date.parse(e.t));
    let active = 0; for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] < 300_000) active += ts[i] - ts[i - 1];
    return { phase, actions: ts.length, first: ts.length ? new Date(ts[0]).toISOString() : null, last: ts.length ? new Date(ts[ts.length - 1]).toISOString() : null, activeSeconds: Math.round(active / 1000) };
  });
  return c.json({ entries, effort, note: 'Measured from this workspace only. A comparison with a manual workflow is unmeasured until a comparable timed run exists.' });
});

api.all('*', () => { throw new HttpError(404, 'Not found.'); });
app.route('/api', api);
