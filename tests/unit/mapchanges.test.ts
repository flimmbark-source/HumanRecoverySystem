import { describe, expect, it } from 'vitest';
import { applyChanges, blocked, checkChanges, mapForPrompt, proposeWithClaude, type RawChange } from '../../src/shared/mapchanges';
import { fixtureModel } from './helpers';

const blank: RawChange = { op: 'add_node', ref: '', target: '', kind: '', label: '', role: '', scope: '', parent: '', from: '', to: '', edge_type: '', work_item: '', result: '', performer: '', description: '', active_minutes: null, wait_minutes: null, timing_basis: '', basis: [], why: '' };
const ch = (x: Partial<RawChange>): RawChange => ({ ...blank, ...x });
const notes = new Set(['t1', 't2']);

describe('checking proposed map changes', () => {
  const m = fixtureModel();
  it('describes changes, keeps only known notes, and marks the impossible ones unticked', () => {
    const out = checkChanges(m, [
      ch({ op: 'add_node', ref: 'new:1', kind: 'person', label: 'Applicant', basis: ['t1', 'zz'] }),
      ch({ op: 'add_edge', from: 'n3', to: 'new:1', edge_type: 'info', label: 'Phone call', basis: ['t1'] }),
      ch({ op: 'add_edge', from: 'n3', to: 'nowhere', edge_type: 'flow', label: 'X', basis: ['t1'] }),
      ch({ op: 'add_node', ref: 'new:2', kind: 'person', label: 'Coordinator', basis: ['t2'] }),
      ch({ op: 'set_timing', target: 'e3', active_minutes: 20, timing_basis: 'reported', basis: ['t2'] }),
      ch({ op: 'remove', target: 'e1', basis: ['t2'] }),
      ch({ op: 'update_node', target: 'n3', role: 'Placement coordinator', basis: [] }),
    ], notes);
    expect(out.map((c) => [c.title, c.on, !!c.problem])).toEqual([
      ['New person / role: Applicant', true, false],
      ['New information connection: Coordinator → Applicant, “Phone call”', true, false],
      ['New work flow connection: Coordinator → ?, “X”', false, true],
      ['New person / role: Coordinator', false, true],
      ['Timing of Find a placement: 20 min active (reported)', true, false],
      [expect.stringMatching(/^Remove /), false, false],
      ['Change Coordinator: role “Placement coordinator”', false, true],
    ]);
    expect(out[0].basis).toEqual(['t1']);
    expect(out[3].problem).toContain('already on the map');
    expect(out[6].problem).toContain('cites no note');
  });
  it('holds back what depends on an unticked new box', () => {
    const out = checkChanges(m, [ch({ op: 'add_node', ref: 'new:1', kind: 'person', label: 'Applicant', basis: ['t1'] }), ch({ op: 'add_edge', from: 'n3', to: 'new:1', edge_type: 'info', label: 'Call', basis: ['t1'] })], notes);
    out[0].on = false;
    expect(blocked(out)).toEqual(new Set([out[1].key]));
  });
});

describe('applying accepted changes to a copy of the map', () => {
  it('adds boxes, connections with activities, members, timings and basis; places new boxes clear of others', () => {
    const m = fixtureModel(), layout = Object.fromEntries(m.nodes.map((n, i) => [n.id, { x: 200 + i * 300, y: 300 }]));
    const changes = checkChanges(m, [
      ch({ op: 'add_edge', from: 'n3', to: 'new:1', edge_type: 'info', label: 'Phone call', performer: 'n3', active_minutes: 10, timing_basis: 'reported', basis: ['t1'] }),
      ch({ op: 'add_node', ref: 'new:1', kind: 'person', label: 'Applicant', basis: ['t1'] }),
      ch({ op: 'add_node', ref: 'new:g', kind: 'group', label: 'Placement team', basis: ['t2'] }),
      ch({ op: 'update_node', target: 'n3', parent: 'new:g', basis: ['t2'] }),
      ch({ op: 'set_timing', target: 'e3', active_minutes: 20, timing_basis: 'measured', basis: ['t2'] }),
    ], notes);
    const r = applyChanges(m, layout, changes);
    expect(r.applied).toBe(5);
    const applicant = r.model.nodes.find((n) => n.label === 'Applicant')!, team = r.model.nodes.find((n) => n.label === 'Placement team')!;
    expect(applicant.basis).toEqual(['t1']);
    const call = r.model.edges.find((e) => e.label === 'Phone call')!;
    expect(call).toMatchObject({ from: 'n3', to: applicant.id, type: 'info', basis: ['t1'] });
    expect(r.model.activities.find((a) => a.edgeId === call.id)).toMatchObject({ performerId: 'n3', activeMinutes: { value: 10, basis: 'reported' } });
    expect(r.model.nodes.find((n) => n.id === 'n3')).toMatchObject({ parentId: team.id, basis: ['t2'] });
    expect(r.model.activities.find((a) => a.edgeId === 'e3')!.activeMinutes).toMatchObject({ value: 20, basis: 'measured' });
    for (const n of r.model.nodes) for (const o of r.model.nodes) if (n.id < o.id) expect(Math.abs(r.layout[n.id].x - r.layout[o.id].x) >= 250 || Math.abs(r.layout[n.id].y - r.layout[o.id].y) >= 130).toBe(true);
    // the input map is untouched
    expect(m.nodes.some((n) => n.label === 'Applicant')).toBe(false);
  });
  it('removes an item with what hangs on it, and the result is a valid map', async () => {
    const m = fixtureModel();
    const r = applyChanges(m, {}, checkChanges(m, [ch({ op: 'remove', target: 'n3', basis: ['t1'] })], notes).map((c) => ({ ...c, on: true })));
    expect(r.model.nodes.some((n) => n.id === 'n3')).toBe(false);
    expect(r.model.edges.some((e) => e.from === 'n3' || e.to === 'n3')).toBe(false);
    expect(r.model.activities.some((a) => a.performerId === 'n3' || a.ownerNodeId === 'n3')).toBe(false);
    const { validateModel } = await import('../../src/shared/model');
    expect(validateModel(r.model).issues).toEqual([]);
  });
});

describe('asking Claude', () => {
  it('sends the map and the notes, asks for structured changes and validates them', async () => {
    const calls: any[] = [];
    const reply = { changes: [ch({ op: 'add_node', ref: 'new:1', kind: 'person', label: 'Applicant', basis: ['t1'], why: 'Seen.' })] };
    const client = { beta: { messages: { stream: (p: any) => { calls.push(p); return { finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }] }) }; } } } } as any;
    const m = fixtureModel();
    const out = await proposeWithClaude(client, m, [{ id: 't1', kind: 'observation', certainty: 'observed', source: 'Interview 1', placedOn: 'not placed', text: 'I watched the call.' }]);
    expect(out).toHaveLength(1);
    expect(calls[0].output_config.format.type).toBe('json_schema');
    expect(calls[0].messages[0].content[0].text).toContain('t1 | observation | observed | Interview 1');
    expect(mapForPrompt(m)).toContain('n3 | person | Coordinator');
  });
});
