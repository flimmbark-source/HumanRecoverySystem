import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { canEdit, editLayout, getState, rememberView, select, setState, toast, undo, redo, useStore, viewBox as savedView } from './store';
import { addEdge, addNode } from './ops';
import { MOVE_SHARE, usePlay } from './play';
import { EDGE_TYPES, EDGE_TYPE_HINT, EDGE_TYPE_LABEL, activityForEdge, fmtQty, type EdgeType, type Layout, type Model, type NodeKind, type WEdge, type WNode } from '../shared/model';
import { NODE_H, edgeGeom, fitView, followLabel, labelOffset, labelWidth, nodeW, placeLabels, pointAt, pos, resolveDrag, shortLabel, tidy, wrapNodeLabel, type LabelPoint, type ViewBox } from '../shared/layout';
import { diffModels } from '../shared/diff';
import { analyzeRoute } from '../shared/routes';

export const TYPE_COLOR: Record<EdgeType, string> = { flow: '#567fa7', info: '#3f8f81', dependency: '#a8823c', authority: '#8a6fa0', association: '#7f8b93' };
const DASH: Record<EdgeType, string> = { flow: '', info: '8 6', dependency: '2 6', authority: '11 3 2 3', association: '5 5' };
const LABEL_FILL: Record<EdgeType, string> = { flow: '#f1f6fc', info: '#eff9f5', dependency: '#fffaef', authority: '#f6f2fa', association: '#f4f5f6' };
const PALETTE: Record<NodeKind, [string, string, string]> = { person: ['#e1f2e7', '#f6fbf7', '#8bc3a3'], system: ['#dbe9fa', '#f5f9fd', '#85abd1'], output: ['#f9ead2', '#fffbf4', '#d3a96a'], group: ['#eee7f6', '#faf8fd', '#ad99ca'], resource: ['#e5edef', '#f7fafb', '#9cafb8'] };
export const KIND_ICON: Record<NodeKind, string> = { person: '◉', system: '▦', output: '◇', group: '❖', resource: '▤' };
const LEGEND_KEY = 'weave:map-legend';

type Drag =
  | { type: 'node' | 'label'; id: string; pointerId: number; cx: number; cy: number; dx: number; dy: number; moved: boolean }
  | { type: 'pan'; vx: number; vy: number; cx: number; cy: number; moved: boolean }
  | { type: 'pinch'; d: number }
  | { type: 'link'; from: string };

function legendInitiallyOpen() {
  try {
    const saved = localStorage.getItem(LEGEND_KEY);
    if (saved !== null) return saved === 'open';
  } catch { /* Use the default if storage is blocked. */ }
  return window.innerWidth > 720;
}

export function edgeSub(m: Model, e: WEdge): string {
  const a = activityForEdge(m, e.id);
  if (e.type === 'flow' || (a && e.type === 'info')) {
    const act = a?.activeMinutes.value == null ? (a?.activeMinutes.min !== undefined ? `${fmtQty(a.activeMinutes)}m` : '?') : `${fmtQty(a.activeMinutes)}m`;
    const w = a?.waitMinutes.value;
    const base = `${act} active${w ? ` · ${fmtQty({ ...a!.waitMinutes, value: w / 60 })}h wait` : ''}`;
    return e.type === 'info' ? 'information' : base;
  }
  return EDGE_TYPE_HINT[e.type];
}

function Token({ model, layout }: { model: Model; layout: Layout }) {
  const routeId = useStore((s) => s.routeId);
  const t = usePlay((p) => p.t), steps = usePlay((p) => p.steps);
  const route = model.routes.find((r) => r.id === routeId);
  if (!route || !steps) return null;
  const a = analyzeRoute(model, route);
  const i = Math.min(Math.floor(t), a.steps.length - 1), f = Math.min(1, t - i);
  const step = a.steps[i];
  if (!step || step.missing) return null;
  let x: number, y: number;
  const waiting = f > MOVE_SHARE;
  if (step.edge) { const g = edgeGeom(step.edge, model, layout); if (!g) return null; ({ x, y } = pointAt(g, Math.min(1, f / MOVE_SHARE))); }
  else { const p = pos(layout, step.fromNodeId ?? ''); x = p.x; y = p.y - NODE_H / 2 - 16; }
  return (
    <g className={`token${waiting ? ' waiting' : ''}`} data-testid="play-token" data-step={i} data-phase={waiting ? 'waiting' : 'active'} pointerEvents="none">
      <circle cx={x} cy={y} r={waiting ? 21 : 17} fill="#e4b365" opacity={0.2} />
      <circle cx={x} cy={y} r={9} fill={waiting ? '#fff7e2' : '#d99a35'} stroke="#b9791d" strokeWidth={2.5} strokeDasharray={waiting ? '3 3' : ''} />
    </g>
  );
}

export function Graph() {
  const model = useStore((s) => s.model)!, layout = useStore((s) => s.layout), selection = useStore((s) => s.selection), mode = useStore((s) => s.mode);
  const compareModel = useStore((s) => s.compareModel), notes = useStore((s) => s.evidence.notes), placing = useStore((s) => s.placing), linkFrom = useStore((s) => s.linkFrom);
  const routeId = useStore((s) => s.routeId), branchId = useStore((s) => s.branchId);
  const canUndo = useStore((s) => s.canUndo), canRedo = useStore((s) => s.canRedo);
  const svgRef = useRef<SVGSVGElement>(null), wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewBox | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dragLabel, setDragLabel] = useState<(LabelPoint & { id: string }) | null>(null);
  const [labelPreference, setLabelPreference] = useState<{ layout: Layout; positions: ReadonlyMap<string, LabelPoint> } | null>(null);
  const [linkPoint, setLinkPoint] = useState<{ x: number; y: number } | null>(null);
  const [search, setSearch] = useState(''), [hideContext, setHideContext] = useState(false), [focusOnly, setFocusOnly] = useState(false), [legend, setLegend] = useState(legendInitiallyOpen);
  const drag = useRef<Drag | null>(null), pointers = useRef(new Map<number, { x: number; y: number }>());
  const editable = canEdit() && mode !== 'timeline';
  const playStep = usePlay((p) => (mode === 'timeline' && p.steps ? Math.min(Math.floor(p.t), p.steps - 1) : -1));

  const aspect = () => { const el = wrapRef.current; return el ? Math.max(0.3, el.clientWidth / Math.max(1, el.clientHeight)) : 1.6; };
  const lay: Layout = useMemo(() => (dragPos ? { ...layout, [dragPos.id]: { x: dragPos.x, y: dragPos.y } } : layout), [layout, dragPos]);
  const visibleModel: Model = useMemo(() => (hideContext ? { ...model, nodes: model.nodes.filter((n) => n.scope !== 'context'), edges: model.edges.filter((e) => { const a = model.nodes.find((n) => n.id === e.from), b = model.nodes.find((n) => n.id === e.to); return a?.scope !== 'context' && b?.scope !== 'context'; }) } : model), [model, hideContext]);
  const settledLabels = useMemo(() => placeLabels(visibleModel, layout, labelPreference?.layout === layout ? labelPreference.positions : undefined), [visibleModel, layout, labelPreference]);
  const labels = useMemo(() => {
    if (!dragPos) return settledLabels;
    const positions = new Map<string, LabelPoint>(settledLabels);
    for (const edge of visibleModel.edges) {
      if (edge.from !== dragPos.id && edge.to !== dragPos.id) continue;
      const label = settledLabels.get(edge.id);
      const before = edgeGeom(edge, visibleModel, layout), after = edgeGeom(edge, visibleModel, lay);
      if (label && before && after) positions.set(edge.id, followLabel(label, before, after));
    }
    return positions;
  }, [dragPos, settledLabels, visibleModel, layout, lay]);
  const diff = useMemo(() => (mode === 'scenario' && compareModel && branchId !== 'baseline' ? diffModels(compareModel, model) : null), [mode, compareModel, model, branchId]);

  const keep = (v: ViewBox | null) => rememberView(v ? ({ ...v, a: aspect() } as ViewBox) : null);
  const fit = (ids?: string[]) => { const v = fitView(visibleModel, lay, aspect(), ids); setView(v); keep(v); };
  // On a phone the whole map would be unreadable, so open on the start of the flow; Fit shows everything.
  const firstView = () => {
    if (window.innerWidth > 720 || model.nodes.length < 3) return fit();
    const start = model.nodes.find((n) => n.id === model.startNodeId) ?? model.nodes[0];
    const next = model.edges.find((e) => e.from === start.id && e.type === 'flow');
    fit(next ? [start.id, next.to] : [start.id]);
  };
  // A remembered view is only reused on a canvas of similar shape; otherwise the map is fitted afresh.
  useLayoutEffect(() => {
    const sv = savedView as (ViewBox & { a?: number }) | null;
    if (!view && sv && sv.a && Math.abs(sv.a - aspect()) / aspect() < 0.2 && window.innerWidth > 720) setView({ x: sv.x, y: sv.y, w: sv.w, h: sv.w / aspect() });
    else if (!view) firstView();
    /* eslint-disable-next-line */
  }, [branchId]);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setView((v) => { if (!v) return v; const h = v.w / aspect(); return { ...v, y: v.y + (v.h - h) / 2, h }; }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => { const h = () => fit(); window.addEventListener('weave:fit', h); return () => window.removeEventListener('weave:fit', h); });

  const toSvg = (cx: number, cy: number) => {
    const svg = svgRef.current!, r = svg.getBoundingClientRect(), v = view!;
    return { x: v.x + ((cx - r.left) / r.width) * v.w, y: v.y + ((cy - r.top) / r.height) * v.h };
  };
  const zoomBy = (factor: number, at?: { x: number; y: number }) => setView((v) => {
    if (!v) return v;
    const c = at ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 };
    const w = Math.max(320, Math.min(6000, v.w * factor)), h = w / aspect();
    const nv = { x: c.x - ((c.x - v.x) * w) / v.w, y: c.y - ((c.y - v.y) * h) / v.h, w, h };
    keep(nv); return nv;
  });
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.1 : 0.91, toSvg(e.clientX, e.clientY)); };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  });

  const neighbors = useMemo(() => {
    if (!focusOnly || !selection) return null;
    const set = new Set<string>();
    if (selection.type === 'node') { set.add(selection.id); for (const e of model.edges) if (e.from === selection.id || e.to === selection.id) { set.add(e.id); set.add(e.from); set.add(e.to); } }
    else if (selection.type === 'edge') { const e = model.edges.find((x) => x.id === selection.id); if (e) { set.add(e.id); set.add(e.from); set.add(e.to); } }
    else { const a = model.activities.find((x) => x.id === selection.id); if (a?.ownerNodeId) set.add(a.ownerNodeId); }
    return set;
  }, [focusOnly, selection, model]);
  const term = search.trim().toLowerCase();
  const matches = (text: string) => !term || text.toLowerCase().includes(term);
  const dim = (id: string, text: string) => (neighbors && !neighbors.has(id)) || !matches(text);

  const onBgDown = (e: React.PointerEvent) => {
    if (drag.current?.type === 'node' || drag.current?.type === 'label') return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; drag.current = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) }; return; }
    if (placing && editable) { const p = toSvg(e.clientX, e.clientY); addNode(placing as NodeKind, p); setState({ placing: null }); return; }
    if (linkFrom) { setState({ linkFrom: null }); setLinkPoint(null); toast('Connection cancelled'); return; }
    drag.current = { type: 'pan', vx: view!.x, vy: view!.y, cx: e.clientX, cy: e.clientY, moved: false };
    svgRef.current!.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (linkFrom && !d) { setLinkPoint(toSvg(e.clientX, e.clientY)); return; }
    if (!d) return;
    if (d.type === 'pinch' && pointers.current.size === 2) { const [a, b] = [...pointers.current.values()], dist = Math.hypot(a.x - b.x, a.y - b.y); if (d.d > 0 && dist > 0) zoomBy(d.d / dist, toSvg((a.x + b.x) / 2, (a.y + b.y) / 2)); d.d = dist; return; }
    if (d.type === 'pan') {
      const r = svgRef.current!.getBoundingClientRect();
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 4) d.moved = true;
      setView((v) => (v ? { ...v, x: d.vx - ((e.clientX - d.cx) * v.w) / r.width, y: d.vy - ((e.clientY - d.cy) * v.h) / r.height } : v));
    } else if (d.type === 'node' || d.type === 'label') {
      if (e.pointerId !== d.pointerId) return;
      if (!d.moved && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 5) return;
      d.moved = true;
      const p = toSvg(e.clientX, e.clientY);
      const x = p.x + d.dx, y = p.y + d.dy;
      if (d.type === 'label') setDragLabel({ id: d.id, x, y });
      else setDragPos({ id: d.id, ...resolveDrag(model, layout, d.id, x, y) });
    } else if (d.type === 'link') setLinkPoint(toSvg(e.clientX, e.clientY));
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (!d || ('pointerId' in d && e.pointerId !== d.pointerId)) return;
    drag.current = null;
    if (d.type === 'pan') { if (!d.moved) select(null); else setView((v) => { keep(v); return v; }); }
    else if (d.type === 'node') {
      if (d.moved && dragPos) {
        setLabelPreference({ layout: lay, positions: labels });
        editLayout(lay);
        setDragPos(null);
      } else select({ type: 'node', id: d.id });
    } else if (d.type === 'label') {
      setDragLabel(null);
      if (!d.moved) { select({ type: 'edge', id: d.id }); return; }
      const edge = visibleModel.edges.find((edge) => edge.id === d.id);
      const g = edge && edgeGeom(edge, visibleModel, layout);
      if (g) {
        const p = toSvg(e.clientX, e.clientY);
        const nextLayout = { ...layout, [d.id]: labelOffset({ x: p.x + d.dx, y: p.y + d.dy }, g) };
        setLabelPreference({ layout: nextLayout, positions: labels });
        editLayout(nextLayout);
      }
    } else if (d.type === 'link') {
      const p = toSvg(e.clientX, e.clientY);
      const dest = model.nodes.find((n) => n.id !== d.from && Math.abs(pos(layout, n.id).x - p.x) < nodeW(n) / 2 + 8 && Math.abs(pos(layout, n.id).y - p.y) < NODE_H / 2 + 8);
      if (dest) { addEdge(d.from, dest.id); setState({ linkFrom: null }); setLinkPoint(null); }
      else toast('Now choose the destination node (or press Escape).');
    }
  };
  const onNodeDown = (e: React.PointerEvent, n: WNode) => {
    e.stopPropagation();
    if (!e.isPrimary || e.button !== 0) return;
    if (linkFrom) { if (linkFrom !== n.id) addEdge(linkFrom, n.id); setState({ linkFrom: null }); setLinkPoint(null); return; }
    if (!editable) { select({ type: 'node', id: n.id }); return; }
    startBoxDrag(e, 'node', n.id, pos(layout, n.id));
  };
  const startBoxDrag = (e: React.PointerEvent, type: 'node' | 'label', id: string, point: LabelPoint) => {
    const p = toSvg(e.clientX, e.clientY);
    drag.current = { type, id, pointerId: e.pointerId, dx: point.x - p.x, dy: point.y - p.y, cx: e.clientX, cy: e.clientY, moved: false };
    svgRef.current!.setPointerCapture(e.pointerId);
  };
  const startLink = (e: React.PointerEvent | React.KeyboardEvent, n: WNode, dragging: boolean) => {
    e.stopPropagation(); e.preventDefault();
    setState({ linkFrom: n.id });
    if (dragging) { drag.current = { type: 'link', from: n.id }; svgRef.current!.setPointerCapture((e as React.PointerEvent).pointerId); }
    toast('Choose the destination node. Escape cancels.');
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (getState().linkFrom || getState().placing)) { setState({ linkFrom: null, placing: null }); setLinkPoint(null); }
      const tag = (e.target as HTMLElement)?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || getState().modal) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);

  const noteCount = (id: string) => notes.filter((n) => n.targetId === id).length;
  const selEdge = selection?.type === 'edge' ? model.edges.find((e) => e.id === selection.id) : null;
  const endpoints = new Set(selEdge ? [selEdge.from, selEdge.to] : []);
  const route = mode === 'timeline' ? model.routes.find((r) => r.id === routeId) : null;
  const routeRefs = new Set(route?.steps.map((s) => s.refId));
  const activeRef = route && playStep >= 0 ? route.steps[playStep]?.refId : null;
  const v = view ?? { x: 0, y: 0, w: 1200, h: 720 };
  const ghosts = diff && compareModel ? { edges: compareModel.edges.filter((e) => diff.removed.has(e.id)), nodes: compareModel.nodes.filter((n) => diff.removed.has(n.id)) } : null;
  const ghostLayout: Layout = ghosts ? { ...Object.fromEntries(compareModel!.nodes.map((n) => [n.id, pos(lay, n.id)])), ...lay } : lay;
  const labelsDraggable = editable && !linkFrom && !placing;
  const toggleLegend = () => {
    setLegend(!legend);
    try { localStorage.setItem(LEGEND_KEY, legend ? 'closed' : 'open'); } catch { /* The in-memory toggle still works. */ }
  };

  return (
    <div className={`canvas-wrap${placing ? ' placing' : ''}`} ref={wrapRef}>
      <div className="canvas-tools">
        <input type="search" placeholder="Search map" aria-label="Search the map" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="toggle"><input type="checkbox" checked={focusOnly} onChange={(e) => setFocusOnly(e.target.checked)} /> Focus on selection</label>
        {model.nodes.some((n) => n.scope === 'context') && <label className="toggle"><input type="checkbox" checked={hideContext} onChange={(e) => setHideContext(e.target.checked)} /> Hide context</label>}
      </div>
      <svg ref={svgRef} className={`graph${labelsDraggable ? ' labels-draggable' : ''}${dragLabel ? ' dragging-label' : ''}`} data-testid="graph" viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} role="group" aria-label={`Map of ${model.name || 'the workflow'}: ${model.nodes.length} nodes and ${model.edges.length} connections`}
        onPointerDown={onBgDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={(e) => {
          const d = drag.current;
          if (d && 'pointerId' in d && d.pointerId !== e.pointerId) return;
          drag.current = null; pointers.current.clear(); setDragPos(null); setDragLabel(null);
        }}>
        <defs>
          <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="#d5ddd3" /></pattern>
          {EDGE_TYPES.map((t) => (<marker key={t} id={`arrow-${t}`} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4.5 L1 8" fill="none" stroke={TYPE_COLOR[t]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></marker>))}
          <marker id="auth-start" markerWidth="12" markerHeight="12" refX="6" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 6 L6 2 L11 6 L6 10 Z" fill="#fff" stroke={TYPE_COLOR.authority} strokeWidth="1.5" /></marker>
        </defs>
        <rect x={v.x - 4000} y={v.y - 4000} width={v.w + 8000} height={v.h + 8000} fill="url(#dots)" pointerEvents="none" />

        {ghosts?.edges.map((e) => { const g = edgeGeom(e, compareModel!, ghostLayout); return g && (<g key={`ghost-${e.id}`} className="ghost" data-removed={e.id}><path d={g.d} fill="none" stroke="#b56a5d" strokeWidth={2.2} strokeDasharray="4 7" /><text x={g.mx} y={g.my - 10} textAnchor="middle" className="ghost-text">removed: {shortLabel(e.label)}</text></g>); })}
        {ghosts?.nodes.map((n) => { const p = pos(ghostLayout, n.id), w = nodeW(n); return (<g key={`ghost-${n.id}`} className="ghost" data-removed={n.id} transform={`translate(${p.x} ${p.y})`}><rect x={-w / 2} y={-NODE_H / 2} width={w} height={NODE_H} rx={14} fill="#fbf1ee" stroke="#b56a5d" strokeDasharray="4 6" /><text y={4} textAnchor="middle" className="ghost-text">removed: {shortLabel(n.label, 20)}</text></g>); })}

        <g>
          {visibleModel.edges.map((e) => {
            const g = edgeGeom(e, visibleModel, lay), l = dragLabel?.id === e.id ? dragLabel : labels.get(e.id);
            if (!g || !l) return null;
            const sel = selection?.type === 'edge' && selection.id === e.id, color = TYPE_COLOR[e.type], count = noteCount(e.id);
            const changed = diff && (diff.added.has(e.id) || diff.changed.has(e.id)), flagged = diff?.downstream.some((d) => d.id === e.id);
            const far = Math.hypot(l.x - g.mx, l.y - g.my) > 125, w = labelWidth(e.label);
            const cls = `edgegroup${sel ? ' selected' : ''}${dim(e.id, `${e.label} ${e.workItem} ${e.description}`) ? ' dim' : ''}${route && !routeRefs.has(e.id) ? ' offroute' : ''}${activeRef === e.id ? ' playing' : ''}`;
            return (
              <g key={e.id} className={cls} data-edge={e.id} data-type={e.type} tabIndex={0} role="button" aria-label={`${EDGE_TYPE_LABEL[e.type]} connection: ${e.label}, from ${model.nodes.find((n) => n.id === e.from)?.label} to ${model.nodes.find((n) => n.id === e.to)?.label}`}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select({ type: 'edge', id: e.id }); } }}>
                {changed && <path d={g.d} stroke="#bfe5c2" strokeWidth={12} fill="none" opacity={0.9} />}
                {flagged && !changed && <path d={g.d} stroke="#f6dfa4" strokeWidth={11} fill="none" opacity={0.9} />}
                <path className="edgepath" d={g.d} stroke={color} strokeWidth={sel ? 4 : 2.6} strokeDasharray={DASH[e.type]} fill="none" markerEnd={e.directed ? `url(#arrow-${e.type})` : undefined} markerStart={e.type === 'authority' ? 'url(#auth-start)' : undefined} />
                <path className="edgehot" d={g.d} stroke="transparent" strokeWidth={22} fill="none" onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => { ev.stopPropagation(); select({ type: 'edge', id: e.id }); }} />
                {far && <line x1={g.mx} y1={g.my} x2={l.x} y2={l.y} stroke={color} strokeWidth={1} strokeDasharray="2 4" opacity={0.7} pointerEvents="none" />}
                <g className="edgeLabel" data-label-for={e.id} transform={`translate(${l.x} ${l.y})`}
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    if (labelsDraggable && ev.isPrimary && ev.button === 0) startBoxDrag(ev, 'label', e.id, l);
                  }}
                  onClick={(ev) => { ev.stopPropagation(); if (!labelsDraggable || ev.detail === 0) select({ type: 'edge', id: e.id }); }}>
                  <rect x={-w / 2} y={-21} rx={8} width={w} height={33} fill={LABEL_FILL[e.type]} stroke={color} strokeWidth={sel ? 2.2 : 1} />
                  <text x={0} y={-8} textAnchor="middle" className="edge-title">{shortLabel(e.label)}</text>
                  <text x={0} y={4} textAnchor="middle" className="edge-sub">{edgeSub(model, e)}</text>
                  <title>{`${e.label} · ${EDGE_TYPE_LABEL[e.type]}`}</title>
                </g>
                {count > 0 && (<g className="note-pin" data-pin-for={e.id} transform={`translate(${l.x + w / 2 + 13} ${l.y - 12})`} role="img" aria-label={`${count} note${count === 1 ? '' : 's'}`}><circle r={11} fill="#f8d478" /><text y={4} textAnchor="middle">{count}</text></g>)}
              </g>
            );
          })}
        </g>

        <g>
          {visibleModel.nodes.map((n) => {
            const p = pos(lay, n.id), w = nodeW(n), [tile, fill, stroke] = PALETTE[n.kind];
            const sel = selection?.type === 'node' && selection.id === n.id, lines = wrapNodeLabel(n.label, 16), count = noteCount(n.id);
            const internal = model.activities.filter((a) => !a.edgeId && a.ownerNodeId === n.id).length;
            const changed = diff && (diff.added.has(n.id) || diff.changed.has(n.id)), flagged = diff?.downstream.some((d) => d.id === n.id) || diff?.unreachableOutcomes.some((o) => o.id === n.id);
            const sub = n.role || n.kind;
            return (
              <g key={n.id} className={`nodeSvg${sel ? ' selected' : ''}${endpoints.has(n.id) ? ' endpoint' : ''}${dim(n.id, `${n.label} ${n.role} ${n.description}`) ? ' dim' : ''}${linkFrom === n.id ? ' linking' : ''}`} data-node={n.id} data-scope={n.scope} transform={`translate(${p.x} ${p.y})`}
                tabIndex={0} role="button" aria-label={`${n.kind} ${n.label}${n.scope !== 'internal' ? `, ${n.scope} to the reviewed scope` : ''}`}
                onPointerDown={(ev) => onNodeDown(ev, n)}
                onKeyDown={(ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); if (linkFrom && linkFrom !== n.id) { addEdge(linkFrom, n.id); setState({ linkFrom: null }); } else select({ type: 'node', id: n.id }); } }}>
                {changed && <rect x={-w / 2 - 6} y={-NODE_H / 2 - 6} width={w + 12} height={NODE_H + 12} rx={18} stroke="#a8d4af" strokeWidth={2} fill="#e2f3e3" />}
                {flagged && !changed && <rect x={-w / 2 - 6} y={-NODE_H / 2 - 6} width={w + 12} height={NODE_H + 12} rx={18} stroke="#e5c56f" strokeWidth={2} fill="#fdf5dc" />}
                <rect className="base" x={-w / 2} y={-NODE_H / 2} width={w} height={NODE_H} rx={14} fill={fill} stroke={stroke} strokeDasharray={n.scope === 'external' ? '6 4' : n.scope === 'context' ? '2 4' : undefined} />
                <rect x={-w / 2} y={-NODE_H / 2 + 8} width={5} height={NODE_H - 16} rx={2} fill={stroke} />
                <rect x={-w / 2 + 12} y={-NODE_H / 2 + 12} width={30} height={30} rx={8} fill={tile} />
                <text x={-w / 2 + 27} y={-NODE_H / 2 + 33} textAnchor="middle" className="nodeicon">{KIND_ICON[n.kind]}</text>
                <text x={-w / 2 + 50} y={lines.length > 1 ? -13 : -5} className="name">{lines.map((ln, i) => <tspan key={i} x={-w / 2 + 50} dy={i ? 16 : 0}>{ln}</tspan>)}</text>
                <text x={-w / 2 + 50} y={lines.length > 1 ? 26 : 18} className="subtitle">{sub.length > 18 ? sub.slice(0, 17) + '…' : sub}</text>
                <title>{`${n.label}${n.role ? ` · ${n.role}` : ''}`}</title>
                {n.scope !== 'internal' && (<g className="scope-tag" transform={`translate(${-w / 2 + 5} ${NODE_H / 2 + 9})`}><rect x={0} y={-2} width={70} height={17} rx={7} fill="#fef7e9" stroke="#dfc79e" /><text x={35} y={10} textAnchor="middle">{n.scope === 'external' ? 'EXTERNAL' : 'CONTEXT'}</text></g>)}
                {internal > 0 && <text x={n.scope !== 'internal' ? -w / 2 + 84 : -w / 2 + 8} y={NODE_H / 2 + 19} className="internal-count">◈ {internal} internal {internal === 1 ? 'activity' : 'activities'}</text>}
                {count > 0 && (<g className="note-pin" data-pin-for={n.id} transform={`translate(${w / 2 - 2} ${-NODE_H / 2 - 3})`} role="img" aria-label={`${count} note${count === 1 ? '' : 's'}`}><circle r={11} fill="#f6ce79" /><text y={4} textAnchor="middle">{count}</text></g>)}
                {editable && (<circle className="port" cx={w / 2} cy={0} r={8} tabIndex={0} role="button" aria-label={`Start a connection from ${n.label}`}
                  onPointerDown={(ev) => startLink(ev, n, true)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') startLink(ev, n, false); }} />)}
              </g>
            );
          })}
        </g>
        {linkFrom && linkPoint && (() => { const p = pos(lay, linkFrom); return <line x1={p.x} y1={p.y} x2={linkPoint.x} y2={linkPoint.y} stroke="#467b64" strokeWidth={2} strokeDasharray="5 5" pointerEvents="none" />; })()}
        {mode === 'timeline' && <Token model={model} layout={lay} />}
      </svg>

      {!model.nodes.length && <div className="canvas-empty"><b>This map is empty.</b><p>Add a role, system or output to begin.</p></div>}
      {placing && <div className="canvas-hint">Click the canvas to place the new {placing}. Escape cancels.</div>}
      {linkFrom && <div className="canvas-hint">Choose the destination node. Escape cancels.</div>}

      <div className={`canvas-legend${legend ? '' : ' closed'}`} data-testid="legend">
        <button type="button" className="legend-toggle" onClick={toggleLegend} aria-label={legend ? 'Collapse legend' : 'Expand legend'} aria-expanded={legend}>
          Legend
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {legend && (<ul>
          {EDGE_TYPES.map((t) => (<li key={t} data-legend={t}><svg width="30" height="10" aria-hidden="true"><line x1="1" y1="5" x2="29" y2="5" stroke={TYPE_COLOR[t]} strokeWidth="2.6" strokeDasharray={DASH[t]} /></svg><span>{EDGE_TYPE_LABEL[t]}</span><em>{EDGE_TYPE_HINT[t]}</em></li>))}
          <li><svg width="30" height="12" aria-hidden="true"><rect x="2" y="1" width="26" height="10" rx="3" fill="#fff" stroke="#8bc3a3" strokeDasharray="4 3" /></svg><span>External</span><em>outside reviewed scope</em></li>
          {diff && <li><svg width="30" height="10" aria-hidden="true"><line x1="1" y1="5" x2="29" y2="5" stroke="#bfe5c2" strokeWidth="8" /></svg><span>Changed</span><em>vs comparison</em></li>}
          {diff && <li><svg width="30" height="10" aria-hidden="true"><line x1="1" y1="5" x2="29" y2="5" stroke="#f6dfa4" strokeWidth="8" /></svg><span>Investigate</span><em>downstream</em></li>}
        </ul>)}
      </div>
      <div className="canvas-actions" role="toolbar" aria-label="Map view controls">
        {canEdit() && <><button onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button><button onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">↷</button><span className="sep" /></>}
        <button onClick={() => zoomBy(1.2)} aria-label="Zoom out">−</button>
        <button onClick={() => zoomBy(0.83)} aria-label="Zoom in">+</button>
        <button onClick={() => fit()} aria-label="Fit the whole map">Fit</button>
        {editable && <button data-testid="tidy" onClick={() => { editLayout(tidy(model, layout)); setTimeout(() => window.dispatchEvent(new Event('weave:fit')), 0); toast('Layout spaced out. Undo restores the previous arrangement.'); }} aria-label="Tidy the layout (undoable)">Tidy</button>}
      </div>
    </div>
  );
}
