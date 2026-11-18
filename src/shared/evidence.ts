// How evidence relates to an insight or recommendation. Observations, interpretation and gaps stay separate.
import { EDGE_TYPE_LABEL, NODE_KIND_LABEL, activityForEdge, fmtQty, type Model, type Quantity, type WActivity } from './model';
import { ACTION_LABEL, describeEdge } from './sentence';
import type { DecisionOption, EvidenceLink, Insight, Note, Opportunity } from './workspace';

export interface Fact { key: string; label: string; value: string }
export interface ItemFacts { id: string; type: 'node' | 'edge' | 'activity'; kind: string; name: string; facts: Fact[] }

const minutes = (q: Quantity) => (q.value === null && q.min === undefined ? 'Unknown' : `${fmtQty(q)} min`);
function activityFacts(m: Model, a: WActivity): Fact[] {
  return [
    { key: 'performer', label: 'Who does it', value: m.nodes.find((n) => n.id === a.performerId)?.label ?? 'Not identified' },
    { key: 'action', label: 'Action', value: a.actionCode ? ACTION_LABEL[a.actionCode] : 'Not recorded' },
    { key: 'active', label: 'Active time', value: minutes(a.activeMinutes) },
    { key: 'waiting', label: 'Waiting time', value: minutes(a.waitMinutes) },
    { key: 'occurrences', label: 'Times per case', value: fmtQty(a.occurrencesPerCase) },
  ];
}

/** The details of a map item that an insight can point at, in reading order. Empty text fields are left out. */
export function itemFacts(m: Model, id: string): ItemFacts | null {
  const keep = (facts: Fact[]) => facts.filter((f) => f.value.trim());
  const edge = m.edges.find((e) => e.id === id);
  if (edge) {
    const a = activityForEdge(m, edge.id), d = describeEdge(m, edge, a);
    return {
      id, type: 'edge', kind: `Connection · ${EDGE_TYPE_LABEL[edge.type]}`, name: edge.label,
      facts: keep([
        { key: 'sentence', label: 'What happens', value: d.sentence },
        { key: 'route', label: 'From → to', value: `${d.from} → ${d.to}` },
        ...(a ? activityFacts(m, a) : []),
        { key: 'input', label: 'Goes in', value: [edge.workItem, edge.inputState && `(${edge.inputState})`].filter(Boolean).join(' ') },
        { key: 'output', label: 'Comes out', value: [edge.result, edge.outputState && `(${edge.outputState})`].filter(Boolean).join(' ') },
        { key: 'conditions', label: 'Conditions', value: edge.conditions },
        { key: 'exceptions', label: 'Exceptions', value: edge.exceptions },
        { key: 'description', label: 'Description', value: edge.description },
      ]),
    };
  }
  const node = m.nodes.find((n) => n.id === id);
  if (node) {
    const internal = m.activities.filter((a) => !a.edgeId && a.ownerNodeId === id).map((a) => a.label).join(', ');
    return {
      id, type: 'node', kind: `Node · ${NODE_KIND_LABEL[node.kind]}`, name: node.label,
      facts: keep([
        { key: 'role', label: 'Role', value: node.role },
        { key: 'scope', label: 'Scope', value: node.scope === 'internal' ? 'Within the reviewed scope' : node.scope === 'external' ? 'External, with a direct interface' : 'Context only' },
        { key: 'internal', label: 'Internal activities', value: internal },
        { key: 'description', label: 'Description', value: node.description },
      ]),
    };
  }
  const act = m.activities.find((a) => a.id === id);
  return act ? { id, type: 'activity', kind: 'Internal activity', name: act.label, facts: activityFacts(m, act) } : null;
}

// ---- supporting data suggested by shared words -------------------------------------------------------
// Not AI: a transparent word match, so a reviewer can see exactly why something was suggested.
const STOP = new Set('about above after again against also because been before being below between both could does doing down during each from further have having here into itself just more most much must only other over same should some such than that their them then there these they this those through under until very were what when where which while will with would your'.split(' '));
const stem = (w: string) => w.replace(/(ings?|ed|es|s)$/, '');
export const terms = (text: string) => new Set(text.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)).map(stem) ?? []);

export interface Suggestion { type: 'note' | 'item'; id: string; text: string; matched: string[]; score: number }

/** Notes and map items that share words with the insight, best first. Already linked records are left out. */
export function suggestSupport(text: string, notes: Note[], m: Model, linkedNoteIds: Set<string>, linkedItemIds: Set<string>, limit = 6): Suggestion[] {
  const want = terms(text);
  if (!want.size) return [];
  const score = (candidate: string) => { const got = terms(candidate); const matched = [...want].filter((t) => got.has(t)); return { matched, score: matched.length / Math.sqrt(got.size + 1) }; };
  const out: Suggestion[] = [];
  for (const n of notes) if (!linkedNoteIds.has(n.id)) { const s = score(n.text); if (s.matched.length) out.push({ type: 'note', id: n.id, text: n.text, ...s }); }
  for (const id of [...m.nodes.map((n) => n.id), ...m.edges.map((e) => e.id)]) {
    if (linkedItemIds.has(id)) continue;
    const f = itemFacts(m, id)!;
    const s = score(`${f.name} ${f.facts.map((x) => x.value).join(' ')}`);
    if (s.matched.length) out.push({ type: 'item', id, text: `${f.kind}: ${f.name}`, ...s });
  }
  return out.sort((a, b) => b.matched.length - a.matched.length || b.score - a.score).slice(0, limit);
}

export interface LinkedNote { note: Note; relation: EvidenceLink['relation']; linkId: string; via: string }

/** Notes attached to an insight in either direction. */
export function notesForInsight(insightId: string, notes: Note[], links: EvidenceLink[]): LinkedNote[] {
  const out: LinkedNote[] = [];
  for (const l of links) {
    let noteId: string | null = null;
    if (l.fromType === 'insight' && l.fromId === insightId && l.toType === 'note') noteId = l.toId;
    else if (l.toType === 'insight' && l.toId === insightId && l.fromType === 'note') noteId = l.fromId;
    const note = noteId ? notes.find((n) => n.id === noteId) : null;
    if (note) out.push({ note, relation: l.relation, linkId: l.id, via: insightId });
  }
  return out;
}

export interface EvidenceStatus {
  supporting: LinkedNote[]; contradicting: LinkedNote[]; other: LinkedNote[];
  sourceCount: number;
  level: 'none' | 'thin' | 'contested' | 'supported';
  /** True when a recommendation built on this should be presented as a hypothesis to test. */
  isHypothesis: boolean;
  gaps: string[];
}

export function evidenceFor(insightIds: string[], directNoteIds: string[], notes: Note[], links: EvidenceLink[]): EvidenceStatus {
  const linked = insightIds.flatMap((id) => notesForInsight(id, notes, links));
  for (const id of directNoteIds) { const note = notes.find((n) => n.id === id); if (note && !linked.some((l) => l.note.id === id)) linked.push({ note, relation: 'supports', linkId: '', via: 'direct' }); }
  const supporting = linked.filter((l) => l.relation === 'supports'), contradicting = linked.filter((l) => l.relation === 'contradicts');
  const other = linked.filter((l) => l.relation !== 'supports' && l.relation !== 'contradicts');
  const accounts = supporting.filter(({ note }) => note.kind === 'observation' || note.kind === 'measurement');
  const evidence = accounts.filter(({ note }) => note.certainty === 'observed' || note.certainty === 'reported');
  const sources = new Set(accounts.map(({ note }) => note.sourceId).filter(Boolean));
  const evidenceSources = new Set(evidence.map(({ note }) => note.sourceId).filter(Boolean));
  const gaps: string[] = [];
  if (!accounts.length) gaps.push('No supporting observation or measurement is linked yet.');
  else if (!evidence.length) gaps.push('Supporting accounts are inferred or have no recorded certainty. Look for an observed or reported account to test the interpretation.');
  else if (!evidenceSources.size) gaps.push('Observed or reported accounts have no recorded source.');
  else if (evidenceSources.size === 1) gaps.push('Observed or reported support comes from a single source.');
  if (contradicting.length) gaps.push(`${contradicting.length} contradicting observation${contradicting.length === 1 ? '' : 's'} not yet reconciled.`);
  if (evidence.length && evidence.every(({ note }) => note.certainty !== 'observed')) gaps.push('The supporting evidence comes from reported accounts.');
  const level: EvidenceStatus['level'] = !linked.length ? 'none' : contradicting.length ? 'contested' : evidenceSources.size < 2 ? 'thin' : 'supported';
  return { supporting, contradicting, other, sourceCount: sources.size, level, isHypothesis: level !== 'supported', gaps };
}

export const evidenceForOpportunity = (o: Opportunity, notes: Note[], links: EvidenceLink[]) => evidenceFor(o.insightIds, o.noteIds, notes, links);

export function decisionHeading(o: Opportunity, chosen: DecisionOption | undefined, evidence: EvidenceStatus) {
  if (o.decisionState === 'closed') return 'Closed';
  if (o.decisionState === 'deferred') return 'Deferred';
  if (!chosen) return 'Opportunity under exploration';
  if (!chosen.withinPilotScope) return 'Exploratory option outside pilot scope';
  if (o.decisionState === 'hypothesis' || evidence.isHypothesis) return 'Hypothesis to test';
  return o.decisionState === 'recommended' ? 'Recommendation' : 'Option under review';
}

export const EVIDENCE_LEVEL_LABEL: Record<EvidenceStatus['level'], string> = {
  none: 'No evidence linked', thin: 'Thin evidence', contested: 'Contested evidence', supported: 'Multiple supporting sources',
};

export function insightTitle(i: Insight): string {
  return i.title.trim() || i.body.trim().split('\n')[0].slice(0, 80) || 'Untitled insight';
}
