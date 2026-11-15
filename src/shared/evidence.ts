// How evidence relates to an insight or recommendation. Observations, interpretation and gaps stay separate.
import type { DecisionOption, EvidenceLink, Insight, Note, Opportunity } from './workspace';

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
