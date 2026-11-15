import { describe, expect, it } from 'vitest';
import { convertLegacy, parseImport } from '../../src/shared/legacy';
import { validateBundle } from '../../src/shared/workspace';
import { loadFixture } from './helpers';

describe('legacy v0.7 import', () => {
  it('imports the bundled fixture: 6 nodes, 6 edges, 3 linked notes, preserved IDs and positions', () => {
    const r = convertLegacy(loadFixture());
    expect(r.issues).toEqual([]);
    const b = r.bundle!;
    const model = b.revisions[0].model;
    expect(model.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    expect(model.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    expect(model.activities.map((a) => a.id)).toEqual(['a-e1', 'a-e2', 'a-e3', 'a-e4', 'a-e5']);
    expect(b.notes.map((n) => [n.id, n.targetId])).toEqual([['t1', 'e2'], ['t2', 'e3'], ['t3', 'e5']]);
    expect(b.links.map((l) => [l.fromId, l.toId, l.relation])).toEqual([['t3', 't1', 'related'], ['t3', 't2', 'related']]);
    expect(b.branches[0].layout.n4).toEqual({ x: 854, y: 95 });
    expect(model.nodes.find((n) => n.id === 'n1')!.scope).toBe('external');
    expect(b.sources.map((s) => s.anonId)).toEqual(['Illustrative interview 01', 'Illustrative interview 02', 'Working hypothesis · unverified']);
    expect(model.volume).toMatchObject({ value: 80, basis: 'unverified' });
  });
  it('reports records that need a decision', () => {
    const r = convertLegacy(loadFixture());
    const kinds = r.decisions.map((d) => `${d.kind}:${d.recordId}`);
    expect(kinds).toContain('unattached-timing:e6'); // dependency with defaulted 0 minutes, never counted
    expect(kinds).toContain('defaulted-zero:e1'); // waitHours 0 with no basis
    const f = loadFixture();
    f.base.edges[2].minutes = 30; // disagrees with activity a-e3 (22)
    const c = convertLegacy(f);
    expect(c.decisions.find((d) => d.kind === 'timing-conflict')!.recordId).toBe('e3');
    expect(c.bundle!.revisions[0].model.activities.find((a) => a.id === 'a-e3')!.activeMinutes.value).toBe(22);
  });
  it('rejects dangling references, duplicate IDs, malformed records and non-finite numbers', () => {
    const cases: [string, (f: any) => void, RegExp][] = [
      ['dangling edge', (f) => { f.base.edges[0].to = 'nX'; }, /destination "nX" does not exist/],
      ['dangling note target', (f) => { f.base.notes[0].target = 'e99'; }, /target "e99" does not exist/],
      ['dangling note link', (f) => { f.base.notes[2].relations[0].targetId = 't9'; }, /linked note "t9"/],
      ['duplicate id', (f) => { f.base.nodes[1].id = 'n1'; }, /duplicate ID "n1"/],
      ['malformed', (f) => { f.base.nodes[0] = 'nope'; }, /malformed record/],
      ['non-finite', (f) => { f.base.activities[2].minutes = Infinity; }, /not a finite number/],
      ['non-numeric', (f) => { f.base.volume = 'many'; }, /not a finite number/],
      ['negative', (f) => { f.base.activities[0].minutes = -4; }, /must not be negative/],
      ['bad type', (f) => { f.base.edges[0].kind = 'teleport'; }, /unknown connection type/],
      ['wrong version', (f) => { f.exportVersion = 1; }, /not supported/],
    ];
    for (const [name, mutate, re] of cases) {
      const f = loadFixture(); mutate(f);
      const r = convertLegacy(f);
      expect(r.bundle, name).toBeUndefined();
      expect(r.issues.map((i) => i.message).join(' | '), name).toMatch(re);
    }
    expect(convertLegacy(JSON.parse('{"format":"weave-operational-model","exportVersion":2,"base":{"volume":1e999,"nodes":[],"edges":[],"notes":[]},"scenarios":[]}')).bundle).toBeUndefined();
  });
  it('imports legacy scenarios with their own pinned snapshot', () => {
    const f = loadFixture();
    const snap = structuredClone(f.base);
    const model = structuredClone(f.base);
    model.edges[2].minutes = 10; model.activities[2].minutes = 10;
    f.scenarios = [{ id: 'scenario-a', name: 'Faster matching', parentId: null, baseVersion: 1, baselineSnapshot: snap, created: '2026-11-01T00:00:00.000Z', model, assessment: { humanEffects: 'Less chasing', unknowns: 'Real duration', validation: 'Time ten cases' } }];
    f.base.volume = 90; // baseline moved on after the branch was taken
    const r = convertLegacy(f);
    expect(r.issues).toEqual([]);
    const b = r.bundle!;
    const sc = b.branches.find((x) => x.id === 'scenario-a')!;
    expect(sc.baseRevisionId).toBe('rev-scenario-a-base');
    expect(b.revisions.find((x) => x.id === sc.baseRevisionId)!.model.volume.value).toBe(80);
    expect(b.revisions.find((x) => x.id === b.branches[0].headRevisionId)!.model.volume.value).toBe(90);
    const head = b.revisions.find((x) => x.id === sc.headRevisionId)!.model;
    expect(head.activities.find((a) => a.id === 'a-e3')!.activeMinutes.value).toBe(10);
    expect(head.assessment.validation).toBe('Time ten cases');
  });
  it('round-trips through the native format', () => {
    const b = convertLegacy(loadFixture()).bundle!;
    const again = parseImport(JSON.parse(JSON.stringify(b)));
    expect(again.kind).toBe('native');
    expect(again.issues).toEqual([]);
    expect(again.bundle).toEqual(b);
    const broken = JSON.parse(JSON.stringify(b)); broken.notes[0].sourceId = 'src-404';
    expect(validateBundle(broken).issues[0].message).toContain('does not exist');
  });
});
