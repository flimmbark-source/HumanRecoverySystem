import { describe, expect, it } from 'vitest';
import { itemFacts, suggestSupport } from '../../src/shared/evidence';
import { insightSchema, type Note } from '../../src/shared/workspace';
import { fixtureModel } from './helpers';

const note = (id: string, text: string) => ({ id, text }) as Note;

describe('details and suggested support for insights', () => {
  it('lists the details of a connection, with timing from its activity, and leaves out empty fields', () => {
    const m = fixtureModel();
    const f = itemFacts(m, 'e3')!;
    expect(f).toMatchObject({ type: 'edge', name: 'Find a placement' });
    expect(f.facts.find((x) => x.key === 'waiting')?.value).toBe('120 min');
    expect(f.facts.every((x) => x.value.trim())).toBe(true);
    expect(itemFacts(m, 'n3')).toMatchObject({ type: 'node', name: 'Coordinator' });
    expect(itemFacts(m, 'not-there')).toBeNull();
    // a detail picked earlier stays listable after its field is emptied
    const emptied = { ...m, edges: m.edges.map((e) => (e.id === 'e3' ? { ...e, exceptions: '' } : e)) };
    expect(itemFacts(emptied, 'e3')!.facts.some((x) => x.key === 'exceptions')).toBe(false);
    expect(itemFacts(emptied, 'e3', true)!.facts.find((x) => x.key === 'exceptions')).toMatchObject({ value: '' });
  });

  it('suggests notes and map items that share words, says which words, and skips what is already linked', () => {
    const m = fixtureModel();
    const notes = [note('a', 'Capacity updates travel slowly between roles'), note('b', 'The form is short'), note('c', 'Capacity is checked by phone')];
    const all = suggestSupport('Placements wait on capacity answers', notes, m, new Set(), new Set());
    expect(all.find((s) => s.id === 'a')?.matched).toEqual(['capacity']);
    expect(all.some((s) => s.id === 'b')).toBe(false);
    expect(all.some((s) => s.type === 'item')).toBe(true);
    const linkedItems = new Set(all.filter((s) => s.type === 'item').map((s) => s.id));
    const rest = suggestSupport('Placements wait on capacity answers', notes, m, new Set(['a']), linkedItems);
    expect(rest.some((s) => s.id === 'a' || linkedItems.has(s.id))).toBe(false);
    expect(rest.some((s) => s.id === 'c')).toBe(true);
    expect(suggestSupport('the and of', notes, m, new Set(), new Set())).toEqual([]);
  });
});

describe('insight details saved with their card', () => {
  it('stores record fields and notes under the map item they were picked on', () => {
    const note = `note:${'n'.repeat(64)}`;
    const ok = insightSchema.safeParse({ id: 'i1', title: '', body: 'x', modelLinks: ['e3'], focus: { e3: ['waiting', note] }, createdAt: 'now', updatedAt: 'now' });
    expect(ok.success).toBe(true);
    expect(insightSchema.safeParse({ id: 'i1', title: '', body: 'x', focus: { 'not an id!': ['waiting'] }, createdAt: 'now', updatedAt: 'now' }).success).toBe(false);
  });
});
