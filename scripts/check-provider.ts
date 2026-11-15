// Optional real-provider check. Needs RESEARCH_PROVIDER=anthropic and ANTHROPIC_API_KEY. Uses synthetic input only.
import { providerStatus, getProvider } from '../src/server/providers';
import { deepOutputSchema, wideOutputSchema } from '../src/server/providers/types';
import { parseCandidateBundle, checkCandidateRefs } from '../src/shared/candidates';
import { demoBundle } from '../src/server/demo';

const status = providerStatus();
if (!status.available || status.synthetic) { console.log(`SKIPPED: ${status.label}. ${status.reason || 'Set RESEARCH_PROVIDER=anthropic and ANTHROPIC_API_KEY to run this check.'}`); process.exit(0); }
const provider = getProvider()!;
const b = demoBundle();
const model = b.revisions[0].model;
const ctx = { signal: AbortSignal.timeout(280_000), attempt: 1 };
const scope = `${b.project.name} — ${b.project.scopeDescription}`;
let failed = false;
const report = (name: string, ok: boolean, detail: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`); if (!ok) failed = true; };

const wide = wideOutputSchema.safeParse(await provider.runWide({ question: 'How do small volunteer programmes confirm placement capacity between coordinators and program leads?', scope, topics: ['volunteer management'], maxSearches: 3 }, ctx));
report('wide output shape', wide.success, wide.success ? `${wide.data.citations.length} citations, ${wide.data.followUpQuestions.length} follow-up questions` : JSON.stringify(wide.error.issues.slice(0, 3)));
if (wide.success) { const c = parseCandidateBundle(wide.data.candidates); report('wide candidates validate', !c.issues.length, c.issues.length ? JSON.stringify(c.issues.slice(0, 3)) : `${c.candidates.length} candidates`); }

const deep = deepOutputSchema.safeParse(await provider.runDeep({ question: 'Why might placements wait, and what would show that explanation is wrong?', scope, insight: null, revisionId: b.revisions[0].id,
  notes: b.notes.filter((n) => n.excerptApproved).map((n) => ({ id: n.id, sourceId: b.sources.find((s) => s.id === n.sourceId)?.anonId ?? 'Unattributed', kind: n.kind, text: n.text, targetId: n.targetId })),
  model: { nodes: model.nodes.map(({ id, kind, label }) => ({ id, kind, label })), edges: model.edges.map(({ id, from, to, type, label }) => ({ id, from, to, type, label })), activities: model.activities.map(({ id, edgeId, label }) => ({ id, edgeId, label })) } }, ctx));
report('deep output shape', deep.success, deep.success ? deep.data.summary.slice(0, 80) : JSON.stringify(deep.error.issues.slice(0, 3)));
if (deep.success) {
  const c = parseCandidateBundle(deep.data.candidates);
  report('deep candidates validate', !c.issues.length, c.issues.length ? JSON.stringify(c.issues.slice(0, 3)) : `${c.candidates.length} candidates (${[...new Set(c.candidates.map((x) => x.kind))].join(', ')})`);
  const refs = c.candidates.flatMap((x) => checkCandidateRefs(x, model));
  report('deep candidates reference real model IDs', !refs.length, refs.slice(0, 3).join('; ') || 'all references resolve');
}
process.exit(failed ? 1 : 0);
