// Map changes from notes: choose the notes, see what Claude proposes (each change with the notes behind it),
// tick what to keep, and put it into a draft version of the map. The main map changes only when a draft is adopted.
import { useState } from 'react';
import { adoptDraft, canEdit, createMapDraft, editMapDraft, fail, onlineClaude, proposeMap, setState, toast, useStore } from './store';
import { Modal } from './ui';
import { blocked, type MapChange } from '../shared/mapchanges';
import { CERTAINTY_LABEL } from '../shared/workspace';

/** The button and the choice of notes; the request goes only after the researcher sees what is sent. */
export function ProposeMapButton() {
  const notes = useStore((s) => s.evidence.notes), imports = useStore((s) => s.evidence.imports), provider = useStore((s) => s.provider);
  const [open, setOpen] = useState(false), [scope, setScope] = useState('archive'), [busy, setBusy] = useState(false);
  const claude = onlineClaude(provider);
  if (!canEdit() || !notes.length) return null;
  const chosen = scope === 'all' ? notes : scope === 'archive' ? notes.filter((n) => n.origin) : notes.filter((n) => n.origin?.importId === scope);
  const ids = chosen.slice(-400).map((n) => n.id);
  const go = async () => {
    setBusy(true);
    try { await proposeMap(ids); setOpen(false); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (<>
    <button onClick={() => setOpen(true)} data-testid="propose-map">Update the map from notes…</button>
    {open && (
      <Modal title="Update the map from notes" onClose={() => setOpen(false)} footer={<><button onClick={() => setOpen(false)}>Cancel</button>{claude.ready && <button className="primary" disabled={!ids.length || busy} onClick={go} data-testid="propose-send">{busy ? 'Claude is working…' : `Send ${ids.length} notes to Claude`}</button>}</>}>
        <p>Claude reads the notes and the map, and proposes boxes, connections, reporting lines, activities and timings, each with the notes it rests on. You choose which to keep. They go into a <b>draft</b> you compare with the main map before adopting it.</p>
        <label className="field"><span className="field-label">Which notes</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)} data-testid="propose-scope">
            <option value="archive">Everything in the archive ({notes.filter((n) => n.origin).length})</option>
            <option value="all">All notes in the project ({notes.length})</option>
            {imports.map((im) => <option key={im.id} value={im.id}>{im.name} ({notes.filter((n) => n.origin?.importId === im.id).length})</option>)}
          </select></label>
        {chosen.length > 400 && <p className="micro warn">Only the latest 400 of these notes are sent.</p>}
        {claude.ready ? <p className="micro">Sent: the text of these notes (with the names you replaced), how each is known, its source's anonymous name, and the map's boxes and connections.</p> : <p className="micro warn">{claude.why}</p>}
      </Modal>
    )}
  </>);
}

const GROUPS: [string, (c: MapChange) => boolean][] = [
  ['New boxes', (c) => c.op === 'add_node'],
  ['New connections and reporting lines', (c) => c.op === 'add_edge'],
  ['New activities', (c) => c.op === 'add_activity'],
  ['Changes to what is there', (c) => c.op === 'update_node' || c.op === 'update_edge'],
  ['Timings', (c) => c.op === 'set_timing'],
  ['Removals', (c) => c.op === 'remove'],
];

function ChangeRow({ c, all, waiting }: { c: MapChange; all: MapChange[]; waiting: boolean }) {
  const notes = useStore((s) => s.evidence.notes), sources = useStore((s) => s.evidence.sources);
  const basis = c.basis.map((id) => notes.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n);
  const kinds = [...new Set(basis.map((n) => (n.certainty ? CERTAINTY_LABEL[n.certainty] : 'Not recorded')))];
  return (
    <li className={`chg${c.on ? '' : ' off'}${c.problem ? ' bad' : ''}`} data-testid="map-change" data-op={c.op}>
      <label className="check"><input type="checkbox" checked={c.on} disabled={!!c.problem} onChange={(e) => editMapDraft(all.map((x) => (x.key === c.key ? { ...x, on: e.target.checked } : x)))} />
        <span><b>{c.title}</b>{c.why && <span className="chg-why">{c.why}</span>}</span></label>
      {c.problem && <p className="micro warn">Cannot be applied: {c.problem}</p>}
      {waiting && <p className="micro warn">Needs a new box you unticked.</p>}
      {c.op === 'remove' && !c.problem && <p className="micro">Removals start unticked. Tick only if the notes show this no longer happens.</p>}
      <details className="plain"><summary>Based on {basis.length} note{basis.length === 1 ? '' : 's'}{kinds.length ? `: ${kinds.join(', ').toLowerCase()}` : ''}</summary>
        <ul className="chg-notes">{basis.map((n) => <li key={n.id}><span className="chip">{n.certainty ? CERTAINTY_LABEL[n.certainty] : 'Not recorded'}</span> {n.text}<em>{sources.find((s) => s.id === n.sourceId)?.anonId ?? ''}</em></li>)}</ul>
      </details>
    </li>
  );
}

export function MapProposals() {
  const d = useStore((s) => s.mapDraft)!;
  const [busy, setBusy] = useState(false);
  const stop = blocked(d.changes), count = d.changes.filter((c) => c.on && !c.problem && !stop.has(c.key)).length;
  const create = async () => {
    setBusy(true);
    try { const n = await createMapDraft(); toast(`Draft made with ${n} change${n === 1 ? '' : 's'}. Compare it with the main map, then adopt it or leave it.`); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <div className="page" data-testid="map-proposals">
      <header className="page-head"><div><h1>Map changes from notes</h1>
        <p>{d.method === 'fixture' ? 'Proposed by the test provider (no AI)' : 'Proposed by Claude'} from {d.noteIds.length} notes. Ticked changes go into a draft version of the map; the main map does not change until you adopt the draft.</p></div>
        <button className="linkbtn" onClick={() => setState({ mapDraft: null })} data-testid="proposals-cancel">Cancel</button></header>
      {!d.changes.length && <p className="micro">No changes proposed: the map already fits these notes, or they do not say enough.</p>}
      {GROUPS.map(([title, f]) => { const list = d.changes.filter(f); return list.length ? (
        <section key={title} className="card chg-group"><h3>{title} <em>{list.length}</em></h3><ul>{list.map((c) => <ChangeRow key={c.key} c={c} all={d.changes} waiting={stop.has(c.key)} />)}</ul></section>
      ) : null; })}
      <div className="chg-bar"><button className="primary" disabled={!count || busy} onClick={create} data-testid="make-draft">{busy ? 'Making the draft…' : `Make a draft with ${count} change${count === 1 ? '' : 's'}`}</button></div>
    </div>
  );
}

/** On a draft or scenario: make it the main map, after checking the main map has not moved on. */
export function AdoptButton({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  if (!canEdit()) return null;
  const adopt = async () => {
    if (!confirm(`Make “${name}” the main map? The current main map stays in its history and can be restored.`)) return;
    setBusy(true);
    try {
      let r = await adoptDraft();
      if (r === 'changed') {
        if (!confirm('The main map has changed since this draft was made. Adopting replaces those changes with the draft (they stay in the main map\'s history). Adopt anyway?')) return;
        r = await adoptDraft(true);
      }
      toast('Adopted. This is now the main map.');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return <button className="primary" onClick={adopt} disabled={busy} data-testid="adopt-draft">{busy ? 'Adopting…' : 'Adopt into the main map'}</button>;
}
