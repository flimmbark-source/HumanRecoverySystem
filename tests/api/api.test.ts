import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/server/app';
import { createSession } from '../../src/server/auth';
import { pool } from '../../src/server/db';
import { runOnce } from '../../src/server/research';
import { compare } from '../../src/shared/impact';
import { anchorState, diffModels } from '../../src/shared/diff';
import { validateBundle } from '../../src/shared/workspace';
import { Client, freshDb, login, ok } from './helpers';

const fixture = () => JSON.parse(readFileSync('reference/handoff/fixtures/synthetic-volunteer-placement-v0.7.json', 'utf8'));
const skill = (f: string) => JSON.parse(readFileSync(`reference/handoff/reference/weave_research_skill/examples/${f}`, 'utf8'));
let demo: string, owner: Client, editor: Client, reader: Client, outsider: Client;
const drain = async () => { while (await runOnce()) { /* run queued jobs */ } };
const head = async (c: Client, pid: string, bid = 'baseline') => ok(await c.get(`/projects/${pid}/branches/${bid}`));

beforeAll(async () => {
  demo = (await freshDb()).projectId;
  owner = await login('owner@weave.test'); editor = await login('researcher@weave.test'); reader = await login('reader@weave.test'); outsider = await login('outsider@weave.test');
});

describe('start, persistence and conflicts', () => {
  it('requires sign-in and slows password guessing', async () => {
    expect((await new Client().get('/projects')).status).toBe(401);
    const c = new Client();
    const tries = [];
    for (let i = 0; i < 9; i++) tries.push((await c.post('/auth/login', { email: 'nobody@weave.test', password: 'wrong-password' })).status);
    expect(tries).toEqual([401, 401, 401, 401, 401, 401, 401, 401, 429]);
  });

  it('accepts the session token as a bearer token, as the app on a phone sends it', async () => {
    const token = await createSession(ok(await owner.get('/me')).user.id);
    const me = (authorization: string) => app.request('/api/me', { headers: { authorization } });
    expect((await me(`Bearer ${token}`)).status).toBe(200);
    expect((await me('Bearer not-a-session')).status).toBe(401);
    expect((await app.request('/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await me(`Bearer ${token}`)).status).toBe(401);
  });

  it('creates an empty project next to the synthetic one and keeps them independent', async () => {
    const id = ok(await owner.post('/projects', { name: 'Blank intake study', startLabel: 'Front desk', outcomeLabel: 'Request resolved', template: 'blank' })).id;
    const blank = await head(owner, id);
    expect(blank.revision.model.nodes.map((n: any) => n.label)).toEqual(['Front desk', 'Request resolved']);
    const m = blank.revision.model;
    m.nodes.push({ id: 'n3', kind: 'system', label: 'Ticket queue', role: '', description: '', scope: 'internal', parentId: null });
    ok(await owner.put(`/projects/${id}/branches/baseline/model`, { expectedRevisionId: blank.revision.id, model: m, summary: 'add node' }));
    const again = await login('owner@weave.test'); // signing in again sees the same data
    expect((await head(again, id)).revision.model.nodes).toHaveLength(3);
    expect((await head(again, demo)).revision.model.nodes).toHaveLength(6);
    expect(ok(await again.get('/projects')).projects.map((p: any) => p.name).sort()).toEqual(['Blank intake study', 'Volunteer placement (synthetic demo)']);
  });

  it('reports a recoverable conflict instead of overwriting', async () => {
    const a = await head(owner, demo), b = await head(editor, demo);
    const ma = structuredClone(a.revision.model); ma.nodes[1].label = 'Application portal';
    const saved = ok(await owner.put(`/projects/${demo}/branches/baseline/model`, { expectedRevisionId: a.revision.id, model: ma }));
    const mb = structuredClone(b.revision.model); mb.nodes[2].label = 'Placement coordinator';
    const conflict = await editor.put(`/projects/${demo}/branches/baseline/model`, { expectedRevisionId: b.revision.id, model: mb });
    expect(conflict.status).toBe(409);
    expect(conflict.json.conflict).toBe(true);
    expect(conflict.json.current.revision.id).toBe(saved.revision.id);
    expect(conflict.json.current.revision.model.nodes[1].label).toBe('Application portal');
    expect((await head(owner, demo)).revision.model.nodes[2].label).toBe('Coordinator'); // nothing silently overwritten
    // the second session can rebase its draft on the current revision and save
    const rebased = structuredClone(conflict.json.current.revision.model); rebased.nodes[2].label = 'Placement coordinator'; rebased.nodes[1].label = 'Application form';
    rebased.nodes[2].label = 'Coordinator';
    ok(await editor.put(`/projects/${demo}/branches/baseline/model`, { expectedRevisionId: conflict.json.current.revision.id, model: rebased }));
  });

  it('rejects an invalid model without saving', async () => {
    const a = await head(owner, demo);
    const m = structuredClone(a.revision.model); m.edges[0].to = 'ghost';
    const r = await owner.put(`/projects/${demo}/branches/baseline/model`, { expectedRevisionId: a.revision.id, model: m });
    expect(r.status).toBe(422);
    expect(r.json.issues[0].message).toContain('"ghost" does not exist');
    expect((await head(owner, demo)).revision.id).toBe(a.revision.id);
  });

  it('revisions are immutable in the database', async () => {
    await expect(pool.query(`UPDATE revisions SET summary = 'x' WHERE project_id = $1`, [demo])).rejects.toThrow(/immutable/);
  });
});

describe('privacy and access', () => {
  it('isolates projects for API, exports, jobs and candidates', async () => {
    for (const path of ['', '/branches/baseline', '/evidence', '/research', '/export/workspace.json', '/export/brief.pdf', '/audit', '/revisions/rev-base-1'])
      expect((await outsider.get(`/projects/${demo}${path}`)).status, path).toBe(404);
    expect((await outsider.post(`/projects/${demo}/research/runs`, { mode: 'wide', question: 'What is out there?' })).status).toBe(404);
    expect((await outsider.post(`/projects/${demo}/candidates/import`, { bundle: skill('demo-candidates.json') })).status).toBe(404);
    expect((await outsider.post(`/projects/${demo}/c/notes`, { text: 'x' })).status).toBe(404);
    expect(ok(await outsider.get('/projects')).projects).toHaveLength(0);
  });

  it('a reader can read but cannot change anything', async () => {
    const h = await head(reader, demo);
    expect(h.revision.model.nodes).toHaveLength(6);
    const tries = [
      await reader.put(`/projects/${demo}/branches/baseline/model`, { expectedRevisionId: h.revision.id, model: h.revision.model }),
      await reader.put(`/projects/${demo}/branches/baseline/layout`, { layout: {} }),
      await reader.post(`/projects/${demo}/c/notes`, { text: 'reader note' }),
      await reader.post(`/projects/${demo}/branches`, { name: 'x', fromBranchId: 'baseline' }),
      await reader.post(`/projects/${demo}/candidates/import`, { bundle: skill('demo-candidates.json') }),
      await reader.post(`/projects/${demo}/research/runs`, { mode: 'wide', question: 'What is out there?' }),
      await reader.patch(`/projects/${demo}`, { name: 'renamed' }),
      await reader.post(`/projects/${demo}/members`, { email: 'outsider@weave.test', role: 'editor' }),
    ];
    expect(tries.map((t) => t.status)).toEqual([403, 403, 403, 403, 403, 403, 403, 403]);
    expect((await reader.get(`/projects/${demo}/export/brief.pdf`)).status).toBe(200);
  });

  it('an object ID from another project cannot be fetched or attached', async () => {
    const other = ok(await outsider.post('/projects', { name: 'Outsider project', template: 'demo' })).id;
    const foreign = ok(await outsider.post(`/projects/${other}/c/notes`, { text: 'Private note in another project', excerptApproved: true })).doc;
    // the foreign note ID does not resolve inside the demo project
    const run = await editor.post(`/projects/${demo}/research/runs`, { mode: 'deep', question: 'Explore this note', noteIds: [foreign.id] });
    expect(run.status).toBe(422);
    expect(run.json.error).toContain('not in this project');
    expect((await editor.post(`/projects/${demo}/c/links`, { fromType: 'note', fromId: 't1', toType: 'note', toId: foreign.id, relation: 'supports' })).status).toBe(422);
    expect((await editor.patch(`/projects/${demo}/c/notes/${foreign.id}`, { text: 'hijack' })).status).toBe(404);
  });
});

describe('import and export', () => {
  it('previews and imports the v0.7 fixture into a new project with the expected totals', async () => {
    const preview = ok(await owner.post('/import/preview', { data: fixture() }));
    expect(preview).toMatchObject({ kind: 'legacy', ok: true, summary: { nodes: 6, connections: 6, notes: 3, links: 2 } });
    expect(preview.decisions.some((d: any) => d.kind === 'unattached-timing' && d.recordId === 'e6')).toBe(true);
    const before = ok(await owner.get('/projects')).projects.length;
    const id = ok(await owner.post('/import', { data: fixture(), name: 'Imported v0.7 fixture' })).id;
    expect(ok(await owner.get('/projects')).projects.length).toBe(before + 1); // a new project, nothing replaced
    const h = await head(owner, id);
    expect(h.revision.model.nodes).toHaveLength(6);
    expect(h.revision.model.edges).toHaveLength(6);
    const ev = ok(await owner.get(`/projects/${id}/evidence`));
    expect(ev.notes.map((n: any) => [n.id, n.targetId, n.anchorRevisionId])).toEqual([['t1', 'e2', 'rev-base-1'], ['t2', 'e3', 'rev-base-1'], ['t3', 'e5', 'rev-base-1']]);
    const c = compare(h.revision.model, h.revision.model, 'r-main');
    expect([c.base.effort.perCase.value, c.base.effort.monthly.value, c.base.elapsed!.elapsed.value]).toEqual([63, 84, 171]);
  });

  it('rejects broken files with field-level errors and writes nothing', async () => {
    const before = ok(await owner.get('/projects')).projects.length;
    const bad = fixture(); bad.base.edges[1].from = 'n404'; bad.base.nodes[3].id = 'n1';
    const r = await owner.post('/import', { data: bad });
    expect(r.status).toBe(422);
    expect(r.json.issues.map((i: any) => i.path)).toEqual(expect.arrayContaining(['base.nodes.3.id', 'base.edges.1.from']));
    expect((await owner.post('/import', { data: { format: 'something-else' } })).status).toBe(422);
    expect(ok(await owner.get('/projects')).projects.length).toBe(before);
  });

  it('replacement needs the project name and leaves a backup', async () => {
    const id = ok(await owner.post('/import', { data: fixture(), name: 'To be replaced' })).id;
    expect((await owner.post(`/projects/${id}/replace`, { data: fixture(), confirmName: 'wrong' })).status).toBe(422);
    const done = ok(await owner.post(`/projects/${id}/replace`, { data: fixture(), confirmName: 'To be replaced' }));
    const backup = ok(await owner.get(`/projects/${id}/backups/${done.backupId}`));
    expect(validateBundle(backup).issues).toEqual([]);
    expect((await editor.post(`/projects/${demo}/replace`, { data: fixture(), confirmName: 'x' })).status).toBe(403);
  });
});

describe('scenario and evidence isolation', () => {
  let A: string, B: string, baseRev: string;
  it('branches baseline → A → B and keeps evidence and comparison revisions intact', async () => {
    const base = await head(editor, demo); baseRev = base.revision.id;
    A = ok(await editor.post(`/projects/${demo}/branches`, { name: 'A · faster matching', fromBranchId: 'baseline' })).branch.id;
    const a = await head(editor, demo, A);
    const ma = structuredClone(a.revision.model); ma.activities.find((x: any) => x.id === 'a-e3').activeMinutes.value = 10;
    const aRev = ok(await editor.put(`/projects/${demo}/branches/${A}/model`, { expectedRevisionId: a.revision.id, model: ma, summary: 'e3 22 → 10' })).revision;
    B = ok(await editor.post(`/projects/${demo}/branches`, { name: 'B · skip triage', fromBranchId: A })).branch.id;
    const b = await head(editor, demo, B);
    expect(b.lineage.map((l: any) => [l.relation, l.revisionId])).toEqual([['parent', aRev.id], ['original baseline', baseRev]]);
    const mb = structuredClone(b.revision.model);
    mb.edges = mb.edges.filter((e: any) => e.id !== 'e2'); mb.activities = mb.activities.filter((x: any) => x.edgeId !== 'e2');
    const bRev = ok(await editor.put(`/projects/${demo}/branches/${B}/model`, { expectedRevisionId: b.revision.id, model: mb, summary: 'delete e2' })).revision;

    // B vs parent and vs original baseline
    const vsParent = diffModels(aRev.model, bRev.model), vsBase = diffModels(base.revision.model, bRev.model);
    expect([...vsParent.removed]).toEqual(['e2']);
    expect(vsBase.changes.find((c) => c.id === 'e3')!.fields.map((f) => f.field)).toEqual(['active time']);
    expect(vsParent.brokenRoutes[0].name).toBe('Main route');
    expect(vsParent.unreachableOutcomes.map((o) => o.label)).toEqual(['Placement confirmed']);
    expect(vsParent.downstream.map((d) => d.id)).toEqual(expect.arrayContaining(['n3', 'e3', 'n5', 'e4', 'n6']));

    // Baseline note t1 still links to e2; in B the attachment is explicitly historical.
    const notes = ok(await editor.get(`/projects/${demo}/evidence`)).notes;
    const t1 = notes.find((n: any) => n.id === 't1');
    expect(t1.targetId).toBe('e2');
    expect(anchorState((await head(editor, demo)).revision.model, t1.targetId)).toBe('attached');
    expect(anchorState(bRev.model, t1.targetId)).toBe('historical');
    expect(anchorState(aRev.model, t1.targetId)).toBe('attached');
  });

  it('updating the live baseline does not move either branch comparison', async () => {
    const base = await head(editor, demo);
    const m = structuredClone(base.revision.model); m.volume.value = 120;
    ok(await editor.put(`/projects/${demo}/branches/baseline/model`, { expectedRevisionId: base.revision.id, model: m, summary: 'volume 120' }));
    const a = await head(editor, demo, A), b = await head(editor, demo, B);
    expect(a.branch.baseRevisionId).toBe(baseRev);
    expect(b.lineage.at(-1).revisionId).toBe(baseRev);
    const pinned = ok(await editor.get(`/projects/${demo}/revisions/${baseRev}`)).revision.model;
    expect(pinned.volume.value).toBe(80);
    const c = compare(pinned, a.revision.model, 'r-main');
    expect([c.atCommonVolume.value, c.scenario.effort.monthly.value, c.scenario.elapsed!.elapsed.value]).toEqual([-16, 68, 159]);
    // restore the baseline volume for later tests, via history
    const live = await head(editor, demo);
    ok(await editor.post(`/projects/${demo}/branches/baseline/restore`, { revisionId: base.revision.id, expectedRevisionId: live.revision.id }));
    expect((await head(editor, demo)).revision.model.volume.value).toBe(80);
  });

  it('notes never change when a scenario removes their target, and survive edits', async () => {
    const t1 = ok(await editor.patch(`/projects/${demo}/c/notes/t1`, { text: 'Applicants sometimes ask for an update after applying.' })).doc;
    expect(t1.rawText).toBe('One applicant reported needing to request an update after applying.'); // raw note preserved
    const stale = await editor.patch(`/projects/${demo}/c/notes/t1`, { text: 'second writer', expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.json.current.text).toBe('Applicants sometimes ask for an update after applying.');
  });
});

describe('fieldwork, synthesis and decision', () => {
  it('saves a freeform insight with nothing attached, then links and unlinks evidence without touching notes', async () => {
    const ins = ok(await editor.post(`/projects/${demo}/c/insights`, { body: 'Capacity knowledge lives in people, not in the board.' })).doc;
    expect(ins).toMatchObject({ title: '', modelLinks: [] });
    const before = ok(await editor.get(`/projects/${demo}/evidence`)).notes.find((n: any) => n.id === 't2');
    const sup = ok(await editor.post(`/projects/${demo}/c/links`, { fromType: 'note', fromId: 't2', toType: 'insight', toId: ins.id, relation: 'supports' })).doc;
    const con = ok(await editor.post(`/projects/${demo}/c/links`, { fromType: 'note', fromId: 't1', toType: 'insight', toId: ins.id, relation: 'contradicts' })).doc;
    ok(await editor.patch(`/projects/${demo}/c/links/${con.id}`, { relation: 'related' }));
    ok(await editor.del(`/projects/${demo}/c/links/${sup.id}`));
    const after = ok(await editor.get(`/projects/${demo}/evidence`));
    expect(after.notes.find((n: any) => n.id === 't2')).toEqual(before);
    expect(after.insights.find((i: any) => i.id === ins.id).body).toBe('Capacity knowledge lives in people, not in the board.');
  });

  it('keeps two work episodes about the same role independently traceable, without scores', async () => {
    const src = ok(await editor.post(`/projects/${demo}/c/sources`, { anonId: 'Observation 03', type: 'observation', participantRole: 'Coordinator', date: '2026-11-10' })).doc;
    const mk = (text: string, episode: object) => editor.post(`/projects/${demo}/c/notes`, { text, sourceId: src.id, targetId: 'e3', certainty: 'observed', episode });
    const a = ok(await mk('Protected conversation led to a good match.', { task: 'Match a volunteer', intendedOutcome: 'A fitting placement', action: 'Talked through interests uninterrupted', helped: 'Quiet room, 20 protected minutes', hindered: '', outcome: 'Good match first time', hiddenEffort: 'Prepared notes the evening before', clarification: 'Says the quiet time is rare' })).doc;
    const b = ok(await mk('Interrupted three times; details missed.', { task: 'Match a volunteer', intendedOutcome: 'A fitting placement', action: 'Matched between phone calls', helped: '', hindered: 'Three interruptions, capacity board out of date', outcome: 'Missed an availability constraint', hiddenEffort: 'Re-contacted the volunteer later', clarification: '' })).doc;
    expect(a.id).not.toBe(b.id);
    expect([a.episode.helped, b.episode.hindered]).toEqual(['Quiet room, 20 protected minutes', 'Three interruptions, capacity board out of date']);
    expect(JSON.stringify([a, b])).not.toMatch(/score|rating|skill/i);
    expect((await editor.post(`/projects/${demo}/c/notes`, { text: 'x', rating: 4 })).json.doc.rating).toBeUndefined();
  });

  it('exports brief, map and sheet with anonymized provenance and no internal content', async () => {
    const ins = ok(await editor.post(`/projects/${demo}/c/insights`, { title: 'Capacity checks interrupt matching', body: 'Matching goes well when the conversation is protected.' })).doc;
    ok(await editor.post(`/projects/${demo}/c/links`, { fromType: 'note', fromId: 't2', toType: 'insight', toId: ins.id, relation: 'supports' }));
    const secret = ok(await editor.post(`/projects/${demo}/c/notes`, { text: 'UNAPPROVED-EXCERPT about a named colleague', kind: 'observation' })).doc;
    ok(await editor.post(`/projects/${demo}/c/links`, { fromType: 'note', fromId: secret.id, toType: 'insight', toId: ins.id, relation: 'contradicts' }));
    const opp = ok(await editor.post(`/projects/${demo}/c/opportunities`, { title: ins.title, insightIds: [ins.id], preserve: 'The personal matching conversation.', internalNotes: 'INTERNAL-ONLY remark', validationPlan: 'Two-week trial.' })).doc;
    const opt = ok(await editor.post(`/projects/${demo}/c/options`, { opportunityId: opp.id, kind: 'process_change', title: 'Protected matching hour', benefits: 'Fewer missed details', downsides: 'Phone cover needed', smallestReversible: true })).doc;
    ok(await editor.patch(`/projects/${demo}/c/opportunities/${opp.id}`, { recommendedOptionId: opt.id }));
    const draftBrief = ok(await editor.get(`/projects/${demo}/export/brief.json`));
    expect(draftBrief.recommendations.find((r: any) => r.id === opp.id)).toMatchObject({ title: expect.stringMatching(/^Opportunity \d+$/), interpretation: '' });
    ok(await editor.patch(`/projects/${demo}/c/opportunities/${opp.id}`, { reportTitle: 'Protect matching conversations', interpretation: 'Interruptions can make matching harder.' }));
    const brief = ok(await editor.get(`/projects/${demo}/export/brief.json`));
    const rec = brief.recommendations.find((r: any) => r.id === opp.id);
    expect(rec.heading).toBe('Hypothesis to test'); // one source and an unreconciled contradiction
    expect(rec.interpretation).toBe('Interruptions can make matching harder.');
    expect(rec.observations.map((o: any) => [o.relation, o.text, o.source])).toEqual([['supports', 'A coordinator described checking for available placements manually.', 'Illustrative interview 02'], ['contradicts', null, 'No recorded source']]);
    const text = JSON.stringify(brief);
    expect(text).not.toContain('UNAPPROVED-EXCERPT'); expect(text).not.toContain('INTERNAL-ONLY'); expect(text).not.toContain('participantRole');
    expect(text).not.toContain(ins.title); expect(text).not.toContain(ins.body);
    const pdf = await editor.get(`/projects/${demo}/export/brief.pdf`);
    expect(Buffer.from(await pdf.res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const map = await editor.get(`/projects/${demo}/export/map.pdf`);
    expect(Buffer.from(await map.res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const xlsx = await editor.get(`/projects/${demo}/export/opportunities.xlsx`);
    expect(Buffer.from(await xlsx.res.arrayBuffer()).subarray(0, 2).toString()).toBe('PK');
    const csv = await (await editor.get(`/projects/${demo}/export/opportunities.csv`)).res.text();
    expect(csv).toContain('Protect matching conversations'); expect(csv).not.toContain('INTERNAL-ONLY');
    expect(csv).toContain(rec.interpretation); expect(csv).not.toContain(ins.title); expect(csv).not.toContain(ins.body);
    const backup = JSON.parse(await (await editor.get(`/projects/${demo}/export/workspace.json`)).res.text());
    expect(backup.insights.find((i: any) => i.id === ins.id).body).toBe(ins.body);
    expect(backup.opportunities.find((o: any) => o.id === opp.id).reportTitle).toBe(rec.title);
  });

  it('keeps inferred sources visible and requires a researcher decision before recommending an in-scope option', async () => {
    const path = `/projects/${demo}`;
    const create = async (collection: string, data: object) => ok(await editor.post(`${path}/c/${collection}`, data)).doc;
    const first = await create('sources', { anonId: 'Review source 01' });
    const second = await create('sources', { anonId: 'Review source 02' });
    const noteIds: string[] = [];
    for (const source of [first, second]) {
      noteIds.push((await create('notes', { sourceId: source.id, text: 'Capacity checks may interrupt matching.', certainty: 'inferred' })).id);
    }
    const opp = await create('opportunities', { title: 'Internal opportunity', reportTitle: 'Matching options', noteIds });
    const option = await create('options', { title: 'Reorganize departments', opportunityId: opp.id, kind: 'process_change', withinPilotScope: false });
    const updateDecision = async (data: object) => ok(await editor.patch(`${path}/c/opportunities/${opp.id}`, data));
    const updateOption = async (withinPilotScope: boolean) => ok(await editor.patch(`${path}/c/options/${option.id}`, { withinPilotScope }));
    const report = async () => ok(await editor.get(`${path}/export/brief.json`)).recommendations.find((r: any) => r.id === opp.id);
    await updateDecision({ recommendedOptionId: option.id, decisionState: 'recommended' });
    expect(await report()).toMatchObject({ heading: 'Exploratory option outside pilot scope', sourceCount: 2, evidenceLevel: 'Thin evidence', option: { withinPilotScope: false } });
    const csv = await (await editor.get(`${path}/export/opportunities.csv`)).res.text();
    expect(csv).toContain('Exploratory option outside pilot scope');

    await updateOption(true);
    expect(await report()).toMatchObject({ heading: 'Hypothesis to test', sourceCount: 2, evidenceLevel: 'Thin evidence' });
    await updateDecision({ decisionState: 'exploring' });
    for (const id of noteIds) ok(await editor.patch(`${path}/c/notes/${id}`, { certainty: 'reported' }));
    expect(await report()).toMatchObject({ heading: 'Option under review', evidenceLevel: 'Multiple supporting sources' });
    await updateDecision({ decisionState: 'recommended' });
    expect((await report()).heading).toBe('Recommendation');
    await updateOption(false);
    expect((await report()).heading).toBe('Exploratory option outside pilot scope');
  });
});

describe('research jobs and review inbox', () => {
  it('imports the bundled skill examples for manual review, and rejects invalid bundles whole', async () => {
    expect(ok(await editor.post(`/projects/${demo}/candidates/import`, { bundle: skill('demo-candidates.json') })).imported).toBe(3);
    expect(ok(await editor.post(`/projects/${demo}/candidates/import`, { bundle: skill('semantic-relationship.json') })).imported).toBe(1);
    const bad = skill('demo-candidates.json'); bad.candidates[1].ownerId = 'n404';
    const r = await editor.post(`/projects/${demo}/candidates/import`, { bundle: bad });
    expect(r.status).toBe(422);
    const bad2 = skill('demo-candidates.json'); delete bad2.candidates[0].basis; bad2.candidates[1].minutes = 12; // number without measurementBasis
    expect((await editor.post(`/projects/${demo}/candidates/import`, { bundle: bad2 })).json.issues.length).toBeGreaterThan(1);
    const inbox = ok(await editor.get(`/projects/${demo}/research`)).candidates;
    expect(inbox).toHaveLength(4);
    expect(inbox.every((c: any) => c.status === 'pending')).toBe(true);
    // re-importing the same file is flagged as duplicate, not silently merged
    ok(await editor.post(`/projects/${demo}/candidates/import`, { bundle: skill('semantic-relationship.json') }));
    const dup = ok(await editor.get(`/projects/${demo}/research`)).candidates.at(-1);
    expect(dup.duplicateOf).toBe(inbox[3].id);
  });

  it('accepts once: a repeated accept changes nothing and leaves one audit entry', async () => {
    const before = await head(editor, demo);
    const inbox = ok(await editor.get(`/projects/${demo}/research`)).candidates;
    const rel = inbox.find((c: any) => c.payload.kind === 'relationship');
    const first = ok(await editor.post(`/projects/${demo}/candidates/${rel.id}/accept`));
    const [second, third] = await Promise.all([editor.post(`/projects/${demo}/candidates/${rel.id}/accept`), owner.post(`/projects/${demo}/candidates/${rel.id}/accept`)]);
    expect(first.alreadyAccepted).toBe(false);
    expect([second.json.alreadyAccepted, third.json.alreadyAccepted]).toEqual([true, true]);
    expect(second.json.applied).toEqual(first.applied);
    const after = await head(editor, demo);
    expect(after.revision.model.edges.length).toBe(before.revision.model.edges.length + 1);
    const added = after.revision.model.edges.find((e: any) => e.id === first.applied.id);
    expect(added).toMatchObject({ from: 'n2', to: 'n3', label: 'Review application', inputState: 'submitted' });
    expect(after.revision.model.activities.find((a: any) => a.edgeId === added.id)).toMatchObject({ performerId: 'n3', actionCode: 'review', activeMinutes: { value: null } });
    const audits = await pool.query(`SELECT actor FROM audit_log WHERE project_id = $1 AND action = 'candidate.accept' AND entity_id = $2`, [demo, rel.id]);
    expect(audits.rows).toEqual([{ actor: 'Rae Researcher' }]);
    // the duplicate of an accepted candidate cannot add the same connection again
    const dup = ok(await editor.get(`/projects/${demo}/research`)).candidates.find((c: any) => c.duplicateOf === rel.id);
    expect(dup.alreadyInModel).toBe(true);
    expect((await editor.post(`/projects/${demo}/candidates/${dup.id}/accept`)).status).toBe(409);
    ok(await editor.patch(`/projects/${demo}/candidates/${dup.id}`, { status: 'rejected', reviewNote: 'duplicate' }));
    // edit, needs-evidence and note acceptance
    const act = inbox.find((c: any) => c.payload.kind === 'activity');
    ok(await editor.patch(`/projects/${demo}/candidates/${act.id}`, { status: 'needs_evidence', reviewNote: 'Observe this first' }));
    const note = inbox.find((c: any) => c.payload.kind === 'note');
    ok(await editor.patch(`/projects/${demo}/candidates/${note.id}`, { payload: { ...note.payload, text: 'Edited by the reviewer before acceptance.' } }));
    const acc = ok(await editor.post(`/projects/${demo}/candidates/${note.id}/accept`));
    const created = ok(await editor.get(`/projects/${demo}/evidence`)).notes.find((n: any) => n.id === acc.applied.id);
    expect(created).toMatchObject({ text: 'Edited by the reviewer before acceptance.', targetId: 'e2', certainty: 'reported' });
    expect((await editor.patch(`/projects/${demo}/candidates/${note.id}`, { status: 'rejected' })).status).toBe(409);
  });

  it('wide run returns citations, a coverage assessment and a follow-up question, held for review', async () => {
    const id = ok(await editor.post(`/projects/${demo}/research/runs`, { mode: 'wide', question: 'How do small volunteer programmes confirm capacity?', topics: ['volunteer management'] })).id;
    await drain();
    const r = ok(await editor.get(`/projects/${demo}/research`));
    const run = r.runs.find((x: any) => x.id === id);
    expect(run.status).toBe('ready_for_review');
    expect(run.result.synthetic).toBe(true);
    expect(run.result.citations[0]).toMatchObject({ url: expect.stringMatching(/^https:/), excerpt: expect.any(String), retrievedAt: expect.any(String) });
    expect(run.result.coverage).toContain('capacity');
    expect(run.result.followUpQuestions.length).toBeGreaterThan(0);
    const mine = r.candidates.filter((c: any) => c.runId === id);
    expect(mine.map((c: any) => [c.payload.kind, c.status, c.origin])).toEqual([['assessment', 'pending', 'fixture'], ['note', 'pending', 'fixture']]);
    expect(ok(await editor.get(`/projects/${demo}/evidence`)).opportunities.some((o: any) => o.title === 'Shared capacity board')).toBe(false); // nothing applied yet
    const acc = ok(await editor.post(`/projects/${demo}/candidates/${mine[0].id}/accept`));
    expect(acc.applied.kind).toBe('opportunity');
  });

  it('deep run sends only approved excerpts and returns candidates, a contradiction and a measurement gap', async () => {
    const hidden = ok(await editor.post(`/projects/${demo}/c/notes`, { text: 'Not approved for agents', targetId: 'e2' })).doc;
    const refused = await editor.post(`/projects/${demo}/research/runs`, { mode: 'deep', question: 'Why do placements wait?', noteIds: ['t1', hidden.id] });
    expect(refused.status).toBe(422);
    expect(refused.json.error).toContain('not approved for agent use');
    const id = ok(await editor.post(`/projects/${demo}/research/runs`, { mode: 'deep', question: 'Why do placements wait?', noteIds: ['t1', 't2'] })).id;
    await drain();
    const r = ok(await editor.get(`/projects/${demo}/research`));
    const run = r.runs.find((x: any) => x.id === id);
    expect(run.status).toBe('ready_for_review');
    expect(run.input.revisionId).toBe(r.baselineRevisionId);
    const kinds = r.candidates.filter((c: any) => c.runId === id).map((c: any) => c.payload.kind);
    expect(kinds).toEqual(['note', 'activity', 'contradiction', 'measurement_target']);
    expect(JSON.stringify(r.candidates.filter((c: any) => c.runId === id))).not.toContain('Not approved for agents');
  });

  it('handles invalid output, timeout, cancellation, retry and restart', async () => {
    const start = (q: string) => editor.post(`/projects/${demo}/research/runs`, { mode: 'wide', question: q }).then((r) => ok(r).id as string);
    const status = async (id: string) => ok(await editor.get(`/projects/${demo}/research`)).runs.find((x: any) => x.id === id);
    const before = ok(await editor.get(`/projects/${demo}/research`)).candidates.length;

    const invalid = await start('Scan practice [invalid]'); await drain();
    expect(await status(invalid)).toMatchObject({ status: 'failed', error: expect.stringContaining('does not match the expected shape') });

    const timeout = await start('Scan practice [timeout]'); await drain(); // budget is 2 seconds in tests
    expect(await status(timeout)).toMatchObject({ status: 'failed', error: expect.stringContaining('time budget') });

    const flaky = await start('Scan practice [fail-once]'); await drain();
    expect(await status(flaky)).toMatchObject({ status: 'ready_for_review', attempts: 2 });

    const dead = await start('Scan practice [fail]'); await drain();
    expect(await status(dead)).toMatchObject({ status: 'failed', attempts: 2, error: expect.stringContaining('after 2 attempts') });

    const queued = await start('Scan practice, cancel while queued');
    ok(await editor.post(`/projects/${demo}/research/runs/${queued}/cancel`));
    await drain();
    expect((await status(queued)).status).toBe('cancelled');
    ok(await editor.post(`/projects/${demo}/research/runs/${queued}/retry`)); await drain();
    expect((await status(queued)).status).toBe('ready_for_review');

    const slow = await start('Scan practice [timeout] cancel while running');
    const running = runOnce();
    await new Promise((r) => setTimeout(r, 300));
    ok(await editor.post(`/projects/${demo}/research/runs/${slow}/cancel`));
    await running;
    expect((await status(slow)).status).toBe('cancelled');

    // restart: a job left "running" by a dead process is picked up again once its lease has expired
    const orphan = await start('Scan practice after restart');
    await pool.query(`UPDATE research_runs SET status = 'running', attempts = 1, lease_until = now() - interval '1 minute' WHERE project_id = $1 AND id = $2`, [demo, orphan]);
    await drain();
    expect(await status(orphan)).toMatchObject({ status: 'ready_for_review', attempts: 2 });

    const failures = [invalid, timeout, dead, slow];
    const all = ok(await editor.get(`/projects/${demo}/research`)).candidates;
    expect(all.filter((c: any) => failures.includes(c.runId))).toHaveLength(0);
    expect(all.length).toBe(before + 6); // three successful wide runs, two candidates each
  });

  it('exports and reimports a workspace with scenarios and candidate decisions intact', async () => {
    const res = await owner.get(`/projects/${demo}/export/workspace.json`);
    const bundle = JSON.parse(await res.res.text());
    expect(validateBundle(bundle).issues).toEqual([]);
    const id = ok(await owner.post('/import', { data: bundle, name: 'Round trip' })).id;
    const again = JSON.parse(await (await owner.get(`/projects/${id}/export/workspace.json`)).res.text());
    const strip = (b: any) => ({ ...b, exportedAt: '', project: { ...b.project, name: '' }, branches: b.branches.map((x: any) => ({ ...x, createdAt: '' })), revisions: b.revisions.map((x: any) => ({ ...x, author: '' })) });
    expect(strip(again)).toEqual(strip(bundle));
    expect(again.branches.filter((b: any) => b.kind === 'scenario').map((b: any) => [b.name, b.baseRevisionId])).toEqual(bundle.branches.filter((b: any) => b.kind === 'scenario').map((b: any) => [b.name, b.baseRevisionId]));
    expect(again.candidates.filter((c: any) => c.status === 'accepted').length).toBeGreaterThanOrEqual(3);
    expect(again.notes.find((n: any) => n.id === 't1').targetId).toBe('e2');
  });
});
