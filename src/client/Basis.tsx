// What a box, connection or activity on the map rests on: the notes it was built from (its basis) and the notes
// placed on it, by how each is known. Shown as the 🗒 count on the map and as "Based on" in the details panel.
import { useState } from 'react';
import { useStore } from './store';
import { NoteContext } from './FieldImport';
import { CERTAINTY_LABEL, type Note } from '../shared/workspace';
import type { Model } from '../shared/model';

export type Level = 'seen' | 'told' | 'documented' | 'thin' | 'none';
export const LEVEL_LABEL: Record<Level, string> = { seen: 'Seen', told: 'Told', documented: 'Documented only', thin: 'Interpretation or unrecorded only', none: 'No notes yet' };

export function basisNotes(m: Model, notes: Note[], id: string): Note[] {
  const item = m.nodes.find((x) => x.id === id) ?? m.edges.find((x) => x.id === id) ?? m.activities.find((x) => x.id === id);
  const from = new Set(item?.basis ?? []);
  return notes.filter((n) => from.has(n.id) || n.targetId === id);
}
/** The strongest way the notes behind an item are known. */
export function levelOf(list: Pick<Note, 'certainty'>[]): Level {
  if (!list.length) return 'none';
  if (list.some((n) => n.certainty === 'observed')) return 'seen';
  if (list.some((n) => n.certainty === 'reported')) return 'told';
  if (list.some((n) => n.certainty === 'documented')) return 'documented';
  return 'thin';
}
/** For the map: each item's note count and level, worked out once per change of notes or map. */
export function basisIndex(m: Model, notes: Note[]): Map<string, { count: number; level: Level }> {
  const out = new Map<string, { count: number; level: Level }>();
  for (const it of [...m.nodes, ...m.edges, ...m.activities]) { const list = basisNotes(m, notes, it.id); out.set(it.id, { count: list.length, level: levelOf(list) }); }
  return out;
}

/** Under an item's title in the details panel: what it rests on, opening onto the notes themselves. */
export function BasisSummary({ id }: { id: string }) {
  const model = useStore((s) => s.model)!, notes = useStore((s) => s.evidence.notes), sources = useStore((s) => s.evidence.sources);
  const [open, setOpen] = useState(false);
  const list = basisNotes(model, notes, id), level = levelOf(list);
  const counts = (['observed', 'reported', 'documented', 'inferred'] as const).map((c) => [c, list.filter((n) => n.certainty === c).length] as const).filter(([, n]) => n);
  const none = list.filter((n) => !n.certainty).length;
  const parts = [...counts.map(([c, n]) => `${n} ${CERTAINTY_LABEL[c].toLowerCase()}`), ...(none ? [`${none} not recorded`] : [])];
  return (
    <div className={`basis lv-${level}`} data-testid="basis" data-level={level}>
      <button className="basis-line" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!list.length} data-testid="basis-toggle">
        <span aria-hidden="true">🗒</span> {list.length ? <>Based on {list.length} note{list.length === 1 ? '' : 's'}: {parts.join(', ')}</> : 'No notes behind this yet'}
        {level === 'documented' && <em> · only documents, not seen or told</em>}
        {level === 'thin' && <em> · only interpretation</em>}
      </button>
      {open && <ul className="basis-notes">{list.map((n) => (
        <li key={n.id} data-note={n.id}><span className={`chip c-${n.certainty ?? 'none'}`}>{n.certainty ? CERTAINTY_LABEL[n.certainty] : 'Not recorded'}</span> {n.text}
          <em>{sources.find((s) => s.id === n.sourceId)?.anonId ?? 'no source'}{n.targetId === id ? '' : ' · used to build this'}</em>
          {n.origin && <NoteContext origin={n.origin} />}</li>
      ))}</ul>}
    </div>
  );
}
