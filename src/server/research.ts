// Research jobs (durable, database-queued) and the human review inbox.
import type pg from 'pg';
import { HttpError, type User } from './auth';
import { config } from './config';
import { one, pool, q, tx, type Db } from './db';
import { getProvider, providerStatus } from './providers';
import { deepOutputSchema, wideOutputSchema, type DeepInput } from './providers/types';
import { audit, getBranch, getRevision, listCollection, saveModel, upsertDoc } from './store';
import { alreadyInModel, applyToModel, candidateFingerprint, checkCandidateRefs, parseCandidateBundle, type Candidate } from '../shared/candidates';
import { newId } from '../shared/model';
import type { Note, Source } from '../shared/workspace';

const RUN_COLS = `id, mode, status, question, provider, input, result, error, attempts, max_attempts AS "maxAttempts", budget_seconds AS "budgetSeconds", cancel_requested AS "cancelRequested", created_at AS "createdAt", started_at AS "startedAt", finished_at AS "finishedAt"`;
const CAND_COLS = `id, run_id AS "runId", origin, schema_version AS "schemaVersion", payload, original_payload AS "originalPayload", fingerprint, status, base_revision_id AS "baseRevisionId", duplicate_of AS "duplicateOf", reviewer, reviewed_at AS "reviewedAt", review_note AS "reviewNote", applied, created_at AS "createdAt"`;

export interface CandidateRow { id: string; runId: string | null; origin: string; schemaVersion: number; payload: Candidate; originalPayload: Candidate; fingerprint: string; status: string; baseRevisionId: string | null; duplicateOf: string | null; reviewer: string; reviewedAt: string | null; reviewNote: string; applied: Record<string, string> | null; createdAt: string }

const baselineId = async (db: Db, pid: string) => (await one<{ id: string }>(db, `SELECT id FROM branches WHERE project_id = $1 AND kind = 'baseline'`, [pid]))!.id;

export async function listResearch(db: Db, pid: string) {
  const runs = await q(db, `SELECT ${RUN_COLS} FROM research_runs WHERE project_id = $1 ORDER BY ord DESC`, [pid]);
  const rows = await q<CandidateRow>(db, `SELECT ${CAND_COLS} FROM candidates WHERE project_id = $1 ORDER BY ord`, [pid]);
  const base = await getBranch(db, pid, await baselineId(db, pid));
  const model = (await getRevision(db, pid, base.headRevisionId)).model;
  const candidates = rows.map((c) => ({
    ...c,
    // Review-time checks against the live baseline; repeated inside the acceptance transaction.
    stale: c.status !== 'accepted' && !!c.baseRevisionId && c.baseRevisionId !== base.headRevisionId,
    refIssues: c.status === 'accepted' ? [] : checkCandidateRefs(c.payload, model),
    alreadyInModel: c.status !== 'accepted' && alreadyInModel(c.payload, model),
    edited: JSON.stringify(c.payload) !== JSON.stringify(c.originalPayload),
  }));
  return { provider: providerStatus(), runs, candidates, baselineRevisionId: base.headRevisionId };
}

async function insertCandidates(c: pg.PoolClient, pid: string, list: Candidate[], version: number, origin: string, runId: string | null, baseRevisionId: string) {
  const existing = await q<{ id: string; fingerprint: string }>(c, `SELECT id, fingerprint FROM candidates WHERE project_id = $1 AND status <> 'rejected'`, [pid]);
  const byPrint = new Map(existing.map((e) => [e.fingerprint, e.id]));
  const ids: string[] = [];
  for (const cand of list) {
    const id = newId('c', [...byPrint.values(), ...ids]);
    const fp = candidateFingerprint(cand);
    await c.query(`INSERT INTO candidates (project_id, id, run_id, origin, schema_version, payload, original_payload, fingerprint, base_revision_id, duplicate_of) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)`,
      [pid, id, runId, origin, version, JSON.stringify(cand), fp, baseRevisionId, byPrint.get(fp) ?? null]);
    if (!byPrint.has(fp)) byPrint.set(fp, id);
    ids.push(id);
  }
  return ids;
}

/** Manual import of a candidate bundle. Works with no provider configured. Nothing is written if anything is invalid. */
export async function importCandidates(pid: string, user: User, bundle: unknown) {
  const parsed = parseCandidateBundle(bundle);
  if (parsed.issues.length) throw new HttpError(422, 'This candidate file is not valid, so nothing was imported.', { issues: parsed.issues });
  return tx(async (c) => {
    const base = await getBranch(c, pid, await baselineId(c, pid));
    const model = (await getRevision(c, pid, base.headRevisionId)).model;
    const issues = parsed.candidates.flatMap((cand, i) => checkCandidateRefs(cand, model).map((message) => ({ path: `candidates.${i}`, message })));
    if (issues.length) throw new HttpError(422, 'Some candidates refer to items that are not in the current baseline, so nothing was imported.', { issues });
    const ids = await insertCandidates(c, pid, parsed.candidates, parsed.version, 'import', null, base.headRevisionId);
    await audit(c, pid, user, 'candidates.import', 'candidates', '', { count: ids.length, version: parsed.version });
    return { imported: ids.length };
  });
}

export async function reviewCandidate(pid: string, user: User, id: string, body: { status?: string; payload?: unknown; reviewNote?: string }) {
  return tx(async (c) => {
    const row = await one<CandidateRow>(c, `SELECT ${CAND_COLS} FROM candidates WHERE project_id = $1 AND id = $2 FOR UPDATE`, [pid, id]);
    if (!row) throw new HttpError(404, 'Candidate not found.');
    if (row.status === 'accepted') throw new HttpError(409, 'This candidate was already accepted and can no longer be changed.');
    let payload = row.payload;
    if (body.payload !== undefined) {
      const parsed = parseCandidateBundle({ format: 'weave-research-candidates', version: 2, candidates: [body.payload] });
      if (parsed.issues.length) throw new HttpError(422, 'The edited candidate is not valid.', { issues: parsed.issues });
      payload = parsed.candidates[0];
      if (payload.kind !== row.payload.kind) throw new HttpError(422, 'A candidate cannot change kind while being edited.');
    }
    const status = body.status ?? row.status;
    if (!['pending', 'rejected', 'needs_evidence'].includes(status)) throw new HttpError(422, 'Unknown review status.');
    await c.query(`UPDATE candidates SET payload = $3, fingerprint = $4, status = $5, review_note = $6, reviewer_id = $7, reviewer = $8, reviewed_at = now() WHERE project_id = $1 AND id = $2`,
      [pid, id, JSON.stringify(payload), candidateFingerprint(payload), status, (body.reviewNote ?? row.reviewNote).slice(0, 2000), user.id, user.name]);
    await audit(c, pid, user, body.payload !== undefined ? 'candidate.edit' : `candidate.${status}`, 'candidate', id, {});
    return { ok: true };
  });
}

async function ensureSource(c: pg.PoolClient, pid: string, user: User, cand: Candidate): Promise<string> {
  const sources = await listCollection<Source>(c, pid, 'sources');
  const found = sources.find((s) => s.anonId.trim().toLowerCase() === cand.sourceId.trim().toLowerCase());
  if (found) return found.id;
  const url = 'sourceUrl' in cand && cand.sourceUrl ? cand.sourceUrl : '';
  const s = await upsertDoc(c, pid, user, 'sources', { anonId: cand.sourceId, type: url ? 'public' : 'document', publicUrl: url, retrievedAt: ('retrievedAt' in cand && cand.retrievedAt) || '', collection: 'Agent findings', exportApproved: !!url });
  return s.id;
}

/** Accepting is a single transaction and is idempotent: repeating it returns the first result and changes nothing. */
export async function acceptCandidate(pid: string, user: User, id: string) {
  return tx(async (c) => {
    const row = await one<CandidateRow>(c, `SELECT ${CAND_COLS} FROM candidates WHERE project_id = $1 AND id = $2 FOR UPDATE`, [pid, id]);
    if (!row) throw new HttpError(404, 'Candidate not found.');
    if (row.status === 'accepted') return { applied: row.applied, alreadyAccepted: true };
    const parsed = parseCandidateBundle({ format: 'weave-research-candidates', version: 2, candidates: [row.payload] });
    if (parsed.issues.length) throw new HttpError(422, 'This candidate no longer passes validation. Edit it or mark it as needing evidence.', { issues: parsed.issues });
    const cand = parsed.candidates[0];
    const base = await getBranch(c, pid, await baselineId(c, pid), true);
    const head = await getRevision(c, pid, base.headRevisionId);
    const refIssues = checkCandidateRefs(cand, head.model);
    if (refIssues.length) throw new HttpError(422, 'The baseline has changed and this candidate no longer fits it.', { issues: refIssues.map((message) => ({ path: 'candidate', message })) });
    if (alreadyInModel(cand, head.model)) throw new HttpError(409, 'The baseline already contains this. Reject the candidate as a duplicate instead.');

    let applied: Record<string, string>;
    const provenance = `${cand.sourceId} · ${cand.certainty}`;
    if (cand.kind === 'node' || cand.kind === 'relationship' || cand.kind === 'activity') {
      const patch = applyToModel(cand, head.model, base.layout)!;
      const rev = await saveModel(c, pid, base.id, user, head.id, patch.model, `Accepted agent candidate: ${cand.summary}`.slice(0, 400));
      if (patch.position) await c.query(`UPDATE branches SET layout = layout || $3::jsonb, layout_version = layout_version + 1 WHERE project_id = $1 AND id = $2`, [pid, base.id, JSON.stringify({ [patch.created.id]: patch.position })]);
      const sourceId = await ensureSource(c, pid, user, cand);
      // The basis travels with the accepted object as an attached note, so the map item stays traceable.
      const note = await upsertDoc(c, pid, user, 'notes', { kind: 'observation', text: cand.basis, sourceId, certainty: cand.certainty, targetId: patch.created.id, anchorBranchId: base.id, anchorRevisionId: rev.id, category: 'Basis for accepted candidate', group: 'Agent findings' });
      applied = { kind: patch.created.kind, id: patch.created.id, revisionId: rev.id, noteId: note.id };
    } else if (cand.kind === 'assessment') {
      await ensureSource(c, pid, user, cand);
      const closed = cand.recommendation === 'close';
      const opp = await upsertDoc(c, pid, user, 'opportunities', {
        title: cand.optionLabel ?? cand.summary, interpretation: `${cand.reason}\n\nCoverage against the observed workflow: ${cand.coverage}`,
        uncertainty: [cand.fitGaps && `Fit gaps: ${cand.fitGaps}`, cand.uncertainty].filter(Boolean).join('\n'), decisionState: closed ? 'closed' : 'exploring', closeReason: closed ? cand.reason : '',
        validationPlan: cand.recommendation === 'test_existing' ? 'Test the existing solution on a small scale before deciding.' : '', internalNotes: `Agent assessment (${provenance}). Basis: ${cand.basis}${cand.sourceUrl ? ` · ${cand.sourceUrl}` : ''}`,
      });
      if (cand.recommendation === 'test_existing') await upsertDoc(c, pid, user, 'options', { opportunityId: opp.id, kind: 'existing_tool', title: cand.optionLabel ?? cand.summary, benefits: cand.coverage, downsides: cand.fitGaps, unknowns: cand.uncertainty, test: 'Small trial against the observed workflow.' });
      applied = { kind: 'opportunity', id: opp.id };
    } else {
      const sourceId = await ensureSource(c, pid, user, cand);
      let text: string, kind: Note['kind'], category = '';
      if (cand.kind === 'note') { text = cand.text; kind = cand.noteType; }
      else if (cand.kind === 'contradiction') { text = `${cand.text}\n${cand.accounts.map((a) => `• ${a.sourceId}: ${a.claim}`).join('\n')}`; kind = 'question'; category = 'Source disagreement'; }
      else { text = `${cand.text}\nMetric: ${cand.metric}${cand.method ? `\nMethod: ${cand.method}` : ''}`; kind = 'question'; category = 'Measurement gap'; }
      const targetId = 'targetId' in cand ? cand.targetId ?? null : null;
      const note = await upsertDoc(c, pid, user, 'notes', { kind, text, sourceId, certainty: cand.certainty, targetId, anchorBranchId: targetId ? base.id : null, anchorRevisionId: targetId ? head.id : null, category, group: 'Agent findings' });
      if (cand.kind === 'contradiction' && cand.noteIds && cand.noteIds.length >= 2) {
        const known = new Set((await listCollection<Note>(c, pid, 'notes')).map((n) => n.id));
        const [a, b] = cand.noteIds;
        if (known.has(a) && known.has(b)) await upsertDoc(c, pid, user, 'links', { fromType: 'note', fromId: a, toType: 'note', toId: b, relation: 'contradicts', comment: cand.summary });
      }
      applied = { kind: 'note', id: note.id };
    }
    await c.query(`UPDATE candidates SET status = 'accepted', reviewer_id = $3, reviewer = $4, reviewed_at = now(), applied = $5 WHERE project_id = $1 AND id = $2`, [pid, id, user.id, user.name, JSON.stringify(applied)]);
    await audit(c, pid, user, 'candidate.accept', 'candidate', id, { applied, origin: row.origin, sourceId: cand.sourceId, edited: JSON.stringify(row.payload) !== JSON.stringify(row.originalPayload) });
    return { applied, alreadyAccepted: false };
  });
}

// ---- jobs ------------------------------------------------------------------------------------------
export interface RunRequest { mode: 'wide' | 'deep'; question: string; topics?: string[]; noteIds?: string[]; insightId?: string | null }

export async function enqueueRun(pid: string, user: User, req: RunRequest) {
  const status = providerStatus();
  if (!status.available) throw new HttpError(409, status.reason || 'No research provider is available.');
  const question = (req.question ?? '').trim();
  if (question.length < 5 || question.length > 4000) throw new HttpError(422, 'Enter a research question (5 to 4,000 characters).');
  return tx(async (c) => {
    const base = await getBranch(c, pid, await baselineId(c, pid));
    const input: Record<string, unknown> = { branchId: base.id, revisionId: base.headRevisionId };
    if (req.mode === 'wide') input.topics = (req.topics ?? []).map((t) => String(t).slice(0, 200)).filter(Boolean).slice(0, 10);
    else {
      const notes = await listCollection<Note>(c, pid, 'notes');
      const ids = [...new Set(req.noteIds ?? [])];
      if (ids.length > 60) throw new HttpError(422, 'Select at most 60 notes for one deep job.');
      // IDs are resolved inside this project only, so a note from another project can never enter the agent context.
      const unknown = ids.filter((id) => !notes.some((n) => n.id === id));
      if (unknown.length) throw new HttpError(422, `These notes are not in this project: ${unknown.join(', ')}`);
      const blocked = ids.filter((id) => !notes.find((n) => n.id === id)!.excerptApproved);
      if (blocked.length) throw new HttpError(422, `These notes are not approved for agent use: ${blocked.join(', ')}. Approve the excerpt first, or leave them out.`);
      if (req.insightId && !(await one(c, 'SELECT 1 FROM insights WHERE project_id = $1 AND id = $2', [pid, req.insightId]))) throw new HttpError(422, 'That insight is not in this project.');
      if (!ids.length && !req.insightId) throw new HttpError(422, 'Choose an insight or at least one approved note.');
      input.noteIds = ids; input.insightId = req.insightId ?? null;
    }
    const id = newId('run');
    await c.query(`INSERT INTO research_runs (project_id, id, mode, status, question, provider, input, max_attempts, budget_seconds, created_by) VALUES ($1,$2,$3,'queued',$4,$5,$6,$7,$8,$9)`,
      [pid, id, req.mode, question, status.id, JSON.stringify(input), config.maxAttempts, config.budgetSeconds, user.id]);
    await audit(c, pid, user, 'research.enqueue', 'run', id, { mode: req.mode, noteCount: (input.noteIds as string[] | undefined)?.length ?? 0 });
    return { id };
  });
}

export async function cancelRun(pid: string, user: User, id: string) {
  const r = await pool.query(`UPDATE research_runs SET cancel_requested = true, status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END, finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END WHERE project_id = $1 AND id = $2 AND status IN ('queued', 'running') RETURNING status`, [pid, id]);
  if (!r.rowCount) throw new HttpError(409, 'This job has already finished.');
  await audit(pool, pid, user, 'research.cancel', 'run', id);
  return { status: r.rows[0].status };
}
export async function retryRun(pid: string, user: User, id: string) {
  if (!providerStatus().available) throw new HttpError(409, providerStatus().reason);
  const r = await pool.query(`UPDATE research_runs SET status = 'queued', attempts = 0, error = '', cancel_requested = false, lease_until = NULL, finished_at = NULL WHERE project_id = $1 AND id = $2 AND status IN ('failed', 'cancelled')`, [pid, id]);
  if (!r.rowCount) throw new HttpError(409, 'Only failed or cancelled jobs can be retried.');
  await audit(pool, pid, user, 'research.retry', 'run', id);
  return { ok: true };
}

interface Claimed { project_id: string; id: string; mode: 'wide' | 'deep'; question: string; input: any; attempts: number; max_attempts: number; budget_seconds: number }

/** Claims one job. A job whose lease expired (the process died mid-run) is picked up again, within its attempt budget. */
async function claim(): Promise<Claimed | null> {
  await pool.query(`UPDATE research_runs SET status = 'failed', error = 'The job was interrupted and has no attempts left.', finished_at = now() WHERE status = 'running' AND lease_until < now() AND attempts >= max_attempts`);
  const r = await pool.query<Claimed>(`
    UPDATE research_runs SET status = 'running', attempts = attempts + 1, started_at = now(), lease_until = now() + make_interval(secs => budget_seconds + 30)
    WHERE (project_id, id) = (SELECT project_id, id FROM research_runs WHERE (status = 'queued' OR (status = 'running' AND lease_until < now())) AND NOT cancel_requested ORDER BY ord LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING project_id, id, mode, question, input, attempts, max_attempts, budget_seconds`);
  return r.rows[0] ?? null;
}

async function buildDeepInput(job: Claimed, scope: string): Promise<DeepInput> {
  const pid = job.project_id;
  const notes = await listCollection<Note>(pool, pid, 'notes');
  const sources = await listCollection<Source>(pool, pid, 'sources');
  const rev = await getRevision(pool, pid, job.input.revisionId);
  const insight = job.input.insightId ? await one<{ data: { title: string; body: string } }>(pool, 'SELECT data FROM insights WHERE project_id = $1 AND id = $2', [pid, job.input.insightId]) : null;
  const m = rev.model;
  return {
    question: job.question, scope, revisionId: rev.id, insight: insight ? { title: insight.data.title, body: insight.data.body } : null,
    // Approval is re-checked when the job actually runs; a note un-approved in the meantime is left out.
    notes: (job.input.noteIds as string[]).map((id) => notes.find((n) => n.id === id)).filter((n): n is Note & { version: number } => !!n && n.excerptApproved)
      .map((n) => ({ id: n.id, sourceId: sources.find((s) => s.id === n.sourceId)?.anonId ?? 'Unattributed note', kind: n.kind, text: n.text, targetId: n.targetId })),
    model: { nodes: m.nodes.map(({ id, kind, label, role, scope: sc }) => ({ id, kind, label, role, scope: sc })), edges: m.edges.map(({ id, from, to, type, label, workItem, result, inputState, outputState }) => ({ id, from, to, type, label, workItem, result, inputState, outputState })), activities: m.activities.map(({ id, edgeId, ownerNodeId, performerId, actionCode, label }) => ({ id, edgeId, ownerNodeId, performerId, actionCode, label })) },
  };
}

async function execute(job: Claimed) {
  const provider = getProvider();
  const pid = job.project_id;
  const finish = (status: string, error = '', result: unknown = null) => pool.query(`UPDATE research_runs SET status = $3, error = $4, result = COALESCE($5, result), finished_at = now(), lease_until = NULL WHERE project_id = $1 AND id = $2`, [pid, job.id, status, error.slice(0, 2000), result ? JSON.stringify(result) : null]);
  if (!provider) return finish('failed', 'No research provider is configured.');
  const ac = new AbortController();
  let timedOut = false, cancelled = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, job.budget_seconds * 1000);
  const poll = setInterval(async () => {
    const r = await one<{ cancel_requested: boolean }>(pool, 'SELECT cancel_requested FROM research_runs WHERE project_id = $1 AND id = $2', [pid, job.id]).catch(() => null);
    if (r?.cancel_requested) { cancelled = true; ac.abort(); }
  }, 400);
  try {
    const project = await one<{ name: string; meta: Record<string, string> }>(pool, 'SELECT name, meta FROM projects WHERE id = $1', [pid]);
    const scope = [project?.name, project?.meta.scopeDescription, project?.meta.researchQuestion].filter(Boolean).join(' — ');
    const ctx = { signal: ac.signal, attempt: job.attempts };
    const raw = job.mode === 'wide'
      ? await provider.runWide({ question: job.question, scope, topics: job.input.topics ?? [], maxSearches: config.maxSearches }, ctx)
      : await provider.runDeep(await buildDeepInput(job, scope), ctx);
    if (cancelled) return finish('cancelled', 'Cancelled by a researcher.');
    const out = (job.mode === 'wide' ? wideOutputSchema : deepOutputSchema).safeParse(raw);
    if (!out.success) return finish('failed', `The provider returned output that does not match the expected shape (${out.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ')}). Nothing was added to review.`);
    const bundle = parseCandidateBundle(out.data.candidates);
    if (bundle.issues.length) return finish('failed', `The provider returned candidates that fail validation (${bundle.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')}). Nothing was added to review.`);
    const rev = await getRevision(pool, pid, job.input.revisionId);
    const bad = bundle.candidates.flatMap((cand, i) => checkCandidateRefs(cand, rev.model).map((m) => `candidate ${i + 1}: ${m}`));
    if (bad.length) return finish('failed', `The provider referred to items that are not in the model (${bad.slice(0, 3).join('; ')}). Nothing was added to review.`);
    const { candidates: _c, ...result } = out.data;
    await tx(async (c) => {
      const still = await one<{ status: string; cancel_requested: boolean }>(c, 'SELECT status, cancel_requested FROM research_runs WHERE project_id = $1 AND id = $2 FOR UPDATE', [pid, job.id]);
      if (!still || still.status !== 'running' || still.cancel_requested) { cancelled = true; return; }
      const ids = await insertCandidates(c, pid, bundle.candidates, bundle.version, provider.synthetic ? 'fixture' : 'agent', job.id, job.input.revisionId);
      await c.query(`UPDATE research_runs SET status = 'ready_for_review', error = '', result = $3, finished_at = now(), lease_until = NULL WHERE project_id = $1 AND id = $2`,
        [pid, job.id, JSON.stringify({ ...result, synthetic: provider.synthetic, providerLabel: provider.label, candidateCount: ids.length })]);
      await audit(c, pid, null, 'research.complete', 'run', job.id, { candidates: ids.length, provider: provider.id });
    });
    if (cancelled) await finish('cancelled', 'Cancelled by a researcher.');
  } catch (e) {
    if (cancelled) return finish('cancelled', 'Cancelled by a researcher.');
    if (timedOut) return finish('failed', `Stopped after the ${job.budget_seconds}-second time budget. Nothing was added to review.`);
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error(`[jobs] run ${job.id} attempt ${job.attempts} failed`); // no question text or excerpts in logs
    if (job.attempts < job.max_attempts) await pool.query(`UPDATE research_runs SET status = 'queued', error = $3, lease_until = NULL WHERE project_id = $1 AND id = $2`, [pid, job.id, `Attempt ${job.attempts} failed: ${message}. Retrying.`.slice(0, 2000)]);
    else await finish('failed', `${message} (after ${job.attempts} attempt${job.attempts === 1 ? '' : 's'})`);
  } finally { clearTimeout(timer); clearInterval(poll); }
}

/** Runs at most one job. Returns true when a job was processed. */
export async function runOnce(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  await execute(job);
  return true;
}

let stopWorker: (() => void) | null = null;
export function startWorker() {
  if (stopWorker) return stopWorker;
  let busy = false, stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try { while (!stopped && (await runOnce())) { /* drain */ } } catch (e) { console.error('[jobs] worker error:', e instanceof Error ? e.message : e); } finally { busy = false; }
  };
  const t = setInterval(tick, config.jobPollMs);
  void tick();
  stopWorker = () => { stopped = true; clearInterval(t); stopWorker = null; };
  console.log(`[jobs] worker started (provider: ${providerStatus().id})`);
  return stopWorker;
}
