// Impact engine. Pure and deterministic. Effort, elapsed time, cash and human effects are never merged.
// Missing inputs stay unknown: a headline figure is only produced when every included input is known.
import type { Basis, CashItem, Model, Quantity, WActivity } from './model';
import { analyzeRoute, type RouteAnalysis } from './routes';

export interface InputRef { kind: 'activity' | 'volume' | 'cash' | 'rate'; id: string; label: string; field: string; basis: Basis; sourceIds: string[] }
export interface MissingInput { id: string; label: string; field: string; reason: string }

export interface Figure {
  /** Headline value. null when any required input is missing or mismatched. */
  value: number | null;
  /** Sum of the inputs that are known. Never a substitute for the headline. */
  knownSubtotal: number;
  /** Range when inputs are ranges; only present when every input is a point or a range. */
  range: { min: number; max: number } | null;
  unit: string;
  status: 'complete' | 'incomplete' | 'unknown';
  missing: MissingInput[];
  basis: Basis[];
  inputs: InputRef[];
}

const TIME_TO_MIN: Record<string, number> = { min: 1, minute: 1, minutes: 1, m: 1, h: 60, hour: 60, hours: 60, hr: 60, d: 1440, day: 1440, days: 1440 };

interface Resolved { point: number | null; min: number | null; max: number | null; problem: string | null }

function resolveTime(q: Quantity): Resolved {
  const f = TIME_TO_MIN[q.unit.trim().toLowerCase()];
  if (!f) return { point: null, min: null, max: null, problem: `unit “${q.unit || '(none)'}” is not a time unit` };
  if (q.value !== null) return { point: q.value * f, min: q.value * f, max: q.value * f, problem: null };
  if (q.min !== undefined && q.max !== undefined) return { point: null, min: q.min * f, max: q.max * f, problem: null };
  return { point: null, min: null, max: null, problem: 'not measured' };
}
function resolveCount(q: Quantity, units: string[]): Resolved {
  const u = q.unit.trim().toLowerCase();
  if (!units.includes(u)) return { point: null, min: null, max: null, problem: `unit “${q.unit || '(none)'}” does not match ${units[0]}` };
  if (q.value !== null) return { point: q.value, min: q.value, max: q.value, problem: null };
  if (q.min !== undefined && q.max !== undefined) return { point: null, min: q.min, max: q.max, problem: null };
  return { point: null, min: null, max: null, problem: 'not known' };
}
const OCC_UNITS = ['per case', 'per-case', 'occurrences/case', 'x', ''];
const VOLUME_UNITS = ['cases/month', 'cases per month'];

function uniq<T>(xs: T[]): T[] { return [...new Set(xs)]; }
function finish(parts: { r: Resolved }[], unit: string, missing: MissingInput[], inputs: InputRef[]): Figure {
  let known = 0, min = 0, max = 0, rangeOk = true, complete = true;
  for (const { r } of parts) {
    if (r.point !== null) known += r.point; else complete = false;
    if (r.min !== null && r.max !== null) { min += r.min; max += r.max; } else rangeOk = false;
  }
  const any = parts.some((x) => x.r.point !== null);
  return {
    value: complete ? known : null, knownSubtotal: known, range: rangeOk && !complete ? { min, max } : null, unit,
    status: complete ? 'complete' : any || (rangeOk && parts.length > 0) ? 'incomplete' : 'unknown', missing, inputs, basis: uniq(inputs.map((i) => i.basis)),
  };
}
const mul = (a: Resolved, b: Resolved): Resolved => ({
  point: a.point !== null && b.point !== null ? a.point * b.point : null,
  min: a.min !== null && b.min !== null ? a.min * b.min : null,
  max: a.max !== null && b.max !== null ? a.max * b.max : null,
  problem: a.problem ?? b.problem,
});

export interface Contribution { activityId: string; label: string; edgeId: string | null; roleId: string | null; roleLabel: string; minutes: number | null; occurrences: number | null; perCase: number | null; basis: Basis }

export interface EffortResult {
  perCase: Figure; // minutes per case
  monthly: Figure; // hours per month at this model's volume
  volume: number | null;
  volumeBasis: Basis;
  contributions: Contribution[];
  byRole: { roleId: string | null; roleLabel: string; perCase: Figure; monthly: Figure }[];
  includedCount: number;
}

function activityParts(m: Model, acts: WActivity[]) {
  const parts: { r: Resolved }[] = [], missing: MissingInput[] = [], inputs: InputRef[] = [], contributions: Contribution[] = [];
  for (const a of acts) {
    const t = resolveTime(a.activeMinutes), o = resolveCount(a.occurrencesPerCase, OCC_UNITS);
    const r = mul(t, o);
    parts.push({ r });
    if (t.problem) missing.push({ id: a.id, label: a.label, field: 'active time', reason: t.problem });
    if (o.problem) missing.push({ id: a.id, label: a.label, field: 'occurrences per case', reason: o.problem });
    inputs.push({ kind: 'activity', id: a.id, label: a.label, field: 'active time', basis: t.problem ? 'unknown' : a.activeMinutes.basis, sourceIds: a.activeMinutes.sourceIds });
    const role = a.performerId ? m.nodes.find((n) => n.id === a.performerId) : null;
    contributions.push({ activityId: a.id, label: a.label, edgeId: a.edgeId, roleId: role?.id ?? null, roleLabel: role?.label ?? 'Unassigned', minutes: t.point, occurrences: o.point, perCase: r.point, basis: t.problem ? 'unknown' : a.activeMinutes.basis });
  }
  return { parts, missing, inputs, contributions };
}

function toMonthly(perCase: Figure, vol: Resolved, volumeQ: Quantity): Figure {
  const missing = [...perCase.missing];
  if (vol.problem) missing.push({ id: 'volume', label: 'Monthly volume', field: 'cases per month', reason: vol.problem });
  const inputs: InputRef[] = [...perCase.inputs, { kind: 'volume', id: 'volume', label: 'Monthly volume', field: 'cases per month', basis: vol.problem ? 'unknown' : volumeQ.basis, sourceIds: volumeQ.sourceIds }];
  const complete = perCase.value !== null && vol.point !== null;
  const range = perCase.range && vol.min !== null && vol.max !== null ? { min: (perCase.range.min * vol.min) / 60, max: (perCase.range.max * vol.max) / 60 }
    : perCase.value !== null && vol.point === null && vol.min !== null && vol.max !== null ? { min: (perCase.value * vol.min) / 60, max: (perCase.value * vol.max) / 60 } : null;
  return {
    value: complete ? (perCase.value! * vol.point!) / 60 : null,
    knownSubtotal: vol.point !== null ? (perCase.knownSubtotal * vol.point) / 60 : 0,
    range, unit: 'hours/month', status: complete ? 'complete' : perCase.status === 'unknown' && vol.point === null ? 'unknown' : 'incomplete',
    missing, inputs, basis: uniq(inputs.map((i) => i.basis)),
  };
}

/** Staff effort across all activities included in workload. A handoff and its attached activity are one record, so nothing is counted twice. */
export function computeEffort(m: Model, volumeOverride?: Quantity): EffortResult {
  const volumeQ = volumeOverride ?? m.volume;
  const vol = resolveCount(volumeQ, VOLUME_UNITS);
  const included = m.activities.filter((a) => a.includedInWorkload);
  const all = activityParts(m, included);
  const perCase = finish(all.parts, 'minutes/case', all.missing, all.inputs);
  if (!included.length) perCase.status = 'unknown';
  const roles = uniq(all.contributions.map((c) => c.roleId));
  const byRole = roles.map((roleId) => {
    const acts = included.filter((a) => (a.performerId && m.nodes.some((n) => n.id === a.performerId) ? a.performerId : null) === roleId);
    const p = activityParts(m, acts);
    const pc = finish(p.parts, 'minutes/case', p.missing, p.inputs);
    return { roleId, roleLabel: p.contributions[0]?.roleLabel ?? 'Unassigned', perCase: pc, monthly: toMonthly(pc, vol, volumeQ) };
  });
  return { perCase, monthly: toMonthly(perCase, vol, volumeQ), volume: vol.point, volumeBasis: vol.problem ? 'unknown' : volumeQ.basis, contributions: all.contributions, byRole, includedCount: included.length };
}

export interface ElapsedResult {
  routeId: string;
  routeName: string;
  analysis: RouteAnalysis;
  active: Figure; // minutes, sequential, selected occurrences only
  waiting: Figure;
  elapsed: Figure;
  steps: { stepId: string; label: string; refId: string; active: number | null; wait: number | null; missing: boolean }[];
}

/** Sequential elapsed time on one explicit route: active plus waiting for exactly the listed occurrences. */
export function computeElapsed(m: Model, routeId: string): ElapsedResult | null {
  const route = m.routes.find((r) => r.id === routeId);
  if (!route) return null;
  const analysis = analyzeRoute(m, route);
  const aParts: { r: Resolved }[] = [], wParts: { r: Resolved }[] = [], missing: MissingInput[] = [], inputs: InputRef[] = [];
  const steps: ElapsedResult['steps'] = [];
  for (const s of analysis.steps) {
    const a = s.activity;
    if (s.missing) {
      aParts.push({ r: { point: null, min: null, max: null, problem: 'removed' } }); wParts.push({ r: { point: null, min: null, max: null, problem: 'removed' } });
      missing.push({ id: s.refId, label: s.label, field: 'step', reason: 'not present in this version' });
      steps.push({ stepId: s.stepId, label: s.label, refId: s.refId, active: null, wait: null, missing: true });
      continue;
    }
    if (!a) {
      // A link with no activity (for example a dependency used as a step) has no recorded timing.
      const none: Resolved = { point: null, min: null, max: null, problem: 'no activity recorded' };
      aParts.push({ r: none }); wParts.push({ r: none });
      missing.push({ id: s.refId, label: s.label, field: 'timing', reason: 'no activity recorded on this link' });
      steps.push({ stepId: s.stepId, label: s.label, refId: s.refId, active: null, wait: null, missing: false });
      continue;
    }
    const t = resolveTime(a.activeMinutes), w = resolveTime(a.waitMinutes);
    aParts.push({ r: t }); wParts.push({ r: w });
    if (t.problem) missing.push({ id: a.id, label: a.label, field: 'active time', reason: t.problem });
    if (w.problem) missing.push({ id: a.id, label: a.label, field: 'waiting time', reason: w.problem });
    inputs.push({ kind: 'activity', id: a.id, label: a.label, field: 'active time', basis: t.problem ? 'unknown' : a.activeMinutes.basis, sourceIds: a.activeMinutes.sourceIds });
    inputs.push({ kind: 'activity', id: a.id, label: a.label, field: 'waiting time', basis: w.problem ? 'unknown' : a.waitMinutes.basis, sourceIds: a.waitMinutes.sourceIds });
    steps.push({ stepId: s.stepId, label: s.label, refId: s.refId, active: t.point, wait: w.point, missing: false });
  }
  const active = finish(aParts, 'minutes', missing.filter((x) => x.field !== 'waiting time'), inputs.filter((i) => i.field === 'active time'));
  const waiting = finish(wParts, 'minutes', missing.filter((x) => x.field !== 'active time'), inputs.filter((i) => i.field === 'waiting time'));
  const elapsed = finish([...aParts, ...wParts], 'minutes', missing, inputs);
  if (!analysis.playable) { for (const f of [active, waiting, elapsed]) { if (f.status === 'complete') f.status = 'incomplete'; f.value = null; } }
  return { routeId, routeName: route.name, analysis, active, waiting, elapsed, steps };
}

export interface Delta { value: number | null; knownOnly: number; unit: string; status: 'complete' | 'incomplete' | 'unknown'; denominator: string; note: string }

function delta(base: Figure, scen: Figure, unit: string, denominator: string): Delta {
  const complete = base.value !== null && scen.value !== null;
  return {
    value: complete ? scen.value! - base.value! : null, knownOnly: scen.knownSubtotal - base.knownSubtotal, unit, denominator,
    status: complete ? 'complete' : base.status === 'unknown' && scen.status === 'unknown' ? 'unknown' : 'incomplete',
    note: complete ? '' : 'Incomplete: at least one included input is missing, so no headline change is stated. The known-only difference is not a saving.',
  };
}

export interface FinancialResult {
  currency: string | null;
  issues: string[];
  /** Modeled value of released time. A capacity estimate, not cash. */
  capacityValue: { value: number | null; unit: string; note: string };
  recurringSavings: number | null;
  recurringCosts: number | null;
  netRecurring: { value: number | null; unit: string; status: 'complete' | 'unknown'; note: string };
  oneTime: number | null;
  paybackMonths: { value: number | null; note: string };
  horizonMonths: number | null;
  horizonNet: number | null;
  items: (CashItem & { counted: boolean; reason: string; monthly: number | null })[];
}

export function computeFinancial(m: Model, releasedHoursPerMonth: number | null): FinancialResult {
  const a = m.assessment;
  const issues: string[] = [];
  const currencies = uniq([a.currency, ...a.cashItems.map((c) => c.currency)].map((c) => c.trim().toUpperCase()).filter(Boolean));
  const currency = currencies.length === 1 ? currencies[0] : null;
  if (currencies.length > 1) issues.push(`Amounts use more than one currency (${currencies.join(', ')}). They are not added together.`);
  const items = a.cashItems.map((c) => {
    let counted = true, reason = '';
    if (c.amount === null) { counted = false; reason = 'Amount unknown'; }
    else if (c.kind === 'recurring_saving' && !c.mechanism.trim()) { counted = false; reason = 'No documented cost mechanism, so this is not counted as cash'; }
    else if (currencies.length > 1) { counted = false; reason = 'Currency mismatch'; }
    else if (c.kind !== 'one_time_cost' && c.period === 'once') { counted = false; reason = 'A recurring item needs a period'; }
    const monthly = c.amount === null || c.kind === 'one_time_cost' ? null : c.period === 'year' ? c.amount / 12 : c.period === 'month' ? c.amount : null;
    return { ...c, counted, reason, monthly };
  });
  const sum = (kind: CashItem['kind']) => {
    const of = items.filter((i) => i.kind === kind);
    if (!of.length) return null;
    if (of.some((i) => !i.counted)) return null;
    return of.reduce((s, i) => s + (kind === 'one_time_cost' ? i.amount! : i.monthly!), 0);
  };
  const hasSavings = items.some((i) => i.kind === 'recurring_saving'), hasCosts = items.some((i) => i.kind === 'recurring_cost');
  const savings = sum('recurring_saving'), costs = sum('recurring_cost'), oneTime = sum('one_time_cost');
  let net: number | null = null, netNote = '';
  if (!hasSavings && !hasCosts) netNote = 'Cash effect unknown: no documented cost mechanism has been entered. Released time is capacity, not cash.';
  else if ((hasSavings && savings === null) || (hasCosts && costs === null)) netNote = 'Cash effect unknown: at least one cash item is missing an amount, mechanism or matching currency.';
  else net = (savings ?? 0) - (costs ?? 0);
  let payback: number | null = null, paybackNote = '';
  if (net === null) paybackNote = 'Payback needs a known recurring net benefit.';
  else if (oneTime === null) paybackNote = items.some((i) => i.kind === 'one_time_cost') ? 'One-time cost is incomplete.' : 'No one-time implementation cost entered.';
  else if (net <= 0) paybackNote = 'No payback: recurring net benefit is not positive.';
  else payback = oneTime / net;
  const rate = a.hourlyRate;
  let capacity: number | null = null, capNote = 'No applicable rate supplied. Released time is shown in hours only.';
  if (rate && rate.value !== null) {
    const perHour = /hour|\/h$/i.test(rate.unit);
    if (!perHour) capNote = `Rate unit “${rate.unit}” is not per hour; capacity value not calculated.`;
    else if (releasedHoursPerMonth === null) capNote = 'Released time is incomplete, so capacity value is not calculated.';
    else { capacity = releasedHoursPerMonth * rate.value; capNote = `Modeled capacity estimate (${rate.basis}). Not a cash saving.`; }
  }
  const horizon = a.horizonMonths;
  return {
    currency, issues, capacityValue: { value: capacity, unit: `${currency ?? ''}/month`.trim(), note: capNote },
    recurringSavings: savings, recurringCosts: costs,
    netRecurring: { value: net, unit: `${currency ?? ''}/month`.trim(), status: net === null ? 'unknown' : 'complete', note: netNote },
    oneTime, paybackMonths: { value: payback, note: paybackNote }, horizonMonths: horizon,
    horizonNet: net !== null && horizon !== null ? net * horizon - (oneTime ?? 0) : null, items,
  };
}

export interface Comparison {
  base: { effort: EffortResult; elapsed: ElapsedResult | null };
  scenario: { effort: EffortResult; elapsed: ElapsedResult | null };
  /** Scenario effort at the scenario's own volume, minus baseline at the baseline's volume. */
  atModeledVolumes: Delta;
  /** Like-for-like efficiency: both sides at the baseline volume. */
  atCommonVolume: Delta & { scenarioMonthly: Figure };
  perCase: Delta;
  elapsed: Delta | null;
  financial: FinancialResult;
  unverifiedInputs: boolean;
  byRole: { roleId: string | null; roleLabel: string; base: Figure | null; scenario: Figure | null; delta: Delta }[];
}

const zeroFigure = (unit: string): Figure => ({ value: 0, knownSubtotal: 0, range: null, unit, status: 'complete', missing: [], inputs: [], basis: [] });

export function compare(base: Model, scenario: Model, routeId?: string | null): Comparison {
  const be = computeEffort(base), se = computeEffort(scenario);
  const seCommon = computeEffort(scenario, base.volume);
  const bl = routeId ? computeElapsed(base, routeId) : null, sl = routeId ? computeElapsed(scenario, routeId) : null;
  const volLabel = (v: number | null) => (v === null ? 'unknown volume' : `${v} cases/month`);
  const atModeled = delta(be.monthly, se.monthly, 'hours/month', `scenario at ${volLabel(se.volume)} vs baseline at ${volLabel(be.volume)}`);
  const atCommon = { ...delta(be.monthly, seCommon.monthly, 'hours/month', `both at the baseline volume of ${volLabel(be.volume)}`), scenarioMonthly: seCommon.monthly };
  const released = atCommon.value !== null ? -atCommon.value : null;
  const roleIds = uniq([...be.byRole.map((r) => r.roleId), ...seCommon.byRole.map((r) => r.roleId)]);
  const byRole = roleIds.map((roleId) => {
    const b = be.byRole.find((r) => r.roleId === roleId), s = seCommon.byRole.find((r) => r.roleId === roleId);
    return { roleId, roleLabel: b?.roleLabel ?? s?.roleLabel ?? 'Unassigned', base: b?.monthly ?? null, scenario: s?.monthly ?? null,
      delta: delta(b?.monthly ?? zeroFigure('hours/month'), s?.monthly ?? zeroFigure('hours/month'), 'hours/month', `both at ${volLabel(be.volume)}`) };
  });
  const bases = [...be.monthly.basis, ...se.monthly.basis];
  return {
    base: { effort: be, elapsed: bl }, scenario: { effort: se, elapsed: sl },
    atModeledVolumes: atModeled, atCommonVolume: atCommon,
    perCase: delta(be.perCase, se.perCase, 'minutes/case', 'per case'),
    elapsed: bl && sl ? delta(bl.elapsed, sl.elapsed, 'minutes', `route “${sl.routeName}”, sequential`) : null,
    financial: computeFinancial(scenario, released), byRole,
    unverifiedInputs: bases.some((b) => b === 'unverified' || b === 'assumed' || b === 'estimated'),
  };
}

export function fmtFigure(f: Figure, digits = 1): string {
  const n = (x: number) => (Math.round(x * 10 ** digits) / 10 ** digits).toLocaleString('en-US', { maximumFractionDigits: digits });
  if (f.value !== null) return n(f.value);
  if (f.range) return `${n(f.range.min)}–${n(f.range.max)}`;
  return 'Unknown';
}
export function fmtDelta(d: Delta, digits = 1): string {
  if (d.value === null) return d.status === 'unknown' ? 'Unknown' : 'Incomplete';
  const v = Math.round(d.value * 10 ** digits) / 10 ** digits;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: digits })}`;
}
