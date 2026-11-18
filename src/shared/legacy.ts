// Converts v0.7 prototype exports (format "weave-operational-model", exportVersion 2) into a workspace bundle.
// IDs, positions, source notes, scenarios and assessments are preserved. Records that need a human decision are reported.
import { ACTION_CODES, EDGE_TYPES, MODEL_SCHEMA_VERSION, NODE_KINDS, emptyAssessment, qty, unknownQty, type ActionCode, type Basis, type Layout, type Model, type ValidationIssue, type WActivity } from './model';
import { suggestRoute } from './routes';
import { NOTE_KINDS, SOURCE_TYPES, WORKSPACE_FORMAT, WORKSPACE_SCHEMA_VERSION, validateBundle, type Bundle, type EvidenceLink, type Note, type Source } from './workspace';

export interface LegacyDecision { recordId: string; kind: 'timing-conflict' | 'defaulted-zero' | 'unattached-timing' | 'route' | 'info'; message: string; applied: string }
export interface LegacyResult { bundle?: Bundle; issues: ValidationIssue[]; decisions: LegacyDecision[] }

type Any = Record<string, any>;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const isObj = (x: unknown): x is Any => !!x && typeof x === 'object' && !Array.isArray(x);

export function isLegacyExport(x: unknown): boolean {
  return isObj(x) && x.format === 'weave-operational-model';
}

function num(v: unknown, path: string, issues: ValidationIssue[], allowNull = true): number | null {
  if (v === null || v === undefined || v === '') { if (!allowNull) issues.push({ path, message: 'a number is required' }); return null; }
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) { issues.push({ path, message: `“${String(v)}” is not a finite number` }); return null; }
  if (n < 0) { issues.push({ path, message: 'must not be negative' }); return null; }
  return n;
}
const str = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const basisOf = (status: unknown): Basis => (['measured', 'reported', 'estimated', 'assumed'].includes(String(status)) ? (status as Basis) : 'unverified');

function convertModel(raw: Any, path: string, issues: ValidationIssue[], decisions: LegacyDecision[], report: boolean): { model: Model; layout: Layout } | null {
  if (!isObj(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) { issues.push({ path, message: 'model must contain nodes and edges arrays' }); return null; }
  const before = issues.length;
  const seen = new Set<string>();
  const checkId = (id: unknown, p: string): id is string => {
    if (typeof id !== 'string' || !ID.test(id)) { issues.push({ path: p, message: 'missing or malformed ID' }); return false; }
    if (seen.has(id)) { issues.push({ path: p, message: `duplicate ID "${id}"` }); return false; }
    seen.add(id); return true;
  };
  const layout: Layout = {};
  const nodes = raw.nodes.map((n: Any, i: number) => {
    const p = `${path}.nodes.${i}`;
    if (!isObj(n)) { issues.push({ path: p, message: 'malformed record' }); return null; }
    checkId(n.id, `${p}.id`);
    if (!NODE_KINDS.includes(n.type)) issues.push({ path: `${p}.type`, message: `unknown node type "${String(n.type)}"` });
    if (typeof n.name !== 'string' || !n.name.trim()) issues.push({ path: `${p}.name`, message: 'a name is required' });
    const x = num(n.x, `${p}.x`, [], true), y = num(n.y, `${p}.y`, [], true);
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) issues.push({ path: `${p}.x`, message: 'position is not a finite number' });
    else layout[n.id] = { x: n.x, y: n.y };
    void x; void y;
    return { id: n.id, kind: n.type, label: str(n.name, 140), role: str(n.subtitle, 200), description: str(n.description), scope: n.inside === false ? 'external' as const : 'internal' as const, parentId: typeof n.parentId === 'string' ? n.parentId : null };
  });
  const nodeIds = new Set(raw.nodes.filter(isObj).map((n: Any) => n.id));
  const rawActs: Any[] = Array.isArray(raw.activities) ? raw.activities : [];
  if (raw.activities !== undefined && !Array.isArray(raw.activities)) issues.push({ path: `${path}.activities`, message: 'must be an array' });
  const edgeIds = new Set(raw.edges.filter(isObj).map((e: Any) => e.id));
  const activities: WActivity[] = [];
  const actByEdge = new Map<string, Any>();
  rawActs.forEach((a, i) => {
    const p = `${path}.activities.${i}`;
    if (!isObj(a)) { issues.push({ path: p, message: 'malformed record' }); return; }
    checkId(a.id, `${p}.id`);
    if (a.edgeId) {
      if (!edgeIds.has(a.edgeId)) issues.push({ path: `${p}.edgeId`, message: `connection "${a.edgeId}" does not exist` });
      else if (actByEdge.has(a.edgeId)) issues.push({ path: `${p}.edgeId`, message: `connection "${a.edgeId}" has more than one activity` });
      else actByEdge.set(a.edgeId, a);
    }
    if (a.ownerNodeId && !nodeIds.has(a.ownerNodeId)) issues.push({ path: `${p}.ownerNodeId`, message: `node "${a.ownerNodeId}" does not exist` });
    if (a.performerId && !nodeIds.has(a.performerId)) issues.push({ path: `${p}.performerId`, message: `performer "${a.performerId}" does not exist` });
  });

  const mkActivity = (id: string, e: Any | null, a: Any | null, p: string): WActivity => {
    const src = a ?? e!;
    const basis = basisOf(a?.status);
    const aMin = a ? num(a.minutes, `${p}.minutes`, issues) : null;
    const eMin = e ? num(e.minutes, `${p}.minutes`, issues) : null;
    const aWait = a ? num(a.waitHours, `${p}.waitHours`, issues) : null;
    const eWait = e ? num(e.waitHours, `${p}.waitHours`, issues) : null;
    const aOcc = a ? num(a.occurrencesPerCase, `${p}.occurrencesPerCase`, issues) : null;
    const eOcc = e ? num(e.occurrencesPerCase, `${p}.occurrencesPerCase`, issues) : null;
    const pick = (field: string, av: number | null, ev: number | null, hasA: boolean): number | null => {
      if (hasA && e && av !== ev && !(av === null && ev === null) && e[field] !== undefined) {
        if (report) decisions.push({ recordId: e.id, kind: 'timing-conflict', message: `“${str(e.label)}”: the connection records ${field} = ${ev ?? 'unknown'} but its activity records ${av ?? 'unknown'}.`, applied: `Kept the activity value (${av ?? 'unknown'}). Edit the connection’s Performance section if the other value is correct.` });
      }
      return hasA ? av : ev;
    };
    const minutes = pick('minutes', aMin, eMin, !!a), waitH = pick('waitHours', aWait, eWait, !!a), occ = pick('occurrencesPerCase', aOcc, eOcc, !!a);
    const zeros = [minutes === 0 ? 'active time' : null, waitH === 0 ? 'waiting time' : null].filter(Boolean);
    if (zeros.length && basis === 'unverified' && report) decisions.push({ recordId: e?.id ?? id, kind: 'defaulted-zero', message: `“${str(src.label)}”: ${zeros.join(' and ')} is 0 with no recorded observation basis. It may be a default, not a finding.`, applied: 'Kept as 0 and tagged unverified. Clear the value to mark it unknown, or record its basis.' });
    const code = (a?.actionCode ?? e?.actionCode) as string | undefined;
    const performer = (e ? e.performerId : a?.performerId ?? a?.ownerNodeId) ?? null;
    return {
      id, edgeId: e ? e.id : null, ownerNodeId: e ? null : a?.ownerNodeId ?? null, performerId: typeof performer === 'string' ? performer : null,
      actionCode: ACTION_CODES.includes(code as ActionCode) ? (code as ActionCode) : null, label: str(src.label, 140) || 'Activity',
      includedInWorkload: (a?.includedInTotals ?? e?.includedInTotals) !== false,
      activeMinutes: qty(minutes, 'min', basis), waitMinutes: qty(waitH === null ? null : waitH * 60, 'min', basis), occurrencesPerCase: qty(occ ?? 1, 'per case', occ === null ? 'assumed' : basis),
    };
  };

  const edges = raw.edges.map((e: Any, i: number) => {
    const p = `${path}.edges.${i}`;
    if (!isObj(e)) { issues.push({ path: p, message: 'malformed record' }); return null; }
    checkId(e.id, `${p}.id`);
    if (!nodeIds.has(e.from)) issues.push({ path: `${p}.from`, message: `source "${String(e.from)}" does not exist` });
    if (!nodeIds.has(e.to)) issues.push({ path: `${p}.to`, message: `destination "${String(e.to)}" does not exist` });
    if (!EDGE_TYPES.includes(e.kind)) issues.push({ path: `${p}.kind`, message: `unknown connection type "${String(e.kind)}"` });
    if (e.performerId && !nodeIds.has(e.performerId)) issues.push({ path: `${p}.performerId`, message: `performer "${e.performerId}" does not exist` });
    const a = actByEdge.get(e.id) ?? null;
    const operational = e.kind === 'flow' || e.kind === 'info';
    let activityId: string | null = null;
    if (a || operational) {
      activityId = a?.id ?? (typeof e.activityId === 'string' && ID.test(e.activityId) && !seen.has(e.activityId) ? e.activityId : `a-${e.id}`);
      if (!a) seen.add(activityId!);
      activities.push(mkActivity(activityId!, e, a, p));
    } else {
      num(e.minutes, `${p}.minutes`, issues); num(e.waitHours, `${p}.waitHours`, issues);
      if ((e.minutes !== undefined && e.minutes !== null) || (e.waitHours !== undefined && e.waitHours !== null)) {
        if (report) decisions.push({ recordId: e.id, kind: 'unattached-timing', message: `“${str(e.label)}” is a ${e.kind} link carrying timing values (${e.minutes ?? '—'} min, ${e.waitHours ?? '—'} h) but no activity. The prototype never counted them.`, applied: 'Not imported as timing. Add an activity to this link if work or waiting really happens here.' });
      }
    }
    return {
      id: e.id, from: e.from, to: e.to, type: e.kind, label: str(e.label, 140) || 'Untitled', directed: e.kind !== 'association', activityId,
      workItem: str(e.work, 250), result: str(e.transform, 250), inputState: str(e.inputState, 250), outputState: str(e.outputState, 250),
      conditions: '', exceptions: '', description: str(e.description),
    };
  });
  rawActs.filter((a) => isObj(a) && !a.edgeId).forEach((a, i) => {
    if (!a.ownerNodeId) issues.push({ path: `${path}.activities.${i}.ownerNodeId`, message: 'an internal activity needs an owning node' });
    activities.push(mkActivity(a.id, null, a, `${path}.activities.${i}`));
  });
  const volume = num(raw.volume, `${path}.volume`, issues);
  if (raw.startNodeId && !nodeIds.has(raw.startNodeId)) issues.push({ path: `${path}.startNodeId`, message: `start node "${raw.startNodeId}" does not exist` });
  if (issues.length > before) return null;
  const model: Model = {
    schemaVersion: MODEL_SCHEMA_VERSION, name: str(raw.name, 200), volume: volume === null ? unknownQty('cases/month') : qty(volume, 'cases/month', 'unverified'),
    startNodeId: raw.startNodeId ?? null, nodes: nodes as Model['nodes'], edges: edges as Model['edges'], activities, routes: [], assessment: emptyAssessment(),
  };
  const s = suggestRoute(model);
  if (s.status === 'ok') model.routes.push({ id: 'r-main', name: 'Main route', startNodeId: model.edges.find((e) => e.id === s.edgeIds[0])!.from, endNodeId: model.edges.find((e) => e.id === s.edgeIds[s.edgeIds.length - 1])!.to, caseWeight: null, steps: s.edgeIds.map((refId, i) => ({ id: `s${i + 1}`, kind: 'edge' as const, refId })) });
  else if (report && model.edges.length) decisions.push({ recordId: model.startNodeId ?? 'route', kind: 'route', message: `No route was created automatically: ${s.message}`, applied: 'Create a named route in Timeline and choose the branch explicitly.' });
  return { model, layout };
}

function sourceType(label: string): Source['type'] {
  const l = label.toLowerCase();
  if (l.includes('hypothesis') || l.includes('working')) return 'working';
  if (l.includes('walk')) return 'walkthrough';
  if (l.includes('observ')) return 'observation';
  if (l.includes('interview')) return 'interview';
  return 'document';
}

export function convertLegacy(input: unknown): LegacyResult {
  const issues: ValidationIssue[] = [], decisions: LegacyDecision[] = [];
  if (!isObj(input)) return { issues: [{ path: 'file', message: 'not a JSON object' }], decisions };
  if (input.format !== 'weave-operational-model') return { issues: [{ path: 'format', message: 'not a Weave prototype export' }], decisions };
  if (input.exportVersion !== 2) return { issues: [{ path: 'exportVersion', message: `export version ${String(input.exportVersion)} is not supported (expected 2)` }], decisions };
  if (!Array.isArray(input.scenarios ?? [])) return { issues: [{ path: 'scenarios', message: 'must be an array' }], decisions };

  const base = convertModel(input.base, 'base', issues, decisions, true);
  const rawNotes: Any[] = Array.isArray(input.base?.notes) ? input.base.notes : [];
  if (isObj(input.base) && input.base.notes !== undefined && !Array.isArray(input.base.notes)) issues.push({ path: 'base.notes', message: 'must be an array' });

  const now = str(input.exportedAt, 40) || new Date().toISOString();
  const bundle: Bundle = {
    format: WORKSPACE_FORMAT, schemaVersion: WORKSPACE_SCHEMA_VERSION, exportedAt: now,
    project: { name: str(input.base?.name, 200) || 'Imported workflow', researchQuestion: '', orgUnit: '', scopeDescription: '', startLabel: '', intendedOutcome: '', externalInterfaces: '', status: 'draft' },
    branches: [], revisions: [], sources: [], notes: [], insights: [], links: [], opportunities: [], options: [], runs: [], candidates: [], imports: [],
  };
  const baseRevId = `rev-base-${Number.isFinite(input.baseVersion) ? input.baseVersion : 1}`;
  if (base) {
    bundle.revisions.push({ id: baseRevId, branchId: 'baseline', parentRevisionId: null, seq: 1, summary: 'Imported from v0.7 export', author: 'import', createdAt: now, restoredFrom: null, model: base.model });
    bundle.branches.push({ id: 'baseline', kind: 'baseline', name: 'Baseline', hypothesis: '', parentBranchId: null, baseRevisionId: null, headRevisionId: baseRevId, layout: base.layout, origin: null, status: 'draft', createdAt: now });
  }

  // Scenarios: each keeps its own pinned comparison snapshot.
  const scenarios: Any[] = input.scenarios ?? [];
  const scenarioIds = new Set<string>();
  scenarios.forEach((sc, i) => {
    const p = `scenarios.${i}`;
    if (!isObj(sc) || typeof sc.id !== 'string' || !ID.test(sc.id)) { issues.push({ path: `${p}.id`, message: 'missing or malformed ID' }); return; }
    if (scenarioIds.has(sc.id) || sc.id === 'baseline') { issues.push({ path: `${p}.id`, message: `duplicate ID "${sc.id}"` }); return; }
    scenarioIds.add(sc.id);
    const m = convertModel(sc.model, `${p}.model`, issues, decisions, false);
    const snap = sc.baselineSnapshot ? convertModel(sc.baselineSnapshot, `${p}.baselineSnapshot`, issues, decisions, false) : base;
    if (!m || !snap || !base) return;
    let pinned = baseRevId;
    if (JSON.stringify(snap.model) !== JSON.stringify(base.model)) {
      pinned = `rev-${sc.id}-base`;
      bundle.revisions.push({ id: pinned, branchId: 'baseline', parentRevisionId: null, seq: 1, summary: `Baseline as it was when “${str(sc.name)}” was branched (imported snapshot)`, author: 'import', createdAt: str(sc.created, 40) || now, restoredFrom: null, model: snap.model });
    }
    const a = isObj(sc.assessment) ? sc.assessment : {};
    m.model.assessment.unknowns = str(a.unknowns); m.model.assessment.validation = str(a.validation);
    if (str(a.humanEffects).trim()) m.model.assessment.humanEffects.push({ id: 'he-legacy', role: 'Not specified', nodeId: null, kind: 'risk', direction: 'uncertain', description: str(a.humanEffects, 2000), magnitude: null, missingData: 'Imported free text; role and measurement not recorded.', validation: '' });
    const revId = `rev-${sc.id}-1`;
    bundle.revisions.push({ id: revId, branchId: sc.id, parentRevisionId: pinned, seq: 1, summary: 'Imported scenario', author: 'import', createdAt: str(sc.created, 40) || now, restoredFrom: null, model: m.model });
    bundle.branches.push({ id: sc.id, kind: 'scenario', name: str(sc.name, 200) || 'Scenario', hypothesis: str(a.hypothesis ?? sc.hypothesis), parentBranchId: null, baseRevisionId: pinned, headRevisionId: revId, layout: m.layout, origin: null, status: 'draft', createdAt: str(sc.created, 40) || now });
  });
  scenarios.forEach((sc, i) => {
    if (!isObj(sc) || !sc.parentId) return;
    const br = bundle.branches.find((b) => b.id === sc.id);
    if (!scenarioIds.has(sc.parentId)) issues.push({ path: `scenarios.${i}.parentId`, message: `parent scenario "${sc.parentId}" does not exist` });
    else if (br) br.parentBranchId = sc.parentId;
  });
  // seq must be unique per branch for the baseline's historical snapshots
  bundle.revisions.filter((r) => r.branchId === 'baseline').sort((a, b) => (a.id === baseRevId ? 1 : 0) - (b.id === baseRevId ? 1 : 0)).forEach((r, i) => { r.seq = i + 1; });

  // Notes, sources and note-to-note relations.
  const modelIds = new Set(base ? [...base.model.nodes, ...base.model.edges, ...base.model.activities].map((x) => x.id) : []);
  const noteIds = new Set<string>();
  const sourceByLabel = new Map<string, Source>();
  rawNotes.forEach((n, i) => {
    const p = `base.notes.${i}`;
    if (!isObj(n) || typeof n.id !== 'string' || !ID.test(n.id)) { issues.push({ path: `${p}.id`, message: 'missing or malformed ID' }); return; }
    if (noteIds.has(n.id) || modelIds.has(n.id)) { issues.push({ path: `${p}.id`, message: `duplicate ID "${n.id}"` }); return; }
    noteIds.add(n.id);
    if (typeof n.text !== 'string' || !n.text.trim()) issues.push({ path: `${p}.text`, message: 'note text is required' });
    if (n.target && !modelIds.has(n.target)) issues.push({ path: `${p}.target`, message: `target "${String(n.target)}" does not exist` });
    const label = str(n.source, 200).trim();
    let source: Source | undefined;
    if (label) {
      source = sourceByLabel.get(label);
      if (!source) {
        source = { id: `src-${sourceByLabel.size + 1}`, anonId: label, type: sourceType(label), participantRole: '', date: '', collection: str(n.group, 200), agentApproved: false, exportApproved: false, publicUrl: '', retrievedAt: '' };
        sourceByLabel.set(label, source); bundle.sources.push(source);
      }
    }
    const note: Note = {
      id: n.id, kind: (NOTE_KINDS as readonly string[]).includes(n.kind) ? n.kind : 'observation', text: str(n.text, 8000) || '(empty)', rawText: str(n.text, 8000),
      sourceId: source?.id ?? null, certainty: null, group: str(n.group, 200), color: str(n.color, 20), category: '', targetId: n.target || null,
      anchorBranchId: n.target ? 'baseline' : null, anchorRevisionId: n.target ? baseRevId : null, episode: null, excerptApproved: false, origin: null, createdAt: now,
    };
    bundle.notes.push(note);
  });
  void SOURCE_TYPES;
  rawNotes.forEach((n, i) => {
    if (!isObj(n)) return;
    const rel: Any[] = Array.isArray(n.relations) ? n.relations : Array.isArray(n.links) ? n.links.map((id: string) => ({ targetId: id, kind: 'related' })) : [];
    if (n.links !== undefined && !Array.isArray(n.links)) issues.push({ path: `base.notes.${i}.links`, message: 'must be an array' });
    const seenRel = new Set<string>();
    rel.forEach((r, j) => {
      if (!isObj(r) || !noteIds.has(r.targetId)) { issues.push({ path: `base.notes.${i}.relations.${j}`, message: `linked note "${String(r?.targetId)}" does not exist` }); return; }
      if (seenRel.has(r.targetId)) return;
      seenRel.add(r.targetId);
      const relation = ({ supports: 'supports', contradicts: 'contradicts', 'possible-cause': 'possible_cause' } as Record<string, EvidenceLink['relation']>)[r.kind] ?? 'related';
      bundle.links.push({ id: `l-${n.id}-${r.targetId}`.slice(0, 64), fromType: 'note', fromId: n.id, toType: 'note', toId: r.targetId, relation, comment: '' });
    });
  });
  if (isObj(input.session) && str(input.session.source).trim()) decisions.push({ recordId: 'session', kind: 'info', message: `An open capture session (“${str(input.session.source, 80)}”) was in the export.`, applied: 'Sessions are per user and were not imported. Start a new session to continue capturing.' });
  decisions.push({ recordId: 'baseline', kind: 'info', message: 'All timing and volume figures in this file are unverified sample inputs.', applied: 'They stay tagged “unverified” in every result until a basis is recorded.' });

  if (issues.length) return { issues, decisions: [] };
  const checked = validateBundle(bundle);
  if (!checked.bundle) return { issues: checked.issues, decisions: [] };
  return { bundle: checked.bundle, issues: [], decisions };
}

/** Accepts either a legacy export or a native workspace bundle. */
export function parseImport(input: unknown): LegacyResult & { kind: 'legacy' | 'native' | 'unknown' } {
  if (isLegacyExport(input)) return { ...convertLegacy(input), kind: 'legacy' };
  if (isObj(input) && input.format === WORKSPACE_FORMAT) {
    const v = validateBundle(input);
    return { bundle: v.bundle, issues: v.issues, decisions: [], kind: 'native' };
  }
  return { issues: [{ path: 'format', message: 'Unrecognized file. Expected a Weave workspace export or a v0.7 prototype export.' }], decisions: [], kind: 'unknown' };
}
