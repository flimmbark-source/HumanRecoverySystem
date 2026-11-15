// Model edit operations used by the canvas, inspector and forms.
import { editModel, getState, select, toast } from './store';
import { activityForEdge, newId, qty, unknownQty, type EdgeType, type Model, type NodeKind, type WActivity, type WEdge, type WNode } from '../shared/model';
import { freeSpot } from '../shared/layout';

const ids = (m: Model) => [...m.nodes, ...m.edges, ...m.activities].map((x) => x.id);
const KIND_DEFAULT: Record<NodeKind, string> = { person: 'New role', system: 'New system', resource: 'New resource', output: 'New output', group: 'New group' };

export function addNode(kind: NodeKind, at?: { x: number; y: number }, label?: string, scope: WNode['scope'] = 'internal'): string {
  let id = '';
  editModel((m, layout) => {
    id = newId('n', ids(m));
    m.nodes.push({ id, kind, label: (label ?? '').trim() || KIND_DEFAULT[kind], role: '', description: '', scope, parentId: null });
    layout[id] = at ? { x: Math.round(at.x / 5) * 5, y: Math.round(at.y / 5) * 5 } : freeSpot(m, layout);
    if (!m.startNodeId && m.nodes.length === 1) m.startNodeId = id;
  }, `Add ${kind}`);
  select({ type: 'node', id });
  return id;
}

export const newActivity = (m: Model, e: Pick<WEdge, 'id' | 'label'>): WActivity => ({
  id: newId('a', ids(m)), edgeId: e.id, ownerNodeId: null, performerId: null, actionCode: null, label: e.label, includedInWorkload: true,
  activeMinutes: unknownQty('min'), waitMinutes: unknownQty('min'), occurrencesPerCase: qty(1, 'per case', 'assumed'),
});

export function addEdge(from: string, to: string, type: EdgeType = 'flow', label = ''): string | null {
  const m0 = getState().model;
  if (!m0 || from === to) { toast('Choose two different nodes to connect.'); return null; }
  let id = '';
  editModel((m) => {
    id = newId('e', ids(m));
    const edge: WEdge = { id, from, to, type, label: label.trim() || (type === 'flow' ? 'New handoff' : type === 'info' ? 'New message' : type === 'dependency' ? 'Depends on' : type === 'authority' ? 'Responsible for' : 'Related'), directed: type !== 'association', activityId: null, workItem: '', result: '', inputState: '', outputState: '', conditions: '', exceptions: '', description: '' };
    if (type === 'flow' || type === 'info') { const a = newActivity(m, edge); edge.activityId = a.id; m.activities.push(a); }
    m.edges.push(edge);
  }, 'Add connection');
  select({ type: 'edge', id });
  return id;
}

export function updateNode(id: string, patch: Partial<WNode>, field = '') {
  editModel((m) => { const n = m.nodes.find((x) => x.id === id); if (n) Object.assign(n, patch); }, 'Edit node', `node:${id}:${field}`);
}
export function updateEdge(id: string, patch: Partial<WEdge>, field = '') {
  editModel((m) => {
    const e = m.edges.find((x) => x.id === id); if (!e) return;
    Object.assign(e, patch);
    const a = activityForEdge(m, id);
    if (patch.label !== undefined && a) a.label = patch.label || 'Activity';
    if (patch.type !== undefined) {
      e.directed = patch.type !== 'association';
      if ((patch.type === 'flow' || patch.type === 'info') && !a) { const na = newActivity(m, e); e.activityId = na.id; m.activities.push(na); }
    }
  }, 'Edit connection', `edge:${id}:${field}`);
}
/** Performer, action and timing live on the activity only; a connection without one gets one on first edit. */
export function updateActivityForEdge(edgeId: string, fn: (a: WActivity) => void, field = '') {
  editModel((m) => {
    const e = m.edges.find((x) => x.id === edgeId); if (!e) return;
    let a = activityForEdge(m, edgeId);
    if (!a) { a = newActivity(m, e); e.activityId = a.id; m.activities.push(a); }
    fn(a);
  }, 'Edit activity', `act:${edgeId}:${field}`);
}
export function updateActivity(id: string, fn: (a: WActivity) => void, field = '') {
  editModel((m) => { const a = m.activities.find((x) => x.id === id); if (a) fn(a); }, 'Edit activity', `act:${id}:${field}`);
}
export function addInternalActivity(nodeId: string, label = 'New internal activity'): string {
  let id = '';
  editModel((m) => {
    id = newId('a', ids(m));
    m.activities.push({ id, edgeId: null, ownerNodeId: nodeId, performerId: nodeId, actionCode: null, label, includedInWorkload: true, activeMinutes: unknownQty('min'), waitMinutes: unknownQty('min'), occurrencesPerCase: qty(1, 'per case', 'assumed') });
  }, 'Add internal activity');
  select({ type: 'activity', id });
  return id;
}

/** Removes the selected item. Route steps and notes that pointed at it are kept and reported as broken / historical. */
export function deleteItem(sel: { type: 'node' | 'edge' | 'activity'; id: string }) {
  editModel((m, layout) => {
    if (sel.type === 'node') {
      const gone = new Set(m.edges.filter((e) => e.from === sel.id || e.to === sel.id).map((e) => e.id));
      m.edges = m.edges.filter((e) => !gone.has(e.id));
      m.activities = m.activities.filter((a) => !(a.edgeId && gone.has(a.edgeId)) && a.ownerNodeId !== sel.id);
      for (const a of m.activities) if (a.performerId === sel.id) a.performerId = null;
      for (const n of m.nodes) if (n.parentId === sel.id) n.parentId = null;
      m.nodes = m.nodes.filter((n) => n.id !== sel.id);
      if (m.startNodeId === sel.id) m.startNodeId = null;
      for (const r of m.routes) { if (r.startNodeId === sel.id) r.startNodeId = null; if (r.endNodeId === sel.id) r.endNodeId = null; }
      delete layout[sel.id];
    } else if (sel.type === 'edge') {
      m.edges = m.edges.filter((e) => e.id !== sel.id);
      m.activities = m.activities.filter((a) => a.edgeId !== sel.id);
    } else m.activities = m.activities.filter((a) => a.id !== sel.id);
  }, `Delete ${sel.type}`);
  select(null);
}
