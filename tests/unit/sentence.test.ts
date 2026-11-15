import { describe, expect, it } from 'vitest';
import { describeEdge } from '../../src/shared/sentence';
import { act, fixtureModel } from './helpers';

const edge = (m: ReturnType<typeof fixtureModel>, id: string) => m.edges.find((e) => e.id === id)!;

describe('connection sentence', () => {
  it('produces the spec example for Triage application (receiver performs)', () => {
    const m = fixtureModel();
    const d = describeEdge(m, edge(m, 'e2'));
    expect(d.sentence).toBe('The application moves from Application form to Coordinator, who reviews it and changes its state from submitted to ready for placement.');
    expect(d.performer).toBe('Coordinator');
    expect(d.performerRelation).toBe('receiver');
    expect(d.segments.filter((s) => s.type === 'actor').map((s) => s.text)).toEqual(['Application form', 'Coordinator']);
    expect(d.segments.filter((s) => s.type === 'state').map((s) => s.text)).toEqual(['submitted', 'ready for placement']);
    expect(d.segments.find((s) => s.type === 'action')!.text).toBe('reviews');
    expect(d.segments.find((s) => s.type === 'item')!.text).toBe('application');
  });
  it('sender performer', () => {
    const m = fixtureModel();
    expect(describeEdge(m, edge(m, 'e1')).sentence).toBe('Volunteer submits the application to Application form, changing its state from draft to submitted.');
    expect(describeEdge(m, edge(m, 'e3')).performerRelation).toBe('sender');
  });
  it('third-party performer is named explicitly and never inferred from direction', () => {
    const m = fixtureModel();
    act(m, 'e2').performerId = 'n4';
    const d = describeEdge(m, edge(m, 'e2'));
    expect(d.performerRelation).toBe('third_party');
    expect(d.sentence).toBe('The application moves from Application form to Coordinator. Program lead reviews the application and changes its state from submitted to ready for placement.');
  });
  it('a missing performer stays unknown', () => {
    const m = fixtureModel();
    const d = describeEdge(m, edge(m, 'e4'));
    expect(d.performer).toBeNull();
    expect(d.performerRelation).toBe('unknown');
    expect(d.sentence).toContain('is not identified');
    expect(d.unknowns).toContain('Activity performer not identified');
    expect(d.segments.some((s) => s.type === 'unknown')).toBe(true);
  });
  it('updates when action, result and state change', () => {
    const m = fixtureModel();
    act(m, 'e2').actionCode = 'approve';
    edge(m, 'e2').outputState = 'approved';
    edge(m, 'e2').inputState = 'screened';
    expect(describeEdge(m, edge(m, 'e2')).sentence).toBe('The application moves from Application form to Coordinator, who approves it and changes its state from screened to approved.');
    edge(m, 'e2').inputState = ''; edge(m, 'e2').outputState = ''; edge(m, 'e2').result = 'Shortlist';
    expect(describeEdge(m, edge(m, 'e2')).sentence).toBe('The application moves from Application form to Coordinator, who approves it, producing the shortlist.');
  });
  it('non-operational types have their own grammar', () => {
    const m = fixtureModel();
    expect(describeEdge(m, edge(m, 'e6')).sentence).toMatch(/^Placement board requires the program capacity from Program lead\./);
    expect(describeEdge(m, edge(m, 'e5')).sentence).toBe('Coordinator sends the capacity request to Program lead.');
  });
});
