// Fieldwork board (notes) and the freeform insight editor.
import { useMemo, useState } from 'react';
import { canEdit, createDoc, createScenario, deleteDocById, fail, openModal, setNav, toast, updateDoc, useStore, type V } from './store';
import { NoteCard, QuickCapture, jumpTo } from './Capture';
import { Empty, Field, when } from './ui';
import { anchorState, targetLabel } from '../shared/diff';
import { EVIDENCE_LEVEL_LABEL, evidenceFor, insightTitle, notesForInsight } from '../shared/evidence';
import { NOTE_KINDS, RELATIONS, RELATION_LABEL, type Insight } from '../shared/workspace';

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

function InsightCard({ insight }: { insight: V<Insight> }) {
  const notes = useStore((s) => s.evidence.notes), links = useStore((s) => s.evidence.links), sources = useStore((s) => s.evidence.sources), opportunities = useStore((s) => s.evidence.opportunities);
  const [title, setTitle] = useState(insight.title), [body, setBody] = useState(insight.body), [busy, setBusy] = useState(false);
  const linked = notesForInsight(insight.id, notes, links);
  const ev = evidenceFor([insight.id], [], notes, links);
  const dirty = title !== insight.title || body !== insight.body;
  const ro = !canEdit();
  const save = async () => { setBusy(true); try { await updateDoc('insights', insight.id, { title, body }); toast('Insight saved'); } catch (e) { fail(e); } finally { setBusy(false); } };
  const toOpportunity = async () => {
    try { const o = await createDoc('opportunities', { title: insightTitle({ ...insight, title, body }), insightIds: [insight.id] }); setNav('decide'); setTimeout(() => document.querySelector(`[data-opportunity="${o.id}"]`)?.scrollIntoView({ block: 'start' }), 80); toast('Opportunity created from this insight'); } catch (e) { fail(e); }
  };
  return (
    <article className="insight" data-insight={insight.id} data-testid="insight">
      <input className="insight-title" value={title} disabled={ro} placeholder="Title (optional)" aria-label="Insight title" onChange={(e) => setTitle(e.target.value)} />
      <textarea className="insight-body" rows={4} value={body} disabled={ro} placeholder="Write the thought as it is. No source, category or template needed." aria-label="Insight text" data-testid="insight-body" onChange={(e) => setBody(e.target.value)} />
      <div className="insight-meta">
        <span className={`chip ev-${ev.level}`} data-testid="insight-evidence">{EVIDENCE_LEVEL_LABEL[ev.level]}</span>
        <span className="micro">Updated {when(insight.updatedAt)}</span>
        {!ro && <button className="primary" disabled={!dirty || busy} onClick={save} data-testid="insight-save">{dirty ? 'Save changes' : 'Saved'}</button>}
      </div>
      <div className="insight-evidence">
        <h4>Evidence <em>{linked.length ? '' : '· none linked, and that is fine for an early thought'}</em></h4>
        <ul className="evlist">
          {linked.map((l) => (
            <li key={l.linkId} data-relation={l.relation} data-testid="insight-link">
              {ro ? <span className={`rel rel-${l.relation}`}>{RELATION_LABEL[l.relation]}</span> : (
                <select value={l.relation} aria-label="Relation" className={`rel rel-${l.relation}`} onChange={(e) => updateDoc('links', l.linkId, { relation: e.target.value }).catch(fail)}>{RELATIONS.map((r) => <option key={r} value={r}>{RELATION_LABEL[r]}</option>)}</select>
              )}
              <button className="linkbtn" onClick={() => jumpTo('note', l.note.id)} data-testid="insight-note-link">{l.note.text.slice(0, 110)}</button>
              <em>{sources.find((s) => s.id === l.note.sourceId)?.anonId ?? 'no source'}</em>
              {!ro && <button className="linkbtn danger" aria-label="Detach this note" data-testid="detach" onClick={() => deleteDocById('links', l.linkId).catch(fail)}>Detach</button>}
            </li>
          ))}
        </ul>
        {ev.gaps.length > 0 && linked.length > 0 && <p className="micro warn">{ev.gaps.join(' ')}</p>}
        {!ro && <div className="btnrow">
          <button onClick={() => openModal('link', { fromType: 'insight', fromId: insight.id })} data-testid="insight-attach">Attach evidence</button>
          <button onClick={toOpportunity} data-testid="insight-to-opportunity">Create opportunity</button>
          <button onClick={() => createScenario(`Test: ${insightTitle({ ...insight, title, body }).slice(0, 60)}`, { fromBranchId: 'baseline', hypothesis: body, origin: { type: 'insight', id: insight.id } }).then(() => toast('Scenario branched from this insight')).catch(fail)} data-testid="insight-to-scenario">Test in a scenario</button>
          {canEdit() && <button onClick={() => openModal('deep', { insightId: insight.id })}>Deep research…</button>}
          <button className="linkbtn danger" onClick={async () => { if (confirm('Delete this insight? Notes linked to it are kept.')) await deleteDocById('insights', insight.id).catch(fail); }}>Delete</button>
        </div>}
        {opportunities.filter((o) => o.insightIds.includes(insight.id)).map((o) => <p key={o.id} className="micro">Used in opportunity: <button className="linkbtn" onClick={() => setNav('decide')}>{o.title}</button></p>)}
      </div>
    </article>
  );
}

export function Insights() {
  const insights = useStore((s) => s.evidence.insights);
  const [draft, setDraft] = useState(''), [busy, setBusy] = useState(false);
  const add = async () => { if (!draft.trim()) return; setBusy(true); try { await createDoc('insights', { body: draft.trim() }); setDraft(''); toast('Insight saved'); } catch (e) { fail(e); } finally { setBusy(false); } };
  return (
    <div className="page" data-testid="insights">
      <header className="page-head"><div><h1>Insights</h1><p>Working interpretations. An insight can come from a conversation, a sketch, earlier experience or reflection, and can be saved before anything is linked to it.</p></div></header>
      {canEdit() && (
        <div className="capture">
          <Field label="New insight"><textarea rows={3} value={draft} placeholder="What do you think is going on?" data-testid="insight-new" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add(); }} /></Field>
          <div className="capture-row"><span className="micro">Ctrl/⌘ + Enter saves</span><button className="primary" disabled={busy || !draft.trim()} onClick={add} data-testid="insight-add">Save insight</button></div>
        </div>
      )}
      {!insights.length && <Empty title="No insights yet">Write one above. Evidence can be attached later, revised, or detached without changing the notes.</Empty>}
      <div className="insights">{[...insights].reverse().map((i) => <InsightCard key={i.id + i.version} insight={i} />)}</div>
    </div>
  );
}
