// Client state. The working model is a local draft that autosaves as an immutable revision with an optimistic check.
import { useSyncExternalStore } from 'react';
import { ApiError, del, get, issuesText, patch, post, put } from './api';
import { type Layout, type Model } from '../shared/model';
import type { DecisionOption, EvidenceLink, Insight, Note, Opportunity, Source } from '../shared/workspace';
import type { Candidate } from '../shared/candidates';

export type Nav = 'map' | 'notes' | 'insights' | 'decide' | 'research' | 'report' | 'settings';
export type Mode = 'structure' | 'timeline' | 'scenario';
export interface Selection { type: 'node' | 'edge' | 'activity'; id: string }
export interface BranchInfo { id: string; kind: 'baseline' | 'scenario'; name: string; hypothesis: string; parentBranchId: string | null; baseRevisionId: string | null; headRevisionId: string; layout: Layout; origin: { type: string; id: string | null } | null; status: string; createdAt: string }
export interface RevisionInfo { id: string; branchId: string; seq: number; summary: string; author: string; createdAt: string; restoredFrom: string | null; model: Model }
export interface Lineage { branchId: string; branchName: string; revisionId: string; seq: number; createdAt: string; relation: string }
export interface CaptureSession { sourceId: string; label: string; group: string; startedAt: string }
export type V<T> = T & { version: number };
export interface Evidence { sources: V<Source>[]; notes: V<Note>[]; insights: V<Insight>[]; links: V<EvidenceLink>[]; opportunities: V<Opportunity>[]; options: V<DecisionOption>[] }
export interface CandidateRow { id: string; runId: string | null; origin: string; schemaVersion: number; payload: Candidate; originalPayload: Candidate; status: string; baseRevisionId: string | null; duplicateOf: string | null; reviewer: string; reviewedAt: string | null; reviewNote: string; applied: Record<string, string> | null; stale: boolean; refIssues: string[]; alreadyInModel: boolean; edited: boolean }
export interface RunRow { id: string; mode: 'wide' | 'deep'; status: string; question: string; provider: string; input: any; result: any; error: string; attempts: number; maxAttempts: number; createdAt: string; finishedAt: string | null }
export interface ProviderStatus { id: string; label: string; synthetic: boolean; available: boolean; reason: string }
export type SaveState = 'saved' | 'dirty' | 'saving' | 'failed' | 'conflict';

export interface State {
  user: { id: string; name: string; email: string } | null;
  authChecked: boolean;
  project: { id: string; name: string; status: string; meta: Record<string, string>; isSynthetic: boolean } | null;
  role: 'owner' | 'editor' | 'reader';
  members: { id: string; name: string; email: string; role: string }[];
  branches: BranchInfo[];
  provider: ProviderStatus | null;
  branchId: string;
  revision: RevisionInfo | null; // last saved head of the active branch
  model: Model | null; // working draft
  layout: Layout;
  lineage: Lineage[];
  compareTo: string | null; // revision ID used for scenario comparison
  compareModel: Model | null;
  evidence: Evidence;
  research: { runs: RunRow[]; candidates: CandidateRow[]; baselineRevisionId: string } | null;
  nav: Nav; mode: Mode; selection: Selection | null; routeId: string | null;
  inspectorOpen: boolean; // drawer state on narrow screens
  session: CaptureSession | null;
  save: SaveState; saveError: string;
  conflict: { revision: RevisionInfo; layout: Layout } | null;
  recovered: { baseRevisionId: string; model: Model; layout: Layout; at: string } | null;
  canUndo: boolean; canRedo: boolean;
  toast: { text: string; kind: 'info' | 'error' } | null;
  placing: string | null; linkFrom: string | null; modal: { kind: string; data?: any } | null;
  loading: boolean; loadError: string;
}

const emptyEvidence = (): Evidence => ({ sources: [], notes: [], insights: [], links: [], opportunities: [], options: [] });
const initial: State = {
  user: null, authChecked: false, project: null, role: 'reader', members: [], branches: [], provider: null, branchId: 'baseline', revision: null, model: null, layout: {}, lineage: [],
  compareTo: null, compareModel: null, evidence: emptyEvidence(), research: null, nav: 'map', mode: 'structure', selection: null, routeId: null, inspectorOpen: false, session: null,
  save: 'saved', saveError: '', conflict: null, recovered: null, canUndo: false, canRedo: false, toast: null, placing: null, linkFrom: null, modal: null, loading: false, loadError: '',
};

let state = initial;
const listeners = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
export const canEdit = () => state.role !== 'reader';

let toastTimer = 0;
export function toast(text: string, kind: 'info' | 'error' = 'info') {
  setState({ toast: { text, kind } });
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => setState({ toast: null }), kind === 'error' ? 7000 : 3200);
}
export const fail = (e: unknown) => toast(issuesText(e), 'error');

// ---- auth ------------------------------------------------------------------------------------------
export async function checkAuth() {
  try { const r = await get('/me'); setState({ user: r.user, authChecked: true }); } catch { setState({ user: null, authChecked: true }); }
}
export async function signIn(email: string, password: string, name?: string) {
  const r = await post(name !== undefined ? '/auth/signup' : '/auth/login', { email, password, ...(name !== undefined ? { name } : {}) });
  setState({ user: r.user });
}
export async function signOut() {
  await flush().catch(() => {});
  await post('/auth/logout').catch(() => {});
  setState({ ...initial, authChecked: true });
  location.hash = '#/';
}
window.addEventListener('weave:signed-out', () => { if (state.user) { setState({ user: null }); toast('You were signed out. Sign in again; unsaved map edits are kept in this browser.', 'error'); } });

// ---- drafts (recovery across failed saves and reloads) ---------------------------------------------
const draftKey = (pid: string, bid: string) => `weave-draft:${pid}:${bid}`;
function writeDraft() {
  if (!state.project || !state.model || !state.revision) return;
  try { localStorage.setItem(draftKey(state.project.id, state.branchId), JSON.stringify({ baseRevisionId: state.revision.id, model: state.model, layout: state.layout, at: new Date().toISOString() })); } catch { /* storage full or blocked */ }
}
function clearDraft() { if (state.project) try { localStorage.removeItem(draftKey(state.project.id, state.branchId)); } catch { /* ignore */ } }
function readDraft(pid: string, bid: string): State['recovered'] {
  try { const raw = localStorage.getItem(draftKey(pid, bid)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// ---- undo / redo -----------------------------------------------------------------------------------
interface Snap { model: Model; layout: Layout; key: string; at: number }
let undoStack: Snap[] = [], redoStack: Snap[] = [];
const syncUndo = () => setState({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
function resetHistory() { undoStack = []; redoStack = []; syncUndo(); }

// ---- saving ----------------------------------------------------------------------------------------
let saveTimer = 0, layoutTimer = 0, retryTimer = 0, saving: Promise<void> | null = null, layoutDirty = false, pendingSummary = '';

function scheduleSave(summary: string) {
  pendingSummary = pendingSummary && pendingSummary !== summary ? 'Several edits' : summary;
  writeDraft();
  setState({ save: state.save === 'conflict' ? 'conflict' : 'dirty' });
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveNow(), 650);
}
function scheduleLayoutSave() {
  layoutDirty = true;
  writeDraft();
  window.clearTimeout(layoutTimer);
  layoutTimer = window.setTimeout(() => void saveLayout(), 500);
}
async function saveLayout() {
  if (!state.project || !layoutDirty || !canEdit()) return;
  layoutDirty = false;
  try { await put(`/projects/${state.project.id}/branches/${state.branchId}/layout`, { layout: state.layout }); if (state.save === 'saved') clearDraft(); }
  catch { layoutDirty = true; window.clearTimeout(layoutTimer); layoutTimer = window.setTimeout(() => void saveLayout(), 5000); }
}

export async function saveNow(): Promise<void> {
  if (saving) { await saving; if (state.save !== 'dirty') return; }
  if (!state.project || !state.model || !state.revision || state.save === 'conflict' || !canEdit()) return;
  if (JSON.stringify(state.model) === JSON.stringify(state.revision.model)) { setState({ save: 'saved', saveError: '' }); if (!layoutDirty) clearDraft(); return; }
  const sent = state.model, pid = state.project.id, bid = state.branchId, summary = pendingSummary || 'Edit';
  pendingSummary = '';
  window.clearTimeout(retryTimer);
  setState({ save: 'saving', saveError: '' });
  saving = (async () => {
    try {
      const r = await put<{ revision: RevisionInfo }>(`/projects/${pid}/branches/${bid}/model`, { expectedRevisionId: state.revision!.id, model: sent, summary });
      if (state.project?.id !== pid || state.branchId !== bid) return;
      const still = state.model === sent;
      setState((s) => ({ revision: r.revision, save: still ? 'saved' : 'dirty', branches: s.branches.map((b) => (b.id === bid ? { ...b, headRevisionId: r.revision.id } : b)) }));
      if (still) { if (!layoutDirty) clearDraft(); } else scheduleSave(pendingSummary || 'Edit');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body.conflict) setState({ save: 'conflict', conflict: { revision: e.body.current.revision, layout: e.body.current.layout }, saveError: e.message });
      else {
        setState({ save: 'failed', saveError: issuesText(e) });
        // transient failures retry on their own; the draft stays in this browser meanwhile
        if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) retryTimer = window.setTimeout(() => void saveNow(), 6000);
      }
    } finally { saving = null; }
  })();
  await saving;
}
export async function flush() { window.clearTimeout(saveTimer); if (state.save === 'dirty' || state.save === 'failed') await saveNow(); if (layoutDirty) await saveLayout(); }

/** Conflict: adopt the newer saved version and drop the local draft. */
export function resolveUseTheirs() {
  if (!state.conflict) return;
  const { revision, layout } = state.conflict;
  resetHistory(); clearDraft();
  setState((s) => ({ revision, model: revision.model, layout, conflict: null, save: 'saved', saveError: '', branches: s.branches.map((b) => (b.id === s.branchId ? { ...b, headRevisionId: revision.id } : b)) }));
}
/** Conflict: keep the local draft and save it as the next revision on top of the newer one. Nothing is lost; both stay in history. */
export function resolveKeepMine() {
  if (!state.conflict) return;
  setState({ revision: state.conflict.revision, conflict: null, save: 'dirty' });
  pendingSummary = 'Kept local draft after a conflicting save';
  void saveNow();
}
export function restoreRecovered() {
  const r = state.recovered;
  if (!r || !state.revision) return;
  resetHistory();
  if (r.baseRevisionId === state.revision.id) { setState({ model: r.model, layout: r.layout, recovered: null }); scheduleSave('Recovered draft'); scheduleLayoutSave(); }
  else setState({ model: r.model, layout: r.layout, recovered: null, save: 'conflict', conflict: { revision: state.revision, layout: state.layout }, saveError: 'This draft was started from an older version of the map.' });
}
export function discardRecovered() { clearDraft(); setState({ recovered: null }); }

// ---- model editing ---------------------------------------------------------------------------------
/** Applies an edit to the working model. `key` coalesces rapid edits to the same field into one undo step. */
export function editModel(fn: (m: Model, layout: Layout) => void, summary: string, key = '') {
  if (!state.model || !canEdit()) return;
  const model = structuredClone(state.model), layout = structuredClone(state.layout);
  fn(model, layout);
  const top = undoStack[undoStack.length - 1], now = Date.now();
  if (!(key && top && top.key === key && now - top.at < 1500)) undoStack.push({ model: state.model, layout: state.layout, key, at: now }); else top.at = now;
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  const layoutChanged = JSON.stringify(layout) !== JSON.stringify(state.layout);
  setState({ model, layout });
  syncUndo();
  scheduleSave(summary);
  if (layoutChanged) scheduleLayoutSave();
}
/** Layout-only change (moving nodes, Tidy). Undoable, but never creates an operational revision. */
export function editLayout(layout: Layout, key = '') {
  if (!state.model || !canEdit()) return;
  const top = undoStack[undoStack.length - 1], now = Date.now();
  if (!(key && top && top.key === key && now - top.at < 1500)) undoStack.push({ model: state.model, layout: state.layout, key, at: now });
  redoStack = [];
  setState({ layout });
  syncUndo(); scheduleLayoutSave();
}
function applySnap(from: Snap[], to: Snap[]) {
  const snap = from.pop();
  if (!snap || !state.model) return;
  to.push({ model: state.model, layout: state.layout, key: '', at: 0 });
  const modelChanged = snap.model !== state.model;
  setState({ model: snap.model, layout: snap.layout });
  syncUndo();
  if (modelChanged) scheduleSave('Undo / redo');
  scheduleLayoutSave();
  const sel = state.selection;
  if (sel && ![...snap.model.nodes, ...snap.model.edges, ...snap.model.activities].some((x) => x.id === sel.id)) setState({ selection: null });
}
export const undo = () => applySnap(undoStack, redoStack);
export const redo = () => applySnap(redoStack, undoStack);

// ---- loading ---------------------------------------------------------------------------------------
let viewTimer = 0, viewPending = false;
const viewPayload = () => JSON.stringify({ branchId: state.branchId, nav: state.nav, mode: state.mode, selection: state.selection, routeId: state.routeId, session: state.session, view: viewBox });
function saveView() {
  if (!state.project) return;
  window.clearTimeout(viewTimer);
  viewPending = true;
  const pid = state.project.id;
  viewTimer = window.setTimeout(() => { viewPending = false; void put(`/projects/${pid}/view-state`, JSON.parse(viewPayload())).catch(() => {}); }, 500);
}
// Leaving the page must not lose where the researcher was.
window.addEventListener('pagehide', () => {
  if (!viewPending || !state.project) return;
  viewPending = false;
  void fetch(`/api/projects/${state.project.id}/view-state`, { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: viewPayload() }).catch(() => {});
});
export let viewBox: { x: number; y: number; w: number; h: number } | null = null;
export function rememberView(v: typeof viewBox) { viewBox = v; saveView(); }

export async function loadProject(pid: string) {
  setState({ ...initial, user: state.user, authChecked: true, loading: true });
  viewBox = null; resetHistory();
  try {
    const p = await get(`/projects/${pid}`);
    const vs = p.viewState ?? {};
    const bid = p.branches.some((b: BranchInfo) => b.id === vs.branchId) ? vs.branchId : 'baseline';
    viewBox = vs.view ?? null;
    setState({ project: p.project, role: p.role, members: p.members, branches: p.branches, provider: p.provider, nav: vs.nav ?? 'map', mode: vs.mode ?? 'structure', session: vs.session ?? null, routeId: vs.routeId ?? null });
    await Promise.all([loadBranch(bid, vs.selection ?? null, true), refreshEvidence()]);
    setState({ loading: false });
  } catch (e) { setState({ loading: false, loadError: issuesText(e) }); }
}
export async function reloadProjectMeta() {
  if (!state.project) return;
  const p = await get(`/projects/${state.project.id}`);
  setState({ project: p.project, role: p.role, members: p.members, branches: p.branches, provider: p.provider });
}

export async function loadBranch(bid: string, selection: Selection | null = state.selection, keepView = false) {
  if (!state.project) return;
  if (state.model) await flush().catch(() => {});
  const pid = state.project.id;
  const r = await get<{ branch: BranchInfo; revision: RevisionInfo; lineage: Lineage[] }>(`/projects/${pid}/branches/${bid}`);
  resetHistory();
  const m = r.revision.model;
  const stillThere = selection && [...m.nodes, ...m.edges, ...m.activities].some((x) => x.id === selection.id) ? selection : null;
  const draft = readDraft(pid, bid);
  const useful = draft && (JSON.stringify(draft.model) !== JSON.stringify(m) || JSON.stringify(draft.layout) !== JSON.stringify(r.branch.layout)) ? draft : null;
  if (draft && !useful) try { localStorage.removeItem(draftKey(pid, bid)); } catch { /* ignore */ }
  if (!keepView) viewBox = null;
  setState((s) => ({
    branchId: bid, revision: r.revision, model: m, layout: r.branch.layout, lineage: r.lineage, selection: stillThere, save: 'saved', saveError: '', conflict: null, recovered: useful,
    branches: s.branches.some((b) => b.id === bid) ? s.branches.map((b) => (b.id === bid ? r.branch : b)) : [...s.branches, r.branch],
    routeId: m.routes.some((x) => x.id === s.routeId) ? s.routeId : m.routes[0]?.id ?? null, compareTo: r.lineage[0]?.revisionId ?? null, compareModel: null,
  }));
  if (r.lineage[0]) await setCompare(r.lineage[0].revisionId);
  saveView();
}
export async function setCompare(revisionId: string) {
  if (!state.project) return;
  const r = await get<{ revision: RevisionInfo }>(`/projects/${state.project.id}/revisions/${revisionId}`);
  setState({ compareTo: revisionId, compareModel: r.revision.model });
}
export async function refreshEvidence() {
  if (!state.project) return;
  setState({ evidence: await get<Evidence>(`/projects/${state.project.id}/evidence`) });
}
export async function refreshResearch() {
  if (!state.project) return;
  const r = await get(`/projects/${state.project.id}/research`);
  setState({ research: { runs: r.runs, candidates: r.candidates, baselineRevisionId: r.baselineRevisionId }, provider: r.provider });
}

// ---- navigation and selection ----------------------------------------------------------------------
export function select(sel: Selection | null, open = true) { setState({ selection: sel, inspectorOpen: sel ? open : false }); saveView(); }
export function setNav(nav: Nav) { setState({ nav, inspectorOpen: false }); saveView(); }
export function setMode(mode: Mode) { setState({ mode }); saveView(); }
export function setRoute(routeId: string | null) { setState({ routeId }); saveView(); }
export function setSession(session: CaptureSession | null) { setState({ session }); saveView(); }
export function goToTarget(id: string) {
  const m = state.model; if (!m) return;
  const type = m.nodes.some((n) => n.id === id) ? 'node' : m.edges.some((e) => e.id === id) ? 'edge' : m.activities.some((a) => a.id === id) ? 'activity' : null;
  if (!type) { toast('That item is not on this version of the map. The note keeps its original attachment.'); return; }
  setState({ nav: 'map', selection: { type, id }, inspectorOpen: true }); saveView();
}

// ---- evidence and decision records -----------------------------------------------------------------
type Coll = keyof Evidence;
export async function createDoc<K extends Coll>(coll: K, data: Record<string, unknown>): Promise<Evidence[K][number]> {
  const r = await post(`/projects/${state.project!.id}/c/${coll}`, data);
  setState((s) => ({ evidence: { ...s.evidence, [coll]: [...s.evidence[coll], r.doc] } }));
  return r.doc;
}
// Edits to one record are sent one after another, so quick successive field changes never conflict with each other.
const docQueues = new Map<string, Promise<unknown>>();
export function updateDoc<K extends Coll>(coll: K, id: string, data: Record<string, unknown>): Promise<Evidence[K][number]> {
  const key = `${coll}:${id}`;
  const run = async (): Promise<Evidence[K][number]> => {
    const current = (state.evidence[coll] as V<{ id: string }>[]).find((d) => d.id === id);
    try {
      const r = await patch(`/projects/${state.project!.id}/c/${coll}/${id}`, { ...data, expectedVersion: current?.version });
      setState((s) => ({ evidence: { ...s.evidence, [coll]: (s.evidence[coll] as V<{ id: string }>[]).map((d) => (d.id === id ? r.doc : d)) } }));
      return r.doc;
    } catch (e) {
      // A real conflict (another session changed it): show their version; the caller reports it.
      if (e instanceof ApiError && e.status === 409 && e.body.current) setState((s) => ({ evidence: { ...s.evidence, [coll]: (s.evidence[coll] as V<{ id: string }>[]).map((d) => (d.id === id ? e.body.current : d)) } }));
      else void refreshEvidence().catch(() => {});
      throw e;
    }
  };
  // Show the change at once; the server's answer (or its version, on a conflict) replaces it.
  setState((s) => ({ evidence: { ...s.evidence, [coll]: (s.evidence[coll] as V<{ id: string }>[]).map((d) => (d.id === id ? { ...d, ...data } : d)) } }));
  const next = (docQueues.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
  docQueues.set(key, next);
  void next.finally(() => { if (docQueues.get(key) === next) docQueues.delete(key); }).catch(() => {});
  return next;
}
export async function deleteDocById(coll: Coll, id: string) {
  await del(`/projects/${state.project!.id}/c/${coll}/${id}`);
  await refreshEvidence();
}

export async function createScenario(name: string, opts: { fromBranchId?: string; hypothesis?: string; origin?: { type: string; id: string | null } } = {}) {
  await flush();
  const r = await post(`/projects/${state.project!.id}/branches`, { name, hypothesis: opts.hypothesis ?? '', fromBranchId: opts.fromBranchId ?? state.branchId, origin: opts.origin ?? { type: 'blank', id: null } });
  setState((s) => ({ branches: [...s.branches, r.branch] }));
  await loadBranch(r.branch.id);
  setState({ nav: 'map', mode: 'scenario' });
  return r.branch as BranchInfo;
}

export const openModal = (kind: string, data?: any) => setState({ modal: { kind, data } });
export const closeModal = () => setState({ modal: null });
