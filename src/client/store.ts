// Client state. The working model is a local draft that autosaves as an immutable revision with an optimistic check.
import { useSyncExternalStore } from 'react';
import { ApiError, del, get, issuesText, patch, post, put } from './api';
import { type Layout, type Model } from '../shared/model';
import type { DecisionOption, EvidenceLink, ImportRecord, Insight, Note, Opportunity, Source } from '../shared/workspace';
import type { Proposal } from '../shared/fieldnotes';
import { applyChanges, type MapChange } from '../shared/mapchanges';
import { onDevice } from './ui';
import type { Candidate } from '../shared/candidates';

export type Nav = 'map' | 'notes' | 'insights' | 'decide' | 'research' | 'report' | 'settings';
export type Mode = 'structure' | 'timeline' | 'scenario';
export interface Selection { type: 'node' | 'edge' | 'activity'; id: string }
export interface BranchInfo { id: string; kind: 'baseline' | 'scenario'; name: string; hypothesis: string; parentBranchId: string | null; baseRevisionId: string | null; headRevisionId: string; layout: Layout; origin: { type: string; id: string | null } | null; status: string; createdAt: string }
export interface RevisionInfo { id: string; branchId: string; seq: number; summary: string; author: string; createdAt: string; restoredFrom: string | null; model: Model }
export interface Lineage { branchId: string; branchName: string; revisionId: string; seq: number; createdAt: string; relation: string }
export interface CaptureSession { sourceId: string; label: string; group: string; startedAt: string }
export type V<T> = T & { version: number };
export interface Evidence { sources: V<Source>[]; notes: V<Note>[]; insights: V<Insight>[]; links: V<EvidenceLink>[]; opportunities: V<Opportunity>[]; options: V<DecisionOption>[]; imports: V<ImportRecord>[] }
export interface CandidateRow { id: string; runId: string | null; origin: string; schemaVersion: number; payload: Candidate; originalPayload: Candidate; status: string; baseRevisionId: string | null; duplicateOf: string | null; reviewer: string; reviewedAt: string | null; reviewNote: string; applied: Record<string, string> | null; stale: boolean; refIssues: string[]; alreadyInModel: boolean; edited: boolean }
export interface RunRow { id: string; mode: 'wide' | 'deep'; status: string; question: string; provider: string; input: any; result: any; error: string; attempts: number; maxAttempts: number; createdAt: string; finishedAt: string | null }
export interface ProviderStatus { id: string; label: string; synthetic: boolean; available: boolean; reason: string }
export type SaveState = 'saved' | 'dirty' | 'saving' | 'failed' | 'conflict';
export interface InsightDraft { picks: string[]; text: string; from: 'map' | 'insights' }
/** The map opened for one insight: details picked in the details panel wait in `pending` until added. */
export interface InsightCtx { id: string; pending: { item: string; key: string }[]; frame: string[]; frameKey: number }
/** The Insights page as the researcher left it, kept while they visit the map. */
/** Field notes being imported: the text, the names replaced, who it is from, and the proposed notes under review. */
export interface ImportDraft {
  step: 'input' | 'review';
  name: string; raw: string;
  /** Your own field notes, or a written document (report, procedure, email): sets how its statements are known. */
  docType: 'notes' | 'document';
  /** The original file, which is not kept: where to open it again. */
  file: { name: string; mime: string; size: number; ref: string; link: string } | null;
  names: { name: string; with: string; on: boolean }[];
  /** The text after names were replaced: what is split, sent to Claude when chosen, and saved. */
  text: string;
  mode: 'one' | 'several';
  /** "One person": an existing source ID, "new:main" for newSource, or null. */
  sourceId: string | null;
  newSource: { anonId: string; type: string; participantRole: string };
  /** "Several people": each speaker label in the notes to an existing source ID, "new:<label>", or null. */
  speakers: Record<string, string | null>;
  proposals: Proposal[];
  method: 'phone' | 'claude' | 'fixture';
  selected: string | null;
  filter: 'all' | 'look';
}
export interface InsightsUi { expanded: string | null; editing: string | null; scroll: number; newText: string | null; edits: Record<string, { title: string; body: string }> }

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
  // Insight capture on the map: the boxes tapped, in order, and the text.
  insightDraft: InsightDraft | null;
  insightCtx: InsightCtx | null;
  insightsUi: InsightsUi;
  importDraft: ImportDraft | null;
  /** Map changes proposed from notes, being reviewed before they go into a draft. */
  mapDraft: { method: string; noteIds: string[]; changes: MapChange[] } | null;
  loading: boolean; loadError: string;
}

const emptyEvidence = (): Evidence => ({ sources: [], notes: [], insights: [], links: [], opportunities: [], options: [], imports: [] });
const initial: State = {
  user: null, authChecked: false, project: null, role: 'reader', members: [], branches: [], provider: null, branchId: 'baseline', revision: null, model: null, layout: {}, lineage: [],
  compareTo: null, compareModel: null, evidence: emptyEvidence(), research: null, nav: 'map', mode: 'structure', selection: null, routeId: null, inspectorOpen: false, session: null,
  save: 'saved', saveError: '', conflict: null, recovered: null, canUndo: false, canRedo: false, toast: null, placing: null, linkFrom: null, modal: null, insightDraft: null, insightCtx: null, insightsUi: { expanded: null, editing: null, scroll: 0, newText: null, edits: {} }, importDraft: null, mapDraft: null, loading: false, loadError: '',
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
    setState({ importDraft: readImportDraft(pid) });
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
export function select(sel: Selection | null, open = true) {
  // While an insight is being captured, tapping a map item picks it instead of opening its details.
  if (state.insightDraft) { if (sel) togglePick(sel.id); return; }
  setState({ selection: sel, inspectorOpen: sel ? open : false }); saveView();
}
export function setNav(nav: Nav) {
  rememberInsightsScroll();
  // Leaving the map ends an insight's map mode; the Insights page keeps the open insight and its scroll.
  if (state.insightCtx && nav !== 'map') { endInsightCtx(nav === 'insights'); if (nav === 'insights') return; }
  setState({ nav, inspectorOpen: false }); saveView();
}
export function setMode(mode: Mode) { setState({ mode }); saveView(); }
export function setRoute(routeId: string | null) { setState({ routeId }); saveView(); }
export function setSession(session: CaptureSession | null) { setState({ session }); saveView(); }
export function goToTarget(id: string) {
  const m = state.model; if (!m) return;
  const type = m.nodes.some((n) => n.id === id) ? 'node' : m.edges.some((e) => e.id === id) ? 'edge' : m.activities.some((a) => a.id === id) ? 'activity' : null;
  if (!type) { toast('That item is not on this version of the map. The note keeps its original attachment.'); return; }
  setState({ nav: 'map', selection: { type, id }, inspectorOpen: true }); saveView();
}

// ---- insight capture on the map ----------------------------------------------------------------------
export function startInsight(from: InsightDraft['from'] = 'map') {
  if (state.insightCtx) endInsightCtx(false);
  if (from === 'insights') rememberInsightsScroll();
  setState({ nav: 'map', insightDraft: { picks: [], text: '', from }, inspectorOpen: false, selection: null });
}
export function cancelInsight() {
  const from = state.insightDraft?.from;
  setState({ insightDraft: null });
  if (from === 'insights') setState({ nav: 'insights' });
}
export const editInsightDraft = (patch: Partial<InsightDraft>) => setState((s) => ({ insightDraft: s.insightDraft && { ...s.insightDraft, ...patch } }));
export function togglePick(id: string) {
  const d = state.insightDraft; if (!d) return;
  editInsightDraft({ picks: d.picks.includes(id) ? d.picks.filter((x) => x !== id) : [...d.picks, id] });
}
const itemName = (id: string) => state.model?.nodes.find((n) => n.id === id)?.label ?? state.model?.edges.find((e) => e.id === id)?.label ?? state.model?.activities.find((a) => a.id === id)?.label ?? id;
/** Saves the draft as an insight linked to the tapped boxes. An empty draft just closes. */
export async function finishInsight() {
  const d = state.insightDraft; if (!d) return;
  if (!d.text.trim() && !d.picks.length) return cancelInsight();
  const doc = await createDoc('insights', { title: d.text.trim() ? '' : `About ${d.picks.map(itemName).join(', ')}`.slice(0, 300), body: d.text.trim(), modelLinks: d.picks });
  setState({ insightDraft: null });
  // Started from the Insights page: go back there with the new insight open.
  if (d.from === 'insights') setState((s) => ({ nav: 'insights', insightsUi: { ...s.insightsUi, expanded: doc.id, scroll: -1 } }));
  toast(`Insight saved${d.picks.length ? ` with ${d.picks.length} linked item${d.picks.length === 1 ? '' : 's'}` : ''}`);
}

// ---- the map opened for one insight -----------------------------------------------------------------
export const editInsightsUi = (patch: Partial<InsightsUi>) => setState((s) => ({ insightsUi: { ...s.insightsUi, ...patch } }));
const scroller = () => document.querySelector<HTMLElement>('.main');
function rememberInsightsScroll() { if (state.nav === 'insights') editInsightsUi({ scroll: scroller()?.scrollTop ?? 0 }); }
/** Restores the Insights page scroll after a visit to the map (-1: bring the open insight into view). */
export function restoreInsightsScroll() {
  const want = state.insightsUi.scroll, el = scroller(); if (!el) return;
  if (want >= 0) el.scrollTop = want;
  else document.querySelector(`[data-insight="${state.insightsUi.expanded}"]`)?.scrollIntoView({ block: 'center' });
}
const typeOf = (id: string): Selection['type'] | null => { const m = state.model; return !m ? null : m.nodes.some((n) => n.id === id) ? 'node' : m.edges.some((e) => e.id === id) ? 'edge' : m.activities.some((a) => a.id === id) ? 'activity' : null; };
/** The map items to frame for a set of linked items: connections bring their two ends, activities their node. */
export function frameIds(ids: string[]) {
  const m = state.model; if (!m) return [];
  return ids.flatMap((id) => { const e = m.edges.find((x) => x.id === id); if (e) return [e.from, e.to]; const a = m.activities.find((x) => x.id === id); if (a) return a.ownerNodeId ? [a.ownerNodeId] : []; return m.nodes.some((n) => n.id === id) ? [id] : []; });
}
/** Opens the map for an insight: framed on the whole group, or on one card's item with its details open. */
export function openInsightOnMap(insightId: string, itemId?: string) {
  const insight = state.evidence.insights.find((i) => i.id === insightId); if (!insight) return;
  rememberInsightsScroll();
  const type = itemId ? typeOf(itemId) : null;
  if (itemId && !type) { toast('That item is not on this version of the map.'); return; }
  const first = !state.insightCtx || state.insightCtx.id !== insightId;
  if (first && history.state?.weaveInsight !== true) history.pushState({ ...history.state, weaveInsight: true }, '');
  setState((s) => ({
    nav: 'map', insightDraft: null, insightsUi: { ...s.insightsUi, expanded: insightId },
    insightCtx: { id: insightId, pending: first ? [] : s.insightCtx!.pending, frame: frameIds(itemId ? [itemId] : insight.modelLinks), frameKey: (s.insightCtx?.frameKey ?? 0) + 1 },
    ...(type ? { selection: { type, id: itemId! }, inspectorOpen: true } : { selection: null, inspectorOpen: false }),
  }));
  saveView();
}
/** Ends the mode: pending picks are dropped, added details stay. By default it returns to the open insight. */
export function endInsightCtx(back = true) {
  if (!state.insightCtx) return;
  setState({ insightCtx: null, inspectorOpen: false });
  if (history.state?.weaveInsight === true) { ignorePop = true; history.back(); }
  if (back) { setState({ nav: 'insights' }); saveView(); }
}
let ignorePop = false;
// The browser Back button leaves the mode like the Back to insight button does.
window.addEventListener('popstate', () => { if (ignorePop) { ignorePop = false; return; } if (state.insightCtx) endInsightCtx(); });
export function togglePending(item: string, key: string) {
  setState((s) => {
    const c = s.insightCtx; if (!c) return {};
    const has = c.pending.some((p) => p.item === item && p.key === key);
    return { insightCtx: { ...c, pending: has ? c.pending.filter((p) => !(p.item === item && p.key === key)) : [...c.pending, { item, key }] } };
  });
}
/** Adds the picked details to their cards (linking the cards' items when needed), and notes as evidence. */
export async function addPendingToInsight() {
  const c = state.insightCtx; if (!c || !c.pending.length) return;
  const insight = state.evidence.insights.find((i) => i.id === c.id); if (!insight) return;
  const focus: Record<string, string[]> = { ...insight.focus }, modelLinks = [...insight.modelLinks];
  for (const { item, key } of c.pending) {
    if (!modelLinks.includes(item)) modelLinks.push(item);
    if (!(focus[item] ?? []).includes(key)) focus[item] = [...(focus[item] ?? []), key];
  }
  const n = c.pending.length;
  setState({ insightCtx: { ...c, pending: [] } });
  await updateDoc('insights', insight.id, { focus, modelLinks });
  const linked = new Set(state.evidence.links.filter((l) => (l.fromId === insight.id && l.toType === 'note') || (l.toId === insight.id && l.fromType === 'note')).map((l) => (l.fromId === insight.id ? l.toId : l.fromId)));
  for (const { key } of c.pending) {
    const noteId = key.startsWith('note:') ? key.slice(5) : null;
    if (noteId && !linked.has(noteId)) { linked.add(noteId); await createDoc('links', { fromType: 'insight', fromId: insight.id, toType: 'note', toId: noteId, relation: 'supports' }); }
  }
  toast(`Added ${n} detail${n === 1 ? '' : 's'} to the insight`);
}

// ---- field notes import -------------------------------------------------------------------------------
// The draft is kept on this device until it is saved or discarded, so a review survives Back or a closed app.
const importKey = (pid: string) => `weave:import:${pid}`;
function readImportDraft(pid: string): ImportDraft | null { try { const v = localStorage.getItem(importKey(pid)); return v ? JSON.parse(v) : null; } catch { return null; } }
let importTimer = 0, importPending = false;
function writeImportDraft() {
  window.clearTimeout(importTimer);
  if (!importPending || !state.project) return;
  importPending = false;
  try { if (state.importDraft) localStorage.setItem(importKey(state.project.id), JSON.stringify(state.importDraft)); else localStorage.removeItem(importKey(state.project.id)); } catch { /* storage full or blocked: the draft lives in memory */ }
}
function keepImportDraft() { importPending = true; window.clearTimeout(importTimer); importTimer = window.setTimeout(writeImportDraft, 300); }
// Leaving, reloading or closing the app writes the draft at once.
window.addEventListener('pagehide', writeImportDraft);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeImportDraft(); });
export function startImport() {
  if (!state.importDraft) setState({ importDraft: { step: 'input', name: '', raw: '', docType: 'notes', file: null, names: [], text: '', mode: 'one', sourceId: null, newSource: { anonId: '', type: 'interview', participantRole: '' }, speakers: {}, proposals: [], method: 'phone', selected: null, filter: 'all' } });
  setNav('notes');
  keepImportDraft();
}
export function editImport(patch: Partial<ImportDraft> | ((d: ImportDraft) => Partial<ImportDraft>)) {
  setState((s) => (s.importDraft ? { importDraft: { ...s.importDraft, ...(typeof patch === 'function' ? patch(s.importDraft) : patch) } } : {}));
  keepImportDraft();
}
export function discardImport() { pendingFile = null; setState({ importDraft: null }); keepImportDraft(); }
/** A PDF or image waiting to be read by Claude. Held in memory only: originals are never stored. */
export let pendingFile: { name: string; mime: string; data: string } | null = null;
export const holdFile = (f: typeof pendingFile) => { pendingFile = f; };

const CLAUDE_KEY = 'weave:claude-key';
/** Whether a Claude button can work here: the phone needs the researcher's key, a server its own setup. */
export function onlineClaude(p: ProviderStatus | null): { ready: boolean; why: string } {
  if (onDevice) return claudeKey() ? { ready: true, why: '' } : { ready: false, why: 'To split with Claude or read PDFs and pictures, add your Claude API key in Project settings.' };
  if (p?.id === 'fixture' || (p?.id === 'anthropic' && p.available)) return { ready: true, why: '' };
  return { ready: false, why: 'Claude is not set up on this server, so notes are split on this device.' };
}
export function claudeKey(): string { try { return localStorage.getItem(CLAUDE_KEY) ?? ''; } catch { return ''; } }
export function setClaudeKey(key: string) { try { if (key.trim()) localStorage.setItem(CLAUDE_KEY, key.trim()); else localStorage.removeItem(CLAUDE_KEY); } catch { /* blocked storage */ } }

/** Asks Claude (or the server's test splitter) to split text, or to read a PDF or image and split its text. */
export async function splitWithClaudeRemote(what: { text: string } | { file: NonNullable<typeof pendingFile> }, docType: ImportDraft['docType']): Promise<{ method: ImportDraft['method']; transcript?: string; proposals: Proposal[] }> {
  const key = claudeKey();
  return post(`/projects/${state.project!.id}/fieldnotes/split`, { ...what, docType, branchId: state.branchId }, key ? { 'x-claude-key': key } : {});
}

/** Saves the included proposals as notes, with the import and any new sources, in one request. */
export async function saveImport() {
  const d = state.importDraft; if (!d || !state.project) return null;
  const used = d.proposals.filter((p) => p.include).sort((a, b) => (a.start < 0 ? 1e12 : a.start) - (b.start < 0 ? 1e12 : b.start));
  const ref = (p: Proposal) => p.sourceId ?? (d.mode === 'one' ? d.sourceId : d.speakers[p.speaker] ?? null);
  const refs = new Set([d.mode === 'one' ? d.sourceId : null, ...used.map(ref)].filter((r): r is string => !!r && r.startsWith('new:')));
  const newSources = [...refs].map((r) => {
    const label = r.slice(4);
    if (r === 'new:main') return { key: 'main', anonId: d.newSource.anonId.trim() || d.name, type: d.newSource.type, participantRole: d.newSource.participantRole };
    return { key: label, anonId: `${label} (${d.name})`.slice(0, 200), type: 'interview', participantRole: label };
  });
  const r = await post<{ import: V<ImportRecord>; sources: V<Source>[]; notes: V<Note>[] }>(`/projects/${state.project.id}/fieldnotes`, {
    name: d.name.trim() || d.file?.name || 'Field notes', text: d.text, method: d.method, branchId: state.branchId, docType: d.docType, file: d.file,
    sourceId: d.mode === 'one' ? d.sourceId : null, newSources,
    notes: used.map((p) => ({ text: p.text, excerpt: p.excerpt, kind: p.kind, certainty: p.certainty, targetId: p.targetId, sourceId: ref(p), category: p.notOnMap ? `Not on the map: ${p.notOnMap}`.slice(0, 100) : '', start: p.start, end: p.end })),
  });
  pendingFile = null;
  setState((s) => ({ importDraft: null, evidence: { ...s.evidence, imports: [...s.evidence.imports, r.import], sources: [...s.evidence.sources, ...r.sources], notes: [...s.evidence.notes, ...r.notes] } }));
  keepImportDraft();
  return r;
}

// ---- map changes from notes ------------------------------------------------------------------------------
/** Asks for map changes based on these notes, measured against the main map. */
export async function proposeMap(noteIds: string[]) {
  const key = claudeKey();
  const r = await post<{ method: string; changes: MapChange[] }>(`/projects/${state.project!.id}/fieldnotes/propose-map`, { noteIds, branchId: 'baseline' }, key ? { 'x-claude-key': key } : {});
  setState({ mapDraft: { method: r.method, noteIds, changes: r.changes } });
}
export const editMapDraft = (changes: MapChange[]) => setState((s) => (s.mapDraft ? { mapDraft: { ...s.mapDraft, changes } } : {}));
/** Puts the ticked changes into a new draft version of the main map and opens it to compare. */
export async function createMapDraft() {
  const d = state.mapDraft; if (!d) return;
  await flush();
  if (state.branchId !== 'baseline') await loadBranch('baseline');
  const { model, layout, applied } = applyChanges(state.model!, state.layout, d.changes);
  const when = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  await createScenario(`Draft from notes, ${when}`, { fromBranchId: 'baseline', hypothesis: `${applied} change${applied === 1 ? '' : 's'} proposed from ${d.noteIds.length} notes in the archive.`, origin: { type: 'archive', id: null } });
  editModel((m) => { Object.assign(m, model); }, `Changes from notes (${applied})`);
  editLayout(layout);
  await flush();
  setState({ mapDraft: null, nav: 'map', mode: 'scenario', inspectorOpen: false });
  return applied;
}
/** Makes a draft the main map. Refused when the main map changed since the draft was made, unless forced. */
export async function adoptDraft(force = false): Promise<'adopted' | 'changed'> {
  await flush();
  const draft = state.branches.find((b) => b.id === state.branchId);
  try { await post(`/projects/${state.project!.id}/branches/${state.branchId}/adopt`, { force }); }
  catch (e) { if (e instanceof ApiError && e.status === 409 && e.body.changedSince) return 'changed'; throw e; }
  await loadBranch('baseline');
  setState((s) => ({ mode: 'structure', branches: s.branches.map((b) => (b.id === draft?.id ? { ...b, status: 'reviewed' } : b)) }));
  return 'adopted';
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
