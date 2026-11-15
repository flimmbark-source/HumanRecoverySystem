// Deterministic synthetic provider for demos and tests. Its output is invented and is labelled as such everywhere.
// Bracketed markers in the question exercise failure paths: [invalid] [timeout] [slow] [fail-once] [fail].
import type { DeepInput, ProviderContext, ResearchProvider, WideInput } from './types';

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
});
async function hooks(question: string, ctx: ProviderContext) {
  if (question.includes('[timeout]')) await wait(3_600_000, ctx.signal);
  if (question.includes('[slow]')) await wait(4000, ctx.signal);
  if (question.includes('[fail]')) throw new Error('Synthetic provider failure');
  if (question.includes('[fail-once]') && ctx.attempt === 1) throw new Error('Synthetic transient failure');
}
const today = () => new Date().toISOString().slice(0, 10);

export const fixtureProvider: ResearchProvider = {
  id: 'fixture', label: 'Fixture provider · synthetic output, not real research', synthetic: true,

  async runWide(input: WideInput, ctx) {
    await hooks(input.question, ctx);
    if (input.question.includes('[invalid]')) return { summary: 'missing everything else' };
    return {
      summary: `Synthetic scan for “${input.question.replace(/\[[a-z-]+\]/g, '').trim()}”. Volunteer-management platforms commonly cover intake and scheduling; live capacity confirmation between roles is usually handled by convention rather than tooling.`,
      coverage: 'Existing tools cover application intake and status notification. None of the synthetic sources shows coverage of the capacity check between a coordinator and a program lead, which is where the observed workflow waits.',
      citations: [
        { url: 'https://example.org/synthetic/volunteer-platform-overview', title: 'Synthetic source: volunteer platform overview', retrievedAt: today(), excerpt: 'Placements are confirmed once a program lead marks capacity as available.', covers: 'Intake form, placement status, notifications.', fallsShort: 'No evidence about how capacity is confirmed in small teams.' },
        { url: 'https://example.org/synthetic/practice-note-capacity', title: 'Synthetic source: practice note on shared capacity boards', retrievedAt: today(), excerpt: 'A shared weekly capacity board reduced ad-hoc availability requests in one described case.', covers: 'A process change using an existing shared board.', fallsShort: 'Single described case; no baseline or sample size.' },
      ],
      followUpQuestions: ['How often does a placement wait on a capacity answer, and for how long?', 'Would program leads keep a shared capacity board current, and what would that cost them?'],
      gapsToCheckWithParticipants: ['Whether applicants experience the wait as a problem or as expected.'],
      candidates: { format: 'weave-research-candidates', version: 2, candidates: [
        { kind: 'assessment', summary: 'Test an existing shared capacity board before considering a new tool', sourceId: 'Synthetic public scan', basis: 'A shared weekly capacity board reduced ad-hoc availability requests in one described case.', certainty: 'reported', sourceUrl: 'https://example.org/synthetic/practice-note-capacity', retrievedAt: today(), recommendation: 'test_existing', reason: 'An existing shared board appears to cover the capacity check with little change to current roles.', coverage: 'Covers how capacity updates travel from program leads to the coordinator.', fitGaps: 'Does not cover applicant-facing status updates.', uncertainty: 'One synthetic case; fit with this workflow is untested.', optionLabel: 'Shared capacity board' },
        { kind: 'note', summary: 'Open question raised by the public scan', sourceId: 'Synthetic public scan', basis: 'No evidence about how capacity is confirmed in small teams.', certainty: 'inferred', noteType: 'question', text: 'How often does a placement wait on a capacity answer, and for how long?' },
      ] },
    };
  },

  async runDeep(input: DeepInput, ctx) {
    await hooks(input.question, ctx);
    if (input.question.includes('[invalid]')) return { summary: 'Bad bundle', candidates: { format: 'weave-research-candidates', version: 1, candidates: [{ kind: 'note', summary: 'no basis or source' }] } };
    const m = input.model as { nodes?: { id: string; kind: string }[]; edges?: { id: string; type: string; from: string; to: string }[] };
    const edges = m.edges ?? [], nodes = m.nodes ?? [];
    const target = input.notes.find((n) => n.targetId)?.targetId ?? edges.find((e) => e.type === 'flow')?.id;
    const person = nodes.find((n) => n.kind === 'person' && edges.some((e) => e.to === n.id)) ?? nodes[0];
    const src = (i: number) => input.notes[i]?.sourceId ?? 'Synthetic source';
    const candidates: Record<string, unknown>[] = [];
    if (input.notes[0]) candidates.push({ kind: 'note', summary: 'Observation restated from an approved excerpt', sourceId: src(0), basis: input.notes[0].text.slice(0, 300), certainty: 'reported', noteType: 'observation', text: `Synthetic extraction: ${input.notes[0].text.slice(0, 200)}`, ...(target ? { targetId: target } : {}) });
    if (person) candidates.push({ kind: 'activity', summary: 'Possible internal task that needs validation', sourceId: src(0), basis: 'Synthetic inference from the approved excerpts; not observed.', certainty: 'inferred', ownerId: person.id, label: 'Review incoming follow-up requests', minutes: null });
    candidates.push({ kind: 'contradiction', summary: 'Accounts disagree about who chases a placement update', sourceId: src(0), basis: 'Two synthetic accounts describe the same step differently.', certainty: 'reported', text: 'One account says the applicant asks for an update; another says the coordinator follows up first. Keep both until observed.', accounts: [{ sourceId: src(0), claim: 'The applicant requests the update.' }, { sourceId: src(1), claim: 'The coordinator follows up before being asked.' }], ...(target ? { targetId: target } : {}), ...(input.notes.length > 1 ? { noteIds: input.notes.slice(0, 2).map((n) => n.id) } : {}) });
    candidates.push({ kind: 'measurement_target', summary: 'Waiting time between submission and triage is unmeasured', sourceId: 'Synthetic research plan', basis: 'The model has no measured waiting-time distribution for this handoff.', certainty: 'inferred', text: 'Record submission and triage timestamps for the next 20 cases to measure the wait.', metric: 'Hours from submission to triage', method: 'Timestamp sample of 20 consecutive cases', ...(target ? { targetId: target } : {}) });
    return {
      summary: `Synthetic deep pass over ${input.notes.length} approved excerpt${input.notes.length === 1 ? '' : 's'} against revision ${input.revisionId}.`,
      followUpQuestions: ['What would show that capacity updates are not the cause of the delay?'],
      candidates: { format: 'weave-research-candidates', version: 2, candidates },
    };
  },
};
