import { describe, expect, it } from 'vitest';
import { exampleBundle } from '../../src/server/example';
import { checkCandidateRefs, parseCandidateBundle } from '../../src/shared/candidates';
import { decisionHeading, evidenceForOpportunity } from '../../src/shared/evidence';
import { compare, computeEffort, computeElapsed } from '../../src/shared/impact';
import { placeLabels } from '../../src/shared/layout';

// exampleBundle() validates the whole workspace and throws on any issue, so building it is the first check.
const b = exampleBundle();
const model = (revisionId: string) => b.revisions.find((r) => r.id === revisionId)!.model;

describe('the worked example', () => {
  it('keeps the exact words and place of each note saved from the archive', () => {
    const archived = b.notes.filter((n) => n.origin);
    expect(archived.length).toBeGreaterThan(0);
    for (const n of archived) expect(b.imports.find((i) => i.id === n.origin!.importId)!.text.slice(n.origin!.start, n.origin!.end)).toBe(n.text);
    for (const i of b.imports) expect(i.noteCount).toBe(archived.filter((n) => n.origin!.importId === i.id).length);
  });

  it('has complete headline figures, playable routes, and a scenario that changes them', () => {
    const base = model('rev-2');
    const effort = computeEffort(base);
    expect([effort.perCase.status, effort.perCase.value, effort.monthly.value]).toEqual(['complete', 186, (186 * 46) / 60]);
    for (const r of base.routes) expect(computeElapsed(base, r.id)!.analysis.playable).toBe(true);
    const c = compare(base, model('rev-sc-huddle-2'), 'r-self');
    expect(c.atCommonVolume.value).toBeCloseTo(-11.5);
    expect(c.elapsed!.value).toBe(-2176);
  });

  it('shows each decision state, fits its labels on the map, and its findings fit the map they were made against', () => {
    expect(b.opportunities.map((o) => decisionHeading(o, b.options.find((x) => x.id === o.recommendedOptionId), evidenceForOpportunity(o, b.notes, b.links))))
      .toEqual(['Recommendation', 'Hypothesis to test', 'Opportunity under exploration', 'Closed']);
    for (const br of b.branches) expect([...placeLabels(model(br.headRevisionId), br.layout).values()].filter((l) => l.collided).map((l) => l.edgeId)).toEqual([]);
    const parsed = parseCandidateBundle({ format: 'weave-research-candidates', version: 2, candidates: b.candidates.map((c) => c.payload) });
    expect(parsed.issues).toEqual([]);
    expect(parsed.candidates.flatMap((c) => checkCandidateRefs(c, model('rev-2')))).toEqual([]);
  });
});
