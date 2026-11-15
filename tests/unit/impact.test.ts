import { describe, expect, it } from 'vitest';
import { compare, computeEffort, computeElapsed, computeFinancial } from '../../src/shared/impact';
import { qty, unknownQty } from '../../src/shared/model';
import { act, fixtureModel } from './helpers';

describe('calculation fixtures (ACCEPTANCE.md)', () => {
  it('v0.7 baseline: 63 min/case, 84 h/month, route 51 active + 120 waiting = 171', () => {
    const m = fixtureModel();
    const e = computeEffort(m);
    expect(e.perCase.value).toBe(63);
    expect(e.monthly.value).toBe(84);
    expect(e.volume).toBe(80);
    expect(e.monthly.basis).toEqual(['unverified']); // sample inputs stay tagged
    const r = computeElapsed(m, 'r-main')!;
    expect(r.analysis.steps.map((s) => s.refId)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(r.active.value).toBe(51);
    expect(r.waiting.value).toBe(120);
    expect(r.elapsed.value).toBe(171);
    // e5 is counted in workload but is not on the route; it is flagged as a side link
    expect(r.analysis.sideLinks.map((l) => l.edgeId)).toContain('e5');
    expect(e.contributions.find((c) => c.edgeId === 'e5')!.perCase).toBe(12);
  });

  it('same volume: e3 22 → 10 gives 51 min/case, 68 h/month, 16 h released, route 159; cash unknown', () => {
    const base = fixtureModel(), s = fixtureModel();
    act(s, 'e3').activeMinutes.value = 10;
    const c = compare(base, s, 'r-main');
    expect(c.scenario.effort.perCase.value).toBe(51);
    expect(c.scenario.effort.monthly.value).toBe(68);
    expect(c.atCommonVolume.value).toBe(-16);
    expect(c.atModeledVolumes.value).toBe(-16);
    expect(c.scenario.elapsed!.elapsed.value).toBe(159);
    expect(c.elapsed!.value).toBe(-12);
    expect(c.financial.netRecurring.value).toBeNull();
    expect(c.financial.netRecurring.status).toBe('unknown');
    expect(c.unverifiedInputs).toBe(true);
  });

  it('changed volume: 100 cases gives 85 h vs 84 h (+1) and −16 h at the common volume of 80', () => {
    const base = fixtureModel(), s = fixtureModel();
    act(s, 'e3').activeMinutes.value = 10;
    s.volume.value = 100;
    const c = compare(base, s, 'r-main');
    expect(c.scenario.effort.monthly.value).toBe(85);
    expect(c.base.effort.monthly.value).toBe(84);
    expect(c.atModeledVolumes.value).toBe(1);
    expect(c.atModeledVolumes.denominator).toContain('100 cases/month');
    expect(c.atCommonVolume.value).toBe(-16);
    expect(c.atCommonVolume.denominator).toContain('80 cases/month');
  });

  it('unknown input: clearing e3 leaves a 41 min known subtotal, one missing activity, and no headline', () => {
    const full = fixtureModel(), m = fixtureModel();
    act(m, 'e3').activeMinutes = unknownQty('min');
    const e = computeEffort(m);
    expect(e.perCase.value).toBeNull();
    expect(e.perCase.knownSubtotal).toBe(41);
    expect(e.perCase.status).toBe('incomplete');
    expect(e.perCase.missing).toHaveLength(1);
    expect(e.perCase.missing[0].id).toBe('a-e3');
    expect(e.monthly.value).toBeNull();
    const c = compare(m, full, 'r-main');
    expect(c.atCommonVolume.value).toBeNull();
    expect(c.atCommonVolume.status).toBe('incomplete');
    expect(c.elapsed!.value).toBeNull();
    expect(computeElapsed(m, 'r-main')!.elapsed.value).toBeNull();
  });

  it('a sourced zero is a value, not unknown', () => {
    const m = fixtureModel();
    act(m, 'e3').activeMinutes = qty(0, 'min', 'measured', { sourceIds: ['Process walk 02'], method: 'timed walkthrough' });
    const e = computeEffort(m);
    expect(e.perCase.value).toBe(41);
    expect(e.perCase.status).toBe('complete');
    expect(e.perCase.missing).toHaveLength(0);
  });

  it('ranges produce a range, never a point', () => {
    const m = fixtureModel();
    act(m, 'e3').activeMinutes = { value: null, min: 10, max: 30, unit: 'min', basis: 'estimated', sourceIds: [] };
    const e = computeEffort(m);
    expect(e.perCase.value).toBeNull();
    expect(e.perCase.range).toEqual({ min: 51, max: 71 });
    expect(e.monthly.range).toEqual({ min: 68, max: 71 * 80 / 60 });
  });

  it('unit mismatches are not silently added', () => {
    const m = fixtureModel();
    act(m, 'e3').activeMinutes.unit = 'pages';
    const e = computeEffort(m);
    expect(e.perCase.value).toBeNull();
    expect(e.perCase.missing[0].reason).toContain('not a time unit');
    const h = fixtureModel();
    act(h, 'e3').activeMinutes = qty(0.5, 'h', 'measured');
    expect(computeEffort(h).perCase.value).toBe(41 + 30);
    const v = fixtureModel();
    v.volume.unit = 'cases/week';
    expect(computeEffort(v).monthly.value).toBeNull();
  });

  it('unknown volume propagates', () => {
    const m = fixtureModel();
    m.volume = unknownQty('cases/month');
    const e = computeEffort(m);
    expect(e.perCase.value).toBe(63);
    expect(e.monthly.value).toBeNull();
  });

  it('cash and people: 400 − 80 = 320/month, 960 one-time, 3 month payback', () => {
    const m = fixtureModel();
    m.assessment.currency = 'EUR';
    m.assessment.cashItems = [
      { id: 'c1', label: 'Paid overtime', kind: 'recurring_saving', amount: 400, currency: 'EUR', period: 'month', mechanism: 'Fewer paid overtime hours on the rota', basis: 'reported', sourceIds: [] },
      { id: 'c2', label: 'Service subscription', kind: 'recurring_cost', amount: 80, currency: 'EUR', period: 'month', mechanism: '', basis: 'reported', sourceIds: [] },
      { id: 'c3', label: 'Implementation', kind: 'one_time_cost', amount: 960, currency: 'EUR', period: 'once', mechanism: '', basis: 'estimated', sourceIds: [] },
    ];
    const f = computeFinancial(m, 16);
    expect(f.netRecurring.value).toBe(320);
    expect(f.oneTime).toBe(960);
    expect(f.paybackMonths.value).toBe(3);
    expect(f.capacityValue.value).toBeNull(); // no rate supplied
  });

  it('cash is not counted without a mechanism or across currencies', () => {
    const m = fixtureModel();
    m.assessment.cashItems = [{ id: 'c1', label: 'Saved time', kind: 'recurring_saving', amount: 400, currency: 'EUR', period: 'month', mechanism: '', basis: 'assumed', sourceIds: [] }];
    expect(computeFinancial(m, 16).netRecurring.value).toBeNull();
    m.assessment.cashItems = [
      { id: 'c1', label: 'Overtime', kind: 'recurring_saving', amount: 400, currency: 'EUR', period: 'month', mechanism: 'overtime', basis: 'reported', sourceIds: [] },
      { id: 'c2', label: 'Service', kind: 'recurring_cost', amount: 80, currency: 'USD', period: 'month', mechanism: '', basis: 'reported', sourceIds: [] },
    ];
    const f = computeFinancial(m, 16);
    expect(f.netRecurring.value).toBeNull();
    expect(f.issues[0]).toContain('more than one currency');
  });

  it('capacity value is modeled separately from cash', () => {
    const m = fixtureModel();
    m.assessment.hourlyRate = qty(20, 'EUR/hour', 'assumed');
    const f = computeFinancial(m, 16);
    expect(f.capacityValue.value).toBe(320);
    expect(f.netRecurring.value).toBeNull();
  });

  it('workload is grouped by role with an unassigned bucket', () => {
    const e = computeEffort(fixtureModel());
    const byLabel = Object.fromEntries(e.byRole.map((r) => [r.roleLabel, r.perCase.value]));
    expect(byLabel).toEqual({ Volunteer: 5, Coordinator: 50, Unassigned: 8 });
  });
});
