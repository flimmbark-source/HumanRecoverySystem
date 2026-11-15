// How evidence relates to an insight or recommendation. Observations, interpretation and gaps stay separate.
import type { EvidenceLink, Insight, Note, Opportunity } from './workspace';

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
  const observed = supporting.filter((l) => l.note.kind === 'observation' || l.note.kind === 'measurement');
  const sources = new Set(observed.map((l) => l.note.sourceId).filter(Boolean));
  const gaps: string[] = [];
  if (!supporting.length) gaps.push('No supporting observation is linked yet.');
  else if (!observed.length) gaps.push('Support comes only from hypotheses or questions, not from observations or measurements.');
  else if (sources.size < 2) gaps.push(sources.size === 0 ? 'Supporting observations have no recorded source.' : 'All supporting observations come from a single source.');
  if (contradicting.length) gaps.push(`${contradicting.length} contradicting observation${contradicting.length === 1 ? '' : 's'} not yet reconciled.`);
  if (observed.length && observed.every((l) => l.note.certainty !== 'observed')) gaps.push('Nothing here was directly observed; accounts are reported or inferred.');
  const level: EvidenceStatus['level'] = !observed.length ? 'none' : contradicting.length ? 'contested' : sources.size < 2 ? 'thin' : 'supported';
  return { supporting, contradicting, other, sourceCount: sources.size, level, isHypothesis: level !== 'supported', gaps };
}

export const evidenceForOpportunity = (o: Opportunity, notes: Note[], links: EvidenceLink[]) => evidenceFor(o.insightIds, o.noteIds, notes, links);

export const EVIDENCE_LEVEL_LABEL: Record<EvidenceStatus['level'], string> = {
  none: 'No evidence linked', thin: 'Thin evidence', contested: 'Contested evidence', supported: 'Supported by more than one source',
};

export function insightTitle(i: Insight): string {
  return i.title.trim() || i.body.trim().split('\n')[0].slice(0, 80) || 'Untitled insight';
}
