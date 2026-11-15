// Structural comparison between two revisions, plus the downstream places that deserve investigation.
import { type Model, type WEdge, activityForEdge } from './model';
import { reachable, analyzeRoute } from './routes';

export interface ItemChange { id: string; label: string; kind: 'node' | 'edge' | 'activity'; change: 'added' | 'removed' | 'changed'; fields: { field: string; before: string; after: string }[] }
export interface ModelDiff {
  changes: ItemChange[];
  added: Set<string>; removed: Set<string>; changed: Set<string>;
  volumeChanged: { before: string; after: string } | null;
  responsibilityChanges: { activityId: string; label: string; before: string; after: string }[];
  /** downstream links and nodes fed by a removed or re-routed handoff; places to investigate, not computed effects */
  downstream: { id: string; label: string; kind: 'node' | 'edge'; because: string }[];
  brokenRoutes: { routeId: string; name: string; problems: string[] }[];
  unreachableOutcomes: { id: string; label: string }[];
  affectedActors: string[];
  unresolved: string[];
}

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') {
    const q = v as { value?: number | null; min?: number; max?: number; unit?: string };
    if ('value' in q) return q.value === null ? (q.min !== undefined ? `${q.min}–${q.max} ${q.unit ?? ''}`.trim() : 'unknown') : `${q.value} ${q.unit ?? ''}`.trim();
    return JSON.stringify(v);
  }
  return String(v);
};
function fieldDiff<T extends object>(a: T, b: T, fields: (keyof T)[], names?: Partial<Record<keyof T, string>>) {
  const out: ItemChange['fields'] = [];
  for (const f of fields) {
    const x = show(a[f]), y = show(b[f]);
    if (x !== y) out.push({ field: names?.[f] ?? String(f), before: x, after: y });
  }
  return out;
}

export function diffModels(base: Model, next: Model): ModelDiff {
  const changes: ItemChange[] = [];
  const label = (m: Model, id: string | null) => (id ? m.nodes.find((n) => n.id === id)?.label ?? `(${id})` : 'not identified');
  for (const n of next.nodes) {
    const o = base.nodes.find((x) => x.id === n.id);
    if (!o) changes.push({ id: n.id, label: n.label, kind: 'node', change: 'added', fields: [] });
    else { const f = fieldDiff(o, n, ['label', 'kind', 'role', 'scope', 'description', 'parentId']); if (f.length) changes.push({ id: n.id, label: n.label, kind: 'node', change: 'changed', fields: f }); }
  }
  for (const o of base.nodes) if (!next.nodes.some((x) => x.id === o.id)) changes.push({ id: o.id, label: o.label, kind: 'node', change: 'removed', fields: [] });

  const responsibilityChanges: ModelDiff['responsibilityChanges'] = [];
  for (const e of next.edges) {
    const o = base.edges.find((x) => x.id === e.id);
    if (!o) { changes.push({ id: e.id, label: e.label, kind: 'edge', change: 'added', fields: [] }); continue; }
    const f = fieldDiff(o, e, ['label', 'type', 'from', 'to', 'workItem', 'result', 'inputState', 'outputState', 'conditions', 'exceptions', 'description'], { workItem: 'work item', inputState: 'input state', outputState: 'output state' });
    const oa = activityForEdge(base, o.id), na = activityForEdge(next, e.id);
    if (oa && na) {
      const af = fieldDiff(oa, na, ['performerId', 'actionCode', 'activeMinutes', 'waitMinutes', 'occurrencesPerCase', 'includedInWorkload'], { performerId: 'performer', actionCode: 'action', activeMinutes: 'active time', waitMinutes: 'waiting time', occurrencesPerCase: 'occurrences per case', includedInWorkload: 'counted in workload' });
      for (const x of af) if (x.field === 'performer') { x.before = label(base, oa.performerId); x.after = label(next, na.performerId); responsibilityChanges.push({ activityId: na.id, label: na.label, before: x.before, after: x.after }); }
      f.push(...af);
    } else if (oa && !na) f.push({ field: 'activity', before: oa.label, after: 'removed' });
    else if (!oa && na) f.push({ field: 'activity', before: '—', after: na.label });
    if (f.length) changes.push({ id: e.id, label: e.label, kind: 'edge', change: 'changed', fields: f });
  }
  for (const o of base.edges) if (!next.edges.some((x) => x.id === o.id)) changes.push({ id: o.id, label: o.label, kind: 'edge', change: 'removed', fields: [] });

  for (const a of next.activities.filter((x) => !x.edgeId)) {
    const o = base.activities.find((x) => x.id === a.id);
    if (!o) changes.push({ id: a.id, label: a.label, kind: 'activity', change: 'added', fields: [] });
    else {
      const f = fieldDiff(o, a, ['label', 'ownerNodeId', 'performerId', 'actionCode', 'activeMinutes', 'waitMinutes', 'occurrencesPerCase', 'includedInWorkload']);
      if (o.performerId !== a.performerId) responsibilityChanges.push({ activityId: a.id, label: a.label, before: label(base, o.performerId), after: label(next, a.performerId) });
      if (f.length) changes.push({ id: a.id, label: a.label, kind: 'activity', change: 'changed', fields: f });
    }
  }
  for (const o of base.activities.filter((x) => !x.edgeId)) if (!next.activities.some((x) => x.id === o.id)) changes.push({ id: o.id, label: o.label, kind: 'activity', change: 'removed', fields: [] });

  // Downstream: anything fed (directly or transitively) by a removed or re-pointed link, followed in the baseline graph.
  const downstream: ModelDiff['downstream'] = [];
  const seen = new Set<string>();
  const structural = changes.filter((c) => c.kind === 'edge' && (c.change === 'removed' || c.fields.some((f) => f.field === 'from' || f.field === 'to' || f.field === 'type')));
  for (const c of structural) {
    const origin = base.edges.find((e) => e.id === c.id) as WEdge;
    const stack = [origin.to];
    const visited = new Set<string>();
    while (stack.length) {
      const nid = stack.pop()!;
      if (visited.has(nid)) continue;
      visited.add(nid);
      const n = base.nodes.find((x) => x.id === nid);
      if (n && !seen.has(nid)) { seen.add(nid); downstream.push({ id: nid, label: n.label, kind: 'node', because: `fed by “${origin.label}”, which was ${c.change === 'removed' ? 'removed' : 're-routed'}` }); }
      for (const e of base.edges) {
        if (e.from !== nid || e.id === origin.id) continue;
        if (!seen.has(e.id)) { seen.add(e.id); downstream.push({ id: e.id, label: e.label, kind: 'edge', because: `downstream of “${origin.label}”` }); }
        stack.push(e.to);
      }
    }
  }

  const brokenRoutes = next.routes.map((r) => {
    const a = analyzeRoute(next, r);
    return { routeId: r.id, name: r.name, problems: a.flags.filter((f) => f.level === 'error').map((f) => f.message) };
  }).filter((r) => r.problems.length);

  const start = base.startNodeId ?? next.startNodeId;
  const before = reachable(base, start), after = reachable(next, next.startNodeId ?? start);
  const unreachableOutcomes = base.nodes.filter((n) => n.kind === 'output' && before.has(n.id) && !after.has(n.id) && next.nodes.some((x) => x.id === n.id)).map((n) => ({ id: n.id, label: n.label }));

  const actorIds = new Set<string>();
  for (const c of changes) {
    if (c.kind === 'node') actorIds.add(c.id);
    const e = c.kind === 'edge' ? next.edges.find((x) => x.id === c.id) ?? base.edges.find((x) => x.id === c.id) : null;
    if (e) { actorIds.add(e.from); actorIds.add(e.to); const a = activityForEdge(next, e.id) ?? activityForEdge(base, e.id); if (a?.performerId) actorIds.add(a.performerId); }
  }
  const affectedActors = [...actorIds].map((id) => next.nodes.find((n) => n.id === id)?.label ?? base.nodes.find((n) => n.id === id)?.label).filter((x): x is string => !!x);

  const unresolved: string[] = [];
  for (const c of changes) {
    if (c.kind === 'edge' && c.change === 'added') unresolved.push(`“${c.label}” is new. Its downstream effects have not been measured.`);
    if (c.kind === 'edge' && c.change === 'removed') unresolved.push(`“${c.label}” was removed. Check what previously depended on it.`);
  }
  for (const r of responsibilityChanges) unresolved.push(`Responsibility for “${r.label}” moves from ${r.before} to ${r.after}. Review this with the people affected.`);
  for (const o of unreachableOutcomes) unresolved.push(`Outcome “${o.label}” can no longer be reached from the start.`);

  const vb = show(base.volume), va = show(next.volume);
  return {
    changes, added: new Set(changes.filter((c) => c.change === 'added').map((c) => c.id)), removed: new Set(changes.filter((c) => c.change === 'removed').map((c) => c.id)),
    changed: new Set(changes.filter((c) => c.change === 'changed').map((c) => c.id)), volumeChanged: vb !== va ? { before: vb, after: va } : null,
    responsibilityChanges, downstream, brokenRoutes, unreachableOutcomes, affectedActors, unresolved,
  };
}

/** Resolves an evidence anchor against a particular revision. Notes are never rewritten when a target disappears. */
export type AnchorState = 'attached' | 'historical' | 'unassigned';
export function anchorState(m: Model, targetId: string | null): AnchorState {
  if (!targetId) return 'unassigned';
  return m.nodes.some((n) => n.id === targetId) || m.edges.some((e) => e.id === targetId) || m.activities.some((a) => a.id === targetId) ? 'attached' : 'historical';
}
export function targetLabel(m: Model, targetId: string | null): string | null {
  if (!targetId) return null;
  return m.nodes.find((n) => n.id === targetId)?.label ?? m.edges.find((e) => e.id === targetId)?.label ?? m.activities.find((a) => a.id === targetId)?.label ?? null;
}
