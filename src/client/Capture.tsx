import { useMemo, useState } from 'react';
import { canEdit, closeModal, createDoc, deleteDocById, editInsightsUi, fail, flush, getState, goToTarget, openModal, setNav, setSession, toast, updateDoc, useStore, type V } from './store';
import { Field, Modal } from './ui';
import { anchorState, targetLabel } from '../shared/diff';
import { NOTE_KINDS, RELATIONS, RELATION_LABEL, SOURCE_TYPES, type Episode, type Note } from '../shared/workspace';
import { insightTitle } from '../shared/evidence';

const EPISODE_FIELDS: [keyof Episode, string, string][] = [
  ['task', 'Task and intended outcome', 'What was the person trying to get done?'],
  ['action', 'What they actually did', 'Actions in order, as seen or described'],
  ['helped', 'Conditions that helped', 'Time, tools, information, support'],
  ['hindered', 'Conditions that got in the way', 'Interruptions, missing information, waiting'],
  ['outcome', 'What happened', 'The result for the work item or the person served'],
  ['hiddenEffort', 'Hidden effort, workaround or support', 'Work that would not show in a process chart'],
  ['clarification', 'Participant clarification', 'What they said when you talked it through'],
];
const emptyEpisode = (): Episode => ({ task: '', intendedOutcome: '', action: '', helped: '', hindered: '', outcome: '', hiddenEffort: '', clarification: '' });

export function targetOptions() {
  const m = getState().model;
  if (!m) return [];
  return [
    ...m.edges.map((e) => ({ id: e.id, label: `Connection · ${e.label}` })), ...m.nodes.map((n) => ({ id: n.id, label: `Node · ${n.label}` })),
    ...m.activities.filter((a) => !a.edgeId).map((a) => ({ id: a.id, label: `Activity · ${a.label}` })),
  ];
}

/** One-line capture. Inherits the active session; the target comes from the current selection unless overridden. */
export function QuickCapture({ targetId, onSaved, compact, autoFocus }: { targetId: string | null; onSaved?: () => void; compact?: boolean; autoFocus?: boolean }) {
  const session = useStore((s) => s.session), branchId = useStore((s) => s.branchId), model = useStore((s) => s.model);
  const [text, setText] = useState(''), [kind, setKind] = useState<Note['kind']>('observation'), [certainty, setCertainty] = useState<'observed' | 'reported' | ''>('');
  const [more, setMore] = useState(false), [episode, setEpisode] = useState<Episode>(emptyEpisode()), [busy, setBusy] = useState(false);
  const [split, setSplit] = useState<boolean[] | null>(null);
  const lines = useMemo(() => text.split('\n').map((l) => l.replace(/^\s*[-•*\d.)]+\s*/, '').trim()).filter(Boolean), [text]);
  if (!canEdit()) return null;
  const tLabel = targetId && model ? targetLabel(model, targetId) : null;
  const hasEpisode = Object.values(episode).some((v) => v.trim());

  const save = async () => {
    const texts = split ? lines.filter((_, i) => split[i]) : [text.trim()];
    if (!texts.length || !texts[0]) return;
    setBusy(true);
    try {
      if (targetId) await flush(); // the target must exist in a saved revision before a note can anchor to it
      for (const t of texts) {
        await createDoc('notes', { text: t, kind, sourceId: session?.sourceId ?? null, group: session?.group ?? '', targetId, anchorBranchId: targetId ? branchId : null, certainty: certainty || null, episode: hasEpisode && !split ? episode : null });
      }
      setText(''); setEpisode(emptyEpisode()); setSplit(null); setMore(false);
      toast(texts.length > 1 ? `${texts.length} notes saved` : tLabel ? `Note saved on “${tLabel}”` : 'Note saved to the inbox');
      onSaved?.();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <div className={`capture${compact ? ' compact' : ''}`} data-testid="quick-capture">
      <div className="capture-context">
        {session ? <span className="chip session" data-testid="capture-session">◎ {session.label}</span> : <button className="linkbtn" onClick={() => openModal('session')}>Start a session to set the source</button>}
        <span className="chip">{tLabel ? `On: ${tLabel}` : 'Unassigned (inbox)'}</span>
      </div>
      <textarea value={text} rows={compact ? 2 : 3} {...(autoFocus ? { 'data-autofocus': true } : {})} placeholder="What did you see or hear? One observation per note." aria-label="Note text" data-testid="capture-text"
        onChange={(e) => { setText(e.target.value); if (split) setSplit(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }} />
      {lines.length > 1 && !hasEpisode && (
        <div className="split">
          {!split ? <button className="linkbtn" data-testid="split-toggle" onClick={() => setSplit(lines.map(() => true))}>This looks like {lines.length} notes. Preview a split</button> : (
            <>
              <b>Split into {split.filter(Boolean).length} notes</b>
              <ul>{lines.map((l, i) => <li key={i}><label><input type="checkbox" checked={split[i]} onChange={(e) => setSplit(split.map((v, j) => (j === i ? e.target.checked : v)))} /> {l}</label></li>)}</ul>
              <button className="linkbtn" onClick={() => setSplit(null)}>Keep as one note</button>
            </>
          )}
        </div>
      )}
      <div className="capture-row">
        <select value={kind} onChange={(e) => setKind(e.target.value as Note['kind'])} aria-label="Note type">{NOTE_KINDS.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select>
        <select value={certainty} onChange={(e) => setCertainty(e.target.value as 'observed' | 'reported' | '')} aria-label="How you know this">
          <option value="">How do you know?</option><option value="observed">I observed it</option><option value="reported">A participant reported it</option>
        </select>
        <button className="linkbtn" onClick={() => setMore(!more)} aria-expanded={more} data-testid="episode-toggle">{more ? 'Hide work episode' : 'Add work episode detail'}</button>
        <button className="primary" disabled={busy || !text.trim()} onClick={save} data-testid="capture-save">Save note</button>
      </div>
      {more && (
        <div className="episode-form">
          <p className="micro">Describe the task and its conditions. This is about the work in context, not a rating of the person.</p>
          {EPISODE_FIELDS.map(([k, label, hint]) => (
            <Field key={k} label={label}>
              <textarea rows={2} value={episode[k]} placeholder={hint} data-testid={`episode-${k}`} onChange={(e) => setEpisode({ ...episode, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      )}
    </div>
  );
}

export function NoteModal({ data }: { data?: { targetId?: string | null } }) {
  const selection = useStore((s) => s.selection);
  const [target, setTarget] = useState<string>(data?.targetId !== undefined ? data.targetId ?? '' : selection?.id ?? '');
  return (
    <Modal title="Capture a note" onClose={closeModal}>
      <Field label="Attach to"><select value={target} onChange={(e) => setTarget(e.target.value)} data-testid="capture-target"><option value="">Unassigned (inbox)</option>{targetOptions().map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
      <QuickCapture targetId={target || null} onSaved={closeModal} autoFocus />
    </Modal>
  );
}

export function SessionModal() {
  const sources = useStore((s) => s.evidence.sources), session = useStore((s) => s.session);
  const [existing, setExisting] = useState(session?.sourceId ?? ''), [anonId, setAnonId] = useState(''), [type, setType] = useState<(typeof SOURCE_TYPES)[number]>('interview');
  const [role, setRole] = useState(''), [date, setDate] = useState(new Date().toISOString().slice(0, 10)), [group, setGroup] = useState(session?.group ?? '');
  const start = async () => {
    try {
      let src = sources.find((s) => s.id === existing);
      if (!src) {
        if (!anonId.trim()) { toast('Give the source an anonymous ID, such as “Interview 04”.', 'error'); return; }
        src = await createDoc('sources', { anonId: anonId.trim(), type, participantRole: role.trim(), date, collection: group.trim() });
      }
      setSession({ sourceId: src.id, label: src.anonId, group: group.trim() || src.collection, startedAt: new Date().toISOString() });
      toast(`Session started: ${src.anonId}. Notes inherit this source.`); closeModal();
    } catch (e) { fail(e); }
  };
  return (
    <Modal title="Fieldwork session" onClose={closeModal} footer={<>{session && <button onClick={() => { setSession(null); closeModal(); toast('Session ended'); }}>End session</button>}<button className="primary" onClick={start} data-testid="session-start">Start session</button></>}>
      <p className="micro">A session sets the source for every note you capture until you end it. Use anonymous IDs only; never a participant’s name.</p>
      {sources.length > 0 && <Field label="Continue with an existing source"><select value={existing} onChange={(e) => setExisting(e.target.value)}><option value="">New source…</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.anonId} ({s.type})</option>)}</select></Field>}
      {!existing && (<>
        <Field label="Anonymous source ID"><input value={anonId} onChange={(e) => setAnonId(e.target.value)} placeholder="Interview 04" data-testid="session-anon" /></Field>
        <div className="row2">
          <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value as typeof type)} data-testid="session-type">{SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
          <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Participant role" hint="Role level only. Not shown in leadership exports."><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Coordinator" data-testid="session-role" /></Field>
      </>)}
      <Field label="Collection" hint="Groups this session’s notes on the board"><input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Placement walkthroughs" data-testid="session-group" /></Field>
    </Modal>
  );
}

/** Click-through from a link to the record at its other end. */
export function jumpTo(type: 'note' | 'insight', id: string) {
  const want = type === 'insight' ? 'insights' : 'notes';
  if (type === 'insight') editInsightsUi({ expanded: id, scroll: -1 });
  if (getState().nav !== want) setNav(want);
  setTimeout(() => { const el = document.querySelector<HTMLElement>(`[data-${type}="${id}"]`); el?.scrollIntoView({ block: 'center' }); el?.classList.add('flash'); setTimeout(() => el?.classList.remove('flash'), 1600); }, 80);
}

const KIND_COLOR: Record<string, string> = { observation: 'yellow', measurement: 'green', hypothesis: 'pink', insight: 'blue', question: 'blue', recommendation: 'green' };

export function NoteCard({ note, showTarget = true }: { note: V<Note>; showTarget?: boolean }) {
  const model = useStore((s) => s.model)!, sources = useStore((s) => s.evidence.sources), links = useStore((s) => s.evidence.links), notes = useStore((s) => s.evidence.notes), insights = useStore((s) => s.evidence.insights);
  const branches = useStore((s) => s.branches), branchId = useStore((s) => s.branchId);
  const [open, setOpen] = useState(false);
  const src = sources.find((s) => s.id === note.sourceId);
  const state = anchorState(model, note.targetId);
  const mine = links.filter((l) => (l.fromType === 'note' && l.fromId === note.id) || (l.toType === 'note' && l.toId === note.id));
  const ep = note.episode;
  const anchoredOn = branches.find((b) => b.id === note.anchorBranchId)?.name ?? 'the baseline';
  const other = (l: (typeof mine)[number]) => {
    const out = l.fromType === 'note' && l.fromId === note.id, type = out ? l.toType : l.fromType, id = out ? l.toId : l.fromId;
    const label = type === 'note' ? notes.find((n) => n.id === id)?.text.slice(0, 60) : insightTitle(insights.find((i) => i.id === id) ?? ({ title: '', body: '' } as any));
    return { type, id, label: label ?? '(removed)', out };
  };
  return (
    <article className={`sticky ${note.color || KIND_COLOR[note.kind]}`} data-note={note.id} data-kind={note.kind}>
      <header>
        <span className="sticky-kind">{note.kind}{note.certainty ? ` · ${note.certainty}` : ''}</span>
        {note.category && <span className="chip">{note.category}</span>}
        {note.excerptApproved && <span className="chip ok" title="Approved for agent use and quoting in exports">approved excerpt</span>}
      </header>
      <p className="sticky-text">{note.text}</p>
      {ep && (
        <dl className="episode" data-testid="episode">
          <dt>Work episode</dt>
          {EPISODE_FIELDS.filter(([k]) => ep[k]?.trim()).map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{ep[k]}</dd></div>)}
        </dl>
      )}
      <footer>
        <span className="sticky-source" title="Source">{src ? src.anonId : 'No source yet'}</span>
        {showTarget && (state === 'attached'
          ? <button className="anchor" data-anchor-state="attached" onClick={() => goToTarget(note.targetId!)}>↗ {targetLabel(model, note.targetId)}</button>
          : state === 'historical'
            ? <span className="anchor historical" data-anchor-state="historical" title={`Still attached on ${anchoredOn}`}>Historical: “{note.targetId}” is not in {branchId === 'baseline' ? 'the current baseline' : 'this scenario'} (still attached on {anchoredOn})</span>
            : <span className="anchor unassigned" data-anchor-state="unassigned">Unassigned</span>)}
      </footer>
      {mine.length > 0 && (
        <ul className="note-links">{mine.map((l) => { const o = other(l); return (
          <li key={l.id} data-relation={l.relation}><span className={`rel rel-${l.relation}`}>{RELATION_LABEL[l.relation]}{o.out ? ' →' : ' ←'}</span>
            <button className="linkbtn" onClick={() => jumpTo(o.type, o.id)}>{o.type === 'insight' ? 'Insight: ' : ''}{o.label}</button></li>); })}
        </ul>
      )}
      {canEdit() && <div className="sticky-actions"><button className="linkbtn" onClick={() => setOpen(true)} data-testid="note-edit">Edit</button><button className="linkbtn" onClick={() => openModal('link', { fromType: 'note', fromId: note.id })}>Link</button></div>}
      {open && <NoteEditor note={note} onClose={() => setOpen(false)} />}
    </article>
  );
}

function NoteEditor({ note, onClose }: { note: V<Note>; onClose: () => void }) {
  const sources = useStore((s) => s.evidence.sources), branchId = useStore((s) => s.branchId);
  const [d, setD] = useState({ text: note.text, kind: note.kind, sourceId: note.sourceId ?? '', targetId: note.targetId ?? '', group: note.group, category: note.category, color: note.color, certainty: note.certainty ?? '', excerptApproved: note.excerptApproved });
  const [ep, setEp] = useState<Episode>(note.episode ?? emptyEpisode());
  const save = async () => {
    try {
      const retarget = (d.targetId || null) !== note.targetId;
      if (retarget && d.targetId) await flush();
      await updateDoc('notes', note.id, { ...d, sourceId: d.sourceId || null, targetId: d.targetId || null, certainty: d.certainty || null, episode: Object.values(ep).some((v) => v.trim()) ? ep : null, ...(retarget ? { anchorBranchId: d.targetId ? branchId : null, anchorRevisionId: null } : {}) });
      toast('Note updated'); onClose();
    } catch (e) { fail(e); }
  };
  return (
    <Modal title="Edit note" onClose={onClose} wide footer={<><button className="danger" onClick={async () => { if (confirm('Delete this note? Links to it are removed too.')) { try { await deleteDocById('notes', note.id); onClose(); } catch (e) { fail(e); } } }}>Delete</button><button className="primary" onClick={save} data-testid="note-save">Save</button></>}>
      <Field label="Note"><textarea rows={3} value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} data-testid="note-text" /></Field>
      {note.rawText && note.rawText !== d.text && <p className="micro raw">As first captured: “{note.rawText}”</p>}
      <div className="row2">
        <Field label="Type"><select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Note['kind'] })}>{NOTE_KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
        <Field label="How you know"><select value={d.certainty} onChange={(e) => setD({ ...d, certainty: e.target.value })}><option value="">Not recorded</option><option value="observed">Observed by the researcher</option><option value="reported">Reported by a participant</option><option value="inferred">Inferred</option></select></Field>
      </div>
      <div className="row2">
        <Field label="Source"><select value={d.sourceId} onChange={(e) => setD({ ...d, sourceId: e.target.value })}><option value="">No source yet</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.anonId}</option>)}</select></Field>
        <Field label="Attached to"><select value={d.targetId} onChange={(e) => setD({ ...d, targetId: e.target.value })} data-testid="note-target"><option value="">Unassigned</option>{note.targetId && !targetOptions().some((o) => o.id === note.targetId) && <option value={note.targetId}>Historical: {note.targetId}</option>}{targetOptions().map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
      </div>
      <div className="row3">
        <Field label="Collection / theme"><input value={d.group} onChange={(e) => setD({ ...d, group: e.target.value })} /></Field>
        <Field label="Category"><input value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} data-testid="note-category" /></Field>
        <Field label="Colour"><select value={d.color} onChange={(e) => setD({ ...d, color: e.target.value })}><option value="">By type</option>{['yellow', 'green', 'pink', 'blue', 'purple'].map((c) => <option key={c}>{c}</option>)}</select></Field>
      </div>
      <label className="check"><input type="checkbox" checked={d.excerptApproved} onChange={(e) => setD({ ...d, excerptApproved: e.target.checked })} data-testid="note-approve" /> Approved, de-identified excerpt: may be sent to a research provider and quoted in exports</label>
      <details className="plain" open={!!note.episode}><summary>Work episode detail</summary>
        {EPISODE_FIELDS.map(([k, label]) => <Field key={k} label={label}><textarea rows={2} value={ep[k]} onChange={(e) => setEp({ ...ep, [k]: e.target.value })} /></Field>)}
      </details>
    </Modal>
  );
}

/** Link a note or insight to another note or insight with a typed relation. */
export function LinkModal({ data }: { data: { fromType: 'note' | 'insight'; fromId: string } }) {
  const notes = useStore((s) => s.evidence.notes), insights = useStore((s) => s.evidence.insights);
  const [to, setTo] = useState(''), [relation, setRelation] = useState<(typeof RELATIONS)[number]>('supports'), [comment, setComment] = useState('');
  const save = async () => {
    const [toType, toId] = to.split(':');
    if (!toId) return;
    try { await createDoc('links', { fromType: data.fromType, fromId: data.fromId, toType, toId, relation, comment }); toast('Linked'); closeModal(); } catch (e) { fail(e); }
  };
  return (
    <Modal title="Link evidence" onClose={closeModal} footer={<button className="primary" onClick={save} disabled={!to} data-testid="link-save">Add link</button>}>
      <Field label="This record…"><select value={relation} onChange={(e) => setRelation(e.target.value as typeof relation)} data-testid="link-relation">{RELATIONS.map((r) => <option key={r} value={r}>{RELATION_LABEL[r]}</option>)}</select></Field>
      <Field label="…this one"><select value={to} onChange={(e) => setTo(e.target.value)} data-testid="link-to"><option value="">Choose…</option>
        <optgroup label="Insights">{insights.filter((i) => !(data.fromType === 'insight' && i.id === data.fromId)).map((i) => <option key={i.id} value={`insight:${i.id}`}>{insightTitle(i)}</option>)}</optgroup>
        <optgroup label="Notes">{notes.filter((n) => !(data.fromType === 'note' && n.id === data.fromId)).map((n) => <option key={n.id} value={`note:${n.id}`}>{n.kind}: {n.text.slice(0, 80)}</option>)}</optgroup>
      </select></Field>
      <Field label="Comment (optional)"><input value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
    </Modal>
  );
}
