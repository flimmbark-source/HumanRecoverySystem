// Fieldwork board (notes). Insights are in Insights.tsx.
import { useMemo, useState } from 'react';
import { canEdit, openModal, useStore } from './store';
import { NoteCard, QuickCapture } from './Capture';
import { Empty } from './ui';
import { anchorState, targetLabel } from '../shared/diff';
import { NOTE_KINDS } from '../shared/workspace';

export function NotesBoard() {
  const notes = useStore((s) => s.evidence.notes), sources = useStore((s) => s.evidence.sources), model = useStore((s) => s.model)!, selection = useStore((s) => s.selection);
  const [kind, setKind] = useState(''), [source, setSource] = useState(''), [text, setText] = useState(''), [anchor, setAnchor] = useState(''), [groupBy, setGroupBy] = useState<'group' | 'kind' | 'source' | 'target'>('group');
  const shown = notes.filter((n) => (!kind || n.kind === kind) && (!source || (source === '-' ? !n.sourceId : n.sourceId === source)) && (!text || `${n.text} ${n.category} ${n.group}`.toLowerCase().includes(text.toLowerCase())) && (!anchor || anchorState(model, n.targetId) === anchor));
  const groups = useMemo(() => {
    const map = new Map<string, typeof shown>();
    for (const n of shown) {
      const key = groupBy === 'group' ? n.group || 'Ungrouped' : groupBy === 'kind' ? n.kind : groupBy === 'source' ? sources.find((s) => s.id === n.sourceId)?.anonId ?? 'No source yet' : targetLabel(model, n.targetId) ?? (n.targetId ? 'Historical attachment' : 'Unassigned inbox');
      map.set(key, [...(map.get(key) ?? []), n]);
    }
    return [...map.entries()];
  }, [shown, groupBy, sources, model]);
  const inbox = notes.filter((n) => !n.targetId).length;
  return (
    <div className="page" data-testid="notes-board">
      <header className="page-head"><div><h1>Fieldwork notes</h1><p>{notes.length} notes · {inbox} in the unassigned inbox · {sources.length} sources</p></div>{canEdit() && <button onClick={() => openModal('session')}>Session…</button>}</header>
      <QuickCapture targetId={selection?.id ?? null} />
      <div className="filters" role="group" aria-label="Filter notes">
        <input type="search" placeholder="Search notes" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search notes" />
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by type" data-testid="filter-kind"><option value="">All types</option>{NOTE_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by source" data-testid="filter-source"><option value="">All sources</option><option value="-">No source yet</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.anonId}</option>)}</select>
        <select value={anchor} onChange={(e) => setAnchor(e.target.value)} aria-label="Filter by attachment" data-testid="filter-anchor"><option value="">Any attachment</option><option value="attached">On the map</option><option value="unassigned">Unassigned inbox</option><option value="historical">Historical</option></select>
        <label className="field inline"><span className="field-label">Group by</span><select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} data-testid="group-by"><option value="group">Collection / theme</option><option value="kind">Type</option><option value="source">Source</option><option value="target">Map item</option></select></label>
        <span className="micro" data-testid="note-count">{shown.length} shown</span>
      </div>
      {!notes.length && <Empty title="No notes yet">Start a session, then capture one observation per note. Notes can stay unassigned until you know where they belong.</Empty>}
      {groups.map(([name, list]) => (
        <section key={name} className="note-group" data-group={name}><h3>{name} <em>{list.length}</em></h3><div className="stickies">{list.map((n) => <NoteCard key={n.id} note={n} />)}</div></section>
      ))}
    </div>
  );
}
