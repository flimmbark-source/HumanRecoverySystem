// Route analysis: a route is an explicitly ordered list of occurrences. Nothing is inferred at playback time.
import { type Model, type WRoute, type WActivity, type WEdge, activityForEdge, newId } from './model';

export interface ResolvedStep {
  stepId: string;
  index: number;
  kind: 'edge' | 'activity';
  refId: string;
  label: string;
  edge: WEdge | null;
  activity: WActivity | null;
  fromNodeId: string | null;
  toNodeId: string | null;
  missing: boolean; // referenced item no longer exists in this revision
  occurrence: number; // 1 for the first time this item appears on the route, 2 for the first repeat…
}

export interface RouteFlag { level: 'error' | 'warning' | 'info'; code: string; message: string; stepIndex?: number; refId?: string }

export interface RouteAnalysis {
  route: WRoute;
  steps: ResolvedStep[];
  flags: RouteFlag[];
  playable: boolean;
  startNodeId: string | null;
  endNodeId: string | null;
  repeats: { refId: string; label: string; times: number }[];
  /** information/dependency links touching the route but not part of it */
  sideLinks: { edgeId: string; label: string; type: string; touches: string }[];
}

export function analyzeRoute(m: Model, route: WRoute): RouteAnalysis {
  const flags: RouteFlag[] = [];
  const seen = new Map<string, number>();
  const steps: ResolvedStep[] = route.steps.map((s, index) => {
    const occurrence = (seen.get(s.refId) ?? 0) + 1;
    seen.set(s.refId, occurrence);
    if (s.kind === 'edge') {
      const edge = m.edges.find((e) => e.id === s.refId) ?? null;
      return { stepId: s.id, index, kind: 'edge' as const, refId: s.refId, label: edge?.label ?? `Removed connection (${s.refId})`, edge, activity: edge ? activityForEdge(m, edge.id) : null, fromNodeId: edge?.from ?? null, toNodeId: edge?.to ?? null, missing: !edge, occurrence };
    }
    const activity = m.activities.find((a) => a.id === s.refId && !a.edgeId) ?? null;
    return { stepId: s.id, index, kind: 'activity' as const, refId: s.refId, label: activity?.label ?? `Removed activity (${s.refId})`, edge: null, activity, fromNodeId: activity?.ownerNodeId ?? null, toNodeId: activity?.ownerNodeId ?? null, missing: !activity, occurrence };
  });

  if (!steps.length) flags.push({ level: 'error', code: 'empty', message: 'This route has no steps yet.' });
  for (const s of steps) {
    if (s.missing) flags.push({ level: 'error', code: 'broken', message: `Step ${s.index + 1} refers to an item that is not in this version of the model. The handoff is broken here.`, stepIndex: s.index, refId: s.refId });
  }
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1], b = steps[i];
    if (a.missing || b.missing) continue;
    if (a.toNodeId !== b.fromNodeId) {
      const an = m.nodes.find((n) => n.id === a.toNodeId)?.label ?? '?', bn = m.nodes.find((n) => n.id === b.fromNodeId)?.label ?? '?';
      flags.push({ level: 'error', code: 'gap', message: `Gap between step ${i} and ${i + 1}: “${a.label}” ends at ${an} but “${b.label}” starts at ${bn}.`, stepIndex: i });
    }
  }
  const first = steps.find((s) => !s.missing), last = [...steps].reverse().find((s) => !s.missing);
  const startNodeId = route.startNodeId ?? first?.fromNodeId ?? null;
  const endNodeId = route.endNodeId ?? last?.toNodeId ?? null;
  if (steps.length && first && route.startNodeId && first.fromNodeId !== route.startNodeId) flags.push({ level: 'error', code: 'start', message: 'The first step does not begin at the route start.' });
  if (steps.length && last && route.endNodeId && last.toNodeId !== route.endNodeId) flags.push({ level: 'error', code: 'end', message: 'The last step does not reach the route outcome.' });
  if (steps.length && endNodeId) {
    const end = m.nodes.find((n) => n.id === endNodeId);
    if (end && end.kind !== 'output' && !route.endNodeId) flags.push({ level: 'warning', code: 'no-outcome', message: `The route ends at “${end.label}”, which is not marked as an outcome.` });
  }
  const repeats = [...seen.entries()].filter(([, n]) => n > 1).map(([refId, times]) => ({ refId, times, label: steps.find((s) => s.refId === refId)?.label ?? refId }));
  for (const r of repeats) flags.push({ level: 'info', code: 'repeat', message: `“${r.label}” occurs ${r.times} times on this route (explicit repeat).`, refId: r.refId });

  let unmeasured = 0;
  for (const s of steps) {
    if (s.missing) continue;
    if (!s.activity) { if (s.edge && (s.edge.type === 'flow' || s.edge.type === 'info')) unmeasured++; continue; }
    if (s.activity.activeMinutes.value === null || s.activity.waitMinutes.value === null) unmeasured++;
  }
  if (unmeasured) flags.push({ level: 'warning', code: 'timing', message: `${unmeasured} step${unmeasured === 1 ? ' has' : 's have'} incomplete timing. Playback is illustrative.` });

  const onRoute = new Set(steps.map((s) => s.refId));
  const routeNodes = new Set(steps.flatMap((s) => [s.fromNodeId, s.toNodeId]).filter(Boolean) as string[]);
  const sideLinks = m.edges
    .filter((e) => !onRoute.has(e.id) && (e.type === 'info' || e.type === 'dependency') && (routeNodes.has(e.from) || routeNodes.has(e.to)))
    .map((e) => ({ edgeId: e.id, label: e.label, type: e.type, touches: m.nodes.find((n) => n.id === (routeNodes.has(e.to) ? e.to : e.from))?.label ?? '' }));
  if (sideLinks.length) flags.push({ level: 'info', code: 'side-links', message: `${sideLinks.length} information or dependency link${sideLinks.length === 1 ? '' : 's'} can affect this route but ${sideLinks.length === 1 ? 'is' : 'are'} not part of its effort: ${sideLinks.map((l) => l.label).join(', ')}.` });

  const playable = steps.length > 0 && !flags.some((f) => f.level === 'error');
  return { route, steps, flags, playable, startNodeId, endNodeId, repeats, sideLinks };
}

export interface RouteSuggestion { status: 'ok' | 'ambiguous' | 'none' | 'cycle'; edgeIds: string[]; message: string; branchAt?: string; options?: { edgeId: string; label: string }[] }

/** Follows flow links from a start node. Stops and reports instead of silently choosing the first branch. */
export function suggestRoute(m: Model, startNodeId?: string | null): RouteSuggestion {
  const start = m.nodes.find((n) => n.id === (startNodeId ?? m.startNodeId))
    ?? m.nodes.find((n) => m.edges.some((e) => e.type === 'flow' && e.from === n.id) && !m.edges.some((e) => e.type === 'flow' && e.to === n.id));
  if (!start) return { status: 'none', edgeIds: [], message: 'Connect a work flow and choose a start to create a route.' };
  const edgeIds: string[] = [];
  const visited = new Set<string>();
  let current = start.id;
  for (let i = 0; i < 200; i++) {
    if (visited.has(current)) return { status: 'cycle', edgeIds, message: 'The flow loops back on itself. Add the repeat explicitly as ordered steps.' };
    visited.add(current);
    const out = m.edges.filter((e) => e.type === 'flow' && e.from === current);
    if (!out.length) break;
    if (out.length > 1) {
      return { status: 'ambiguous', edgeIds, branchAt: current, options: out.map((e) => ({ edgeId: e.id, label: e.label })), message: `The flow branches at “${m.nodes.find((n) => n.id === current)?.label}”. Choose which branch this route follows.` };
    }
    edgeIds.push(out[0].id);
    current = out[0].to;
    if (m.nodes.find((n) => n.id === current)?.kind === 'output') break;
  }
  if (!edgeIds.length) return { status: 'none', edgeIds, message: 'No work flow leaves the start node.' };
  return { status: 'ok', edgeIds, message: 'Route follows the only available flow.' };
}

export function routeFromEdges(m: Model, name: string, edgeIds: string[]): WRoute {
  const first = m.edges.find((e) => e.id === edgeIds[0]), last = m.edges.find((e) => e.id === edgeIds[edgeIds.length - 1]);
  const taken = new Set(m.routes.map((r) => r.id));
  return {
    id: newId('r', taken), name, startNodeId: first?.from ?? null, endNodeId: last?.to ?? null, caseWeight: null,
    steps: edgeIds.map((refId, i) => ({ id: `s${i + 1}`, kind: 'edge' as const, refId })),
  };
}

/** Nodes reachable from a start through flow links. */
export function reachable(m: Model, startId: string | null): Set<string> {
  const out = new Set<string>();
  if (!startId || !m.nodes.some((n) => n.id === startId)) return out;
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const e of m.edges) if (e.type === 'flow' && e.from === id) stack.push(e.to);
  }
  return out;
}
