// Graph geometry carried forward from v0.7: curved links, floating labels that avoid nodes and each other,
// and an undoable Tidy that spaces the main flow on one row with side strands above it.
import type { Layout, Model, WEdge, WNode } from './model';

export const NODE_H = 84;
export const nodeW = (n: Pick<WNode, 'kind'>) => (n.kind === 'output' ? 178 : 168);
export interface Rect { x: number; y: number; w: number; h: number }
export interface EdgeGeom { ax: number; ay: number; bx: number; by: number; cx: number; cy: number; mx: number; my: number; d: string }

export const pos = (layout: Layout, id: string) => layout[id] ?? { x: 0, y: 0 };

export function edgeGeom(e: WEdge, m: Model, layout: Layout): EdgeGeom | null {
  const a = m.nodes.find((n) => n.id === e.from), b = m.nodes.find((n) => n.id === e.to);
  if (!a || !b) return null;
  const pa = pos(layout, a.id), pb = pos(layout, b.id);
  const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  // leave the node box along the travel direction
  const exit = (n: WNode) => { const hw = nodeW(n) / 2 + 2, hh = NODE_H / 2 + 2; return Math.min(Math.abs(ux) > 0.001 ? hw / Math.abs(ux) : Infinity, Math.abs(uy) > 0.001 ? hh / Math.abs(uy) : Infinity); };
  const padA = Math.min(exit(a), d / 2 - 1), padB = Math.min(exit(b) + 4, d / 2 - 1);
  const ax = pa.x + ux * padA, ay = pa.y + uy * padA, bx = pb.x - ux * padB, by = pb.y - uy * padB;
  const twin = m.edges.some((o) => o.id !== e.id && ((o.from === e.to && o.to === e.from) || (o.from === e.from && o.to === e.to)));
  let curve = e.type === 'flow' ? 0 : e.type === 'info' ? -18 : 16;
  if (twin) curve += e.type === 'flow' ? 26 : 14;
  const mx0 = (ax + bx) / 2, my0 = (ay + by) / 2, cx = mx0 - uy * curve, cy = my0 + ux * curve;
  return { ax, ay, bx, by, cx, cy, mx: (ax + 2 * cx + bx) / 4, my: (ay + 2 * cy + by) / 4, d: `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}` };
}

export const pointAt = (g: EdgeGeom, t: number) => ({
  x: (1 - t) * (1 - t) * g.ax + 2 * (1 - t) * t * g.cx + t * t * g.bx,
  y: (1 - t) * (1 - t) * g.ay + 2 * (1 - t) * t * g.cy + t * t * g.by,
});

export const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Space a node occupies, including its local EXTERNAL / CONTEXT tag and note badge. */
export function nodeRect(n: WNode, layout: Layout, margin = 0): Rect {
  const p = pos(layout, n.id), w = nodeW(n);
  const tag = n.scope !== 'internal' ? 24 : 0;
  return { x: p.x - w / 2 - margin, y: p.y - NODE_H / 2 - margin - 10, w: w + margin * 2 + 10, h: NODE_H + margin * 2 + tag + 10 };
}

export const LABEL_H = 34;
export function labelWidth(text: string) { return Math.max(97, Math.min(text.length, 23) * 6.3 + 22); }
export const shortLabel = (s: string, max = 23) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

export interface PlacedLabel { edgeId: string; x: number; y: number; w: number; rect: Rect; collided: boolean }
export type LabelPoint = Pick<PlacedLabel, 'x' | 'y'>;

function rotate({ x, y }: LabelPoint, angle: number): LabelPoint {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

const connectionAngle = (g: EdgeGeom) => Math.atan2(g.by - g.ay, g.bx - g.ax);

export function labelOffset(label: LabelPoint, g: EdgeGeom): LabelPoint {
  return rotate({ x: label.x - g.mx, y: label.y - g.my }, -connectionAngle(g));
}

function labelAtOffset(offset: LabelPoint, g: EdgeGeom): LabelPoint {
  const delta = rotate(offset, connectionAngle(g));
  return { x: g.mx + delta.x, y: g.my + delta.y };
}

/** Carry the label's offset with the moving connection. The label itself stays upright. */
export function followLabel(label: LabelPoint, from: EdgeGeom, to: EdgeGeom): LabelPoint {
  return labelAtOffset(labelOffset(label, from), to);
}

// Reserve space for the box and its note badge.
const labelRect = (x: number, y: number, w: number): Rect => ({ x: x - w / 2 - 6, y: y - 26, w: w + 38, h: 43 });

/** Collision-aware placement. Each label takes the cheapest free slot near its link; a leader keeps it legible when it must move away. */
export function placeLabels(m: Model, layout: Layout, preferred?: ReadonlyMap<string, LabelPoint>): Map<string, PlacedLabel> {
  const placed = new Map<string, PlacedLabel>();
  const taken: Rect[] = [];
  const nodeRects = m.nodes.map((n) => nodeRect(n, layout, 6));
  // Lines are soft obstacles: a label should not sit on another connection when a free slot exists.
  const geoms = new Map(m.edges.map((e) => [e.id, edgeGeom(e, m, layout)] as const));
  // Reserve clear manual positions before arranging automatic labels.
  for (const edge of m.edges) {
    const g = geoms.get(edge.id);
    if (!g || !Object.hasOwn(layout, edge.id)) continue;
    const { x, y } = labelAtOffset(layout[edge.id], g);
    const w = labelWidth(edge.label), rect = labelRect(x, y, w);
    if (nodeRects.some((r) => overlapArea(rect, r) > 0) || taken.some((r) => overlapArea(rect, r) > 0)) continue;
    placed.set(edge.id, { edgeId: edge.id, x, y, w, rect, collided: false });
    taken.push(rect);
  }
  const linePoints: { edgeId: string; r: Rect }[] = [];
  for (const [edgeId, g] of geoms) if (g) for (let k = 1; k <= 9; k++) { const p = pointAt(g, k / 10); linePoints.push({ edgeId, r: { x: p.x - 9, y: p.y - 9, w: 18, h: 18 } }); }
  for (const e of m.edges) {
    const g = geoms.get(e.id);
    if (!g || placed.has(e.id)) continue;
    const w = labelWidth(e.label);
    const horiz = Math.abs(g.by - g.ay) < 45, vertical = Math.abs(g.bx - g.ax) < 80;
    const base: [number, number][] = vertical
      ? [[w / 2 + 32, 0], [-w / 2 - 32, 0], [w / 2 + 35, -55], [-w / 2 - 35, -55], [0, -78], [0, 78]]
      : horiz ? [[0, -84], [0, 88], [0, -124], [0, 128], [30, -84], [-30, -84], [0, -160], [0, 164]]
        : [[0, -70], [0, 70], [w / 2 + 38, 0], [-w / 2 - 38, 0], [0, -115], [0, 115], [w / 2 + 35, -55], [-w / 2 - 35, -55]];
    const last = Object.hasOwn(layout, e.id) ? labelAtOffset(layout[e.id], g) : preferred?.get(e.id);
    if (last) base.unshift([last.x - g.mx, last.y - g.my]);
    // fallback ring for dense graphs
    const ring: [number, number][] = [];
    for (const r of [170, 215, 265]) for (let k = 0; k < 12; k++) ring.push([Math.cos((k * Math.PI) / 6) * r * 1.25, Math.sin((k * Math.PI) / 6) * r]);
    let best: PlacedLabel | null = null, bestCost = Infinity;
    const options = [...base, ...ring];
    for (let i = 0; i < options.length; i++) {
      const [dx, dy] = options[i], x = g.mx + dx, y = g.my + dy;
      const rect = labelRect(x, y, w);
      let hit = 0;
      for (const r of nodeRects) hit += overlapArea(rect, r);
      for (const r of taken) hit += overlapArea(rect, r);
      let soft = 0;
      for (const lp of linePoints) if (lp.edgeId !== e.id) soft += overlapArea(rect, lp.r);
      const cost = i * 3 + Math.abs(dx) * 0.025 + Math.abs(dy) * 0.015 + hit * 9 + soft * 0.05;
      if (cost < bestCost) { bestCost = cost; best = { edgeId: e.id, x, y, w, rect, collided: hit > 0 }; }
      if (hit === 0 && soft === 0 && i < base.length) break;
    }
    if (best) { placed.set(e.id, best); taken.push(best.rect); }
  }
  return placed;
}

const MIN_DX = 215, MIN_DY = 130;
/** Keeps nodes from sitting on top of each other while one is being dragged. */
export function resolveDrag(m: Model, layout: Layout, id: string, x: number, y: number): { x: number; y: number } {
  let px = x, py = y;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const n of m.nodes) {
      if (n.id === id) continue;
      const p = pos(layout, n.id), dx = px - p.x, dy = py - p.y;
      if (Math.abs(dx) < MIN_DX && Math.abs(dy) < MIN_DY) {
        const pushX = MIN_DX - Math.abs(dx), pushY = MIN_DY - Math.abs(dy);
        if (pushX < pushY) px += (dx >= 0 ? 1 : -1) * pushX; else py += (dy >= 0 ? 1 : -1) * pushY;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: Math.round(px / 5) * 5, y: Math.round(py / 5) * 5 };
}

export function freeSpot(m: Model, layout: Layout, near?: { x: number; y: number }): { x: number; y: number } {
  const pts = m.nodes.map((n) => pos(layout, n.id));
  if (!pts.length) return { x: 200, y: 350 };
  const start = near ?? { x: Math.max(...pts.map((p) => p.x)) + 290, y: pts[pts.length - 1].y };
  return resolveDrag(m, layout, '__new__', start.x, start.y);
}

export function tidy(m: Model, layout: Layout): Layout {
  const out: Layout = { ...layout };
  if (!m.nodes.length) return out;
  const ids = new Set(m.nodes.map((n) => n.id));
  const flow = m.edges.filter((e) => e.type === 'flow' && ids.has(e.from) && ids.has(e.to));
  const byFrom = new Map<string, string[]>();
  for (const e of flow) byFrom.set(e.from, [...(byFrom.get(e.from) ?? []), e.to]);
  const primary: string[] = [], seen = new Set<string>();
  let id: string | undefined = m.startNodeId && ids.has(m.startNodeId) ? m.startNodeId : (m.nodes.find((n) => byFrom.has(n.id) && !flow.some((e) => e.to === n.id)) ?? m.nodes[0]).id;
  while (id && !seen.has(id)) { primary.push(id); seen.add(id); id = (byFrom.get(id) ?? []).find((t) => !seen.has(t)); }
  const x0 = 150, step = 290, y0 = 350;
  primary.forEach((nid, i) => { out[nid] = { x: x0 + i * step, y: y0 }; });
  const slots: Record<string, number> = {};
  let loose = 0;
  for (const n of m.nodes.filter((x) => !seen.has(x.id))) {
    const touching = m.edges.filter((e) => e.from === n.id || e.to === n.id).map((e) => (e.from === n.id ? e.to : e.from));
    const centers = touching.map((t) => primary.indexOf(t)).filter((i) => i >= 0);
    if (centers.length) {
      const at = centers.reduce((s, i) => s + i, 0) / centers.length, slot = String(Math.round(at * 2) / 2);
      slots[slot] = (slots[slot] ?? 0) + 1;
      const above = slots[slot] % 2 === 1, tier = Math.ceil(slots[slot] / 2);
      out[n.id] = { x: x0 + at * step, y: above ? y0 - 20 - tier * 250 : y0 + 20 + tier * 250 };
    } else { out[n.id] = { x: x0 + (loose % Math.max(1, primary.length)) * step, y: y0 + 520 + Math.floor(loose / Math.max(1, primary.length)) * 170 }; loose++; }
  }
  return out;
}

export interface ViewBox { x: number; y: number; w: number; h: number }
export function fitView(m: Model, layout: Layout, aspect: number, ids?: string[]): ViewBox {
  const nodes = m.nodes.filter((n) => !ids || ids.includes(n.id));
  if (!nodes.length) return { x: 0, y: 0, w: 1200, h: 1200 / aspect };
  const pts = nodes.map((n) => pos(layout, n.id));
  if (!ids) {
    for (const edge of m.edges) {
      if (!Object.hasOwn(layout, edge.id)) continue;
      const g = edgeGeom(edge, m, layout);
      if (g) pts.push(labelAtOffset(layout[edge.id], g));
    }
  }
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const padX = 150, padY = 170;
  const w = Math.max(520, maxX - minX + padX * 2, (maxY - minY + padY * 2) * aspect), h = w / aspect;
  return { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2 - 10, w, h };
}

export function wrapNodeLabel(value: string, limit = 16): string[] {
  const words = (value || 'Untitled').trim().split(/\s+/).filter(Boolean), lines = [''];
  for (const word of words) {
    const i = lines.length - 1, next = (lines[i] + ' ' + word).trim();
    if (next.length <= limit) { lines[i] = next; continue; }
    if (lines[i] && lines.length < 2) { lines.push(word); continue; }
    lines[i] = !lines[i] ? word.slice(0, limit - 1) + '…' : lines[i].slice(0, limit - 1).replace(/…?$/, '…');
    break;
  }
  if (lines[1]?.length > limit) lines[1] = lines[1].slice(0, limit - 1) + '…';
  return lines.slice(0, 2);
}
