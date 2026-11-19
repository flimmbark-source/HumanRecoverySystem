// The archive: notes, documents, PDFs and pictures added to a project. Each one is read (on the phone, or by
// Claude when chosen), split into proposed notes that are reviewed where they sit in the text, then saved.
// The original file is not kept; the archive holds its text and a way to open it again.
import { useEffect, useMemo, useRef, useState } from 'react';
import { canEdit, claudeKey, discardImport, editImport, fail, getState, holdFile, onlineClaude, pendingFile, reloadProjectMeta, saveImport, setClaudeKey, setNav, splitWithClaudeRemote, startImport, toast, useStore, type ImportDraft, type V } from './store';
import { patch } from './api';
import { Field, Modal, onDevice, when } from './ui';
import { readNotesFile } from './docx';
import { IMPORT_KINDS, IMPORT_KIND_LABEL, findNames, locate, lookReasons, markRepeats, merge, proposalAt, replaceNames, splitAt, splitOffline, type Proposal } from '../shared/fieldnotes';
import { FILE_MIMES } from '../shared/fieldnotes-ai';
import { CERTAINTY_LABEL, SOURCE_TYPES, type ImportRecord } from '../shared/workspace';
import { targetLabel } from '../shared/diff';

const isReadable = (mime: string) => (FILE_MIMES as readonly string[]).includes(mime);
const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const guessMime = (name: string, mime: string) => mime || ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', txt: 'text/plain', md: 'text/markdown', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } as Record<string, string>)[name.split('.').pop()?.toLowerCase() ?? ''] || '';
const b64 = async (blob: Blob) => { const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

type Picked = { name: string; mime: string; size: number; ref: string; data?: string; file?: File; error?: string; lasting?: boolean };
const android = () => (window as unknown as { WeaveAndroid?: { pickFile?: () => void; openFile?: (ref: string, mime: string) => void } }).WeaveAndroid;

/** Picks one file. In the Android app the system picker also offers Drive and other cloud apps, and the app
 *  keeps permission to open the file again later; in a browser only the name is kept. */
function pickFile(): Promise<Picked | null> {
  const a = android();
  if (a?.pickFile) return new Promise((resolve) => { (window as unknown as { weaveFilePicked: (p: Picked | null) => void }).weaveFilePicked = (p) => resolve(p); a.pickFile!(); });
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.txt,.md,.text,.docx,.pdf,.png,.jpg,.jpeg,.webp,.gif,text/plain,application/pdf,image/*' });
    input.onchange = () => { const f = input.files?.[0]; resolve(f ? { name: f.name, mime: f.type, size: f.size, ref: '', file: f } : null); };
    input.click();
  });
}
export function openOriginal(file: NonNullable<ImportRecord['file']>) {
  const a = android();
  if (file.ref && a?.openFile) a.openFile(file.ref, file.mime);
  else if (file.link) window.open(file.link, '_blank', 'noopener');
}

// ---- the archive on the Notes page -----------------------------------------------------------------------
export function Archive() {
  const imports = useStore((s) => s.evidence.imports), notes = useStore((s) => s.evidence.notes);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="card archive" data-testid="archive">
      <div className="archive-head"><h3>Archive <em>{imports.length}</em></h3>{canEdit() && <button className="primary" onClick={startImport} data-testid="archive-add">+ Add notes or a file</button>}</div>
      {!imports.length && <p className="micro">Field notes, reports, procedures, emails and photos of whiteboards. Each is split into notes you check before they are saved, and each note remembers where in the original it came from.</p>}
      <ul className="archive-list">{[...imports].reverse().map((im) => {
        const mine = notes.filter((n) => n.origin?.importId === im.id);
        return (
          <li key={im.id} data-import={im.id} data-testid="archive-item">
            <button className="rowbtn" aria-expanded={open === im.id} onClick={() => setOpen(open === im.id ? null : im.id)}>
              <span><b>{im.name}</b><em>{im.docType === 'document' ? 'Document' : 'Field notes'}{im.file?.name ? ` · ${im.file.name}` : ''} · {mine.length} note{mine.length === 1 ? '' : 's'} · {when(im.createdAt)}</em></span>
            </button>
            {(im.file?.ref && onDevice) || im.file?.link ? <button className="linkbtn" onClick={() => openOriginal(im.file!)} data-testid="open-original">Open original</button> : null}
            {open === im.id && <ArchiveText im={im} />}
          </li>
        );
      })}</ul>
    </section>
  );
}
function ArchiveText({ im }: { im: V<ImportRecord> }) {
  const notes = useStore((s) => s.evidence.notes).filter((n) => n.origin?.importId === im.id && n.origin.start >= 0).sort((a, b) => a.origin!.start - b.origin!.start);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const n of notes) {
    const s = Math.max(n.origin!.start, pos);
    if (s > pos) parts.push(im.text.slice(pos, s));
    if (n.origin!.end > s) parts.push(<mark key={n.id} className={`fn-span k-${n.kind}`} title={n.text}>{im.text.slice(s, n.origin!.end)}</mark>);
    pos = Math.max(pos, n.origin!.end);
  }
  parts.push(im.text.slice(pos));
  return <div className="fn-doc archive-doc">{parts}</div>;
}

/** On a note: the passage of the archive it came from, with the note's own words marked. */
export function NoteContext({ origin }: { origin: { importId: string; start: number; end: number } }) {
  const im = useStore((s) => s.evidence.imports.find((i) => i.id === origin.importId));
  if (!im || origin.start < 0) return <p className="micro">{im ? `From ${im.name}.` : 'The archive entry this came from was removed.'}</p>;
  const from = Math.max(0, im.text.lastIndexOf('\n\n', origin.start - 1) + 1, origin.start - 400), to = Math.min(im.text.length, (im.text.indexOf('\n\n', origin.end) + 1 || im.text.length + 1) - 1, origin.end + 400);
  return (
    <blockquote className="note-context" data-testid="note-context"><small>From {im.name}{im.file?.name ? ` (${im.file.name})` : ''}</small>
      <p>{from > 0 && '… '}{im.text.slice(from, origin.start)}<mark>{im.text.slice(origin.start, origin.end)}</mark>{im.text.slice(origin.end, to)}{to < im.text.length && ' …'}</p>
      {((im.file?.ref && onDevice) || im.file?.link) && <button className="linkbtn" onClick={() => openOriginal(im.file!)}>Open original</button>}
    </blockquote>
  );
}

// ---- adding: the text or file, what it is, who it is from, names -----------------------------------------
export function ImportFlow() {
  const d = useStore((s) => s.importDraft)!;
  return d.step === 'input' ? <ImportInput d={d} /> : <ImportReview d={d} />;
}

function SourcePicker({ d }: { d: ImportDraft }) {
  const sources = useStore((s) => s.evidence.sources);
  return (
    <fieldset className="fn-who"><legend>Who is it from?</legend>
      <label className="check"><input type="radio" checked={d.mode === 'one'} onChange={() => editImport({ mode: 'one' })} /> One person, session or document</label>
      {d.mode === 'one' && (<div className="fn-indent">
        <select value={d.sourceId ?? ''} aria-label="Source" data-testid="import-source" onChange={(e) => editImport({ sourceId: e.target.value || null })}>
          <option value="">No source yet</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.anonId}</option>)}<option value="new:main">New source…</option>
        </select>
        {d.sourceId === 'new:main' && <div className="row3">
          <Field label="Anonymous name"><input value={d.newSource.anonId} placeholder="e.g. Interview 05" data-testid="import-new-source" onChange={(e) => editImport({ newSource: { ...d.newSource, anonId: e.target.value } })} /></Field>
          <Field label="Type"><select value={d.newSource.type} onChange={(e) => editImport({ newSource: { ...d.newSource, type: e.target.value } })}>{SOURCE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Role (no names)"><input value={d.newSource.participantRole} placeholder="e.g. Coordinator" onChange={(e) => editImport({ newSource: { ...d.newSource, participantRole: e.target.value } })} /></Field>
        </div>}
      </div>)}
      <label className="check"><input type="radio" checked={d.mode === 'several'} onChange={() => editImport({ mode: 'several' })} data-testid="import-several" /> Several people, labelled in the text (“Sam: …”)</label>
    </fieldset>
  );
}

/** Names found in the text, each with what to replace it by. Applied to the text (and any notes already proposed). */
function NamesPanel({ d, open: startOpen }: { d: ImportDraft; open?: boolean }) {
  const model = useStore((s) => s.model);
  const text = d.step === 'input' ? d.raw : d.text;
  const found = useMemo(() => findNames(text, model), [text, model]);
  const rows = [...d.names.filter((n) => text.includes(n.name)), ...found.filter((f) => !d.names.some((n) => n.name === f.name)).map((f) => ({ name: f.name, with: '', on: true }))];
  const [extra, setExtra] = useState('');
  const set = (name: string, patch: Partial<ImportDraft['names'][number]>) => editImport((x) => ({ names: [...x.names.filter((n) => n.name !== name), { ...(rows.find((r) => r.name === name) ?? { name, with: '', on: true }), ...patch }] }));
  const apply = () => {
    const pairs = rows.filter((r) => r.on && r.with.trim()).map((r) => ({ name: r.name, with: r.with }));
    if (!pairs.length) return;
    editImport((x) => {
      const doc = replaceNames(x.text, pairs);
      let from = 0;
      const proposals = x.proposals.map((p) => {
        const excerpt = replaceNames(p.excerpt, pairs), at = locate(doc, excerpt, from);
        if (at) from = at.end;
        return { ...p, excerpt, text: replaceNames(p.text, pairs), readable: replaceNames(p.readable, pairs), speaker: replaceNames(p.speaker, pairs), start: at?.start ?? -1, end: at?.end ?? -1 };
      });
      return { text: doc, proposals, names: x.names.map((n) => (pairs.some((p) => p.name === n.name) ? { ...n, on: false } : n)) };
    });
    toast(`Replaced ${pairs.length} name${pairs.length === 1 ? '' : 's'}`);
  };
  const pending = rows.filter((r) => r.on);
  return (
    <details className="fn-names" open={startOpen || undefined} data-testid="names-panel">
      <summary>Names in the text {pending.length ? <em>{pending.length} to check</em> : <em>none found</em>}</summary>
      <p className="micro">Replace people's names with their role before anything is saved{d.step === 'input' ? ' or sent to Claude' : ''}. Untick a word that is not a name.</p>
      <ul className="fn-name-list">{rows.map((r) => (
        <li key={r.name} data-name={r.name}><label className="check"><input type="checkbox" checked={r.on} onChange={(e) => set(r.name, { on: e.target.checked })} /> <b>{r.name}</b></label>
          {r.on && <input value={r.with} placeholder="Replace with, e.g. Coordinator" aria-label={`Replace ${r.name} with`} data-testid="name-with" onChange={(e) => set(r.name, { with: e.target.value })} />}</li>
      ))}</ul>
      <div className="capture-row"><input value={extra} placeholder="Another name to replace" aria-label="Another name" onChange={(e) => setExtra(e.target.value)} /><button onClick={() => { if (extra.trim()) { set(extra.trim(), { on: true }); setExtra(''); } }}>Add</button></div>
      {d.step === 'review' && <button onClick={apply} disabled={!rows.some((r) => r.on && r.with.trim())} data-testid="names-apply">Replace in the text</button>}
    </details>
  );
}

function ClaudeConsent({ what, onSend, onClose }: { what: React.ReactNode; onSend: () => void; onClose: () => void }) {
  return (
    <Modal title="Send to Claude?" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={onSend} data-testid="claude-send">Send</button></>}>
      {what}
      <p className="micro">The names of the boxes and connections on your map go with it, so Claude can suggest where each note belongs. Nothing is saved until you review the result.</p>
    </Modal>
  );
}

function ImportInput({ d }: { d: ImportDraft }) {
  const project = useStore((s) => s.project)!, model = useStore((s) => s.model)!, notes = useStore((s) => s.evidence.notes), provider = useStore((s) => s.provider);
  const [busy, setBusy] = useState(''), [ask, setAsk] = useState(false), [about, setAbout] = useState('');
  const binary = !!d.file && isReadable(d.file.mime) && !d.raw;
  const filesOn = project.meta.aiFiles === 'on';
  const claude = onlineClaude(provider);
  const choose = async () => {
    const p = await pickFile();
    if (!p) return;
    if (p.error) return fail(new Error(p.error));
    const mime = guessMime(p.name, p.mime);
    const meta = { name: p.name, mime, size: p.size, ref: p.ref, link: d.file?.link ?? '' };
    const name = d.name || p.name.replace(/\.[^.]+$/, '');
    try {
      if (isReadable(mime)) {
        holdFile({ name: p.name, mime, data: p.data ?? (await b64(p.file!)) });
        editImport({ file: meta, raw: '', name, docType: mime.startsWith('image/') ? d.docType : 'document' });
      } else {
        const blob = p.file ?? new File([Uint8Array.from(atob(p.data ?? ''), (ch) => ch.charCodeAt(0))], p.name, { type: mime });
        const text = await readNotesFile(blob as File);
        holdFile(null);
        editImport({ file: meta, raw: text, name, docType: /\.docx$/i.test(p.name) && d.docType === 'notes' ? d.docType : d.docType });
      }
      if (!p.ref && !onDevice) toast('The file itself is not kept. Add a link to it below if you want to open it from here later.');
      else if (p.lasting === false) toast('That app does not let Weave open the file again later. Add a link to it below if you need to.');
    } catch (e) { fail(e); }
  };
  const replaced = () => replaceNames(d.raw, d.names.filter((n) => n.on && n.with.trim()).map((n) => ({ name: n.name, with: n.with })));
  const unreplaced = () => findNames(replaced(), model).filter((f) => !d.names.some((n) => n.name === f.name && !n.on));
  const toReview = (text: string, method: ImportDraft['method'], proposals: Proposal[]) =>
    editImport({ step: 'review', text, method, proposals: markRepeats(proposals, notes), selected: null, filter: 'all', name: d.name.trim() || d.file?.name || `Field notes ${new Date().toLocaleDateString()}` });
  const onPhone = () => { const text = replaced(); toReview(text, 'phone', splitOffline(text, model, d.docType)); };
  const withClaude = async () => {
    setAsk(false);
    setBusy(binary ? 'Claude is reading the file…' : 'Claude is splitting the notes…');
    try {
      if (binary) {
        if (!pendingFile) throw new Error('Choose the file again: it is not kept after the app closes.');
        const r = await splitWithClaudeRemote({ file: pendingFile }, d.docType);
        toReview(r.transcript ?? '', r.method, r.proposals);
      } else {
        const text = replaced();
        const r = await splitWithClaudeRemote({ text }, d.docType);
        toReview(text, r.method, r.proposals);
      }
    } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const keepOnly = async () => {
    // A file kept for reference: no notes, its description is the text.
    editImport({ text: about.trim(), proposals: [], method: 'phone', name: d.name.trim() || d.file?.name || 'File' });
    try { await saveImport(); toast('Added to the archive'); } catch (e) { fail(e); }
  };
  const setLink = (link: string) => editImport({ file: d.file ? { ...d.file, link } : link ? { name: '', mime: '', size: 0, ref: '', link } : null });
  return (
    <div className="page import-page" data-testid="import">
      <header className="page-head"><div><h1>Add to the archive</h1><p>Field notes, a report, a procedure, an email or a photo of a whiteboard. It is split into notes, one claim each, that you check before anything is saved.</p></div>
        <button className="linkbtn" onClick={() => { discardImport(); setNav('notes'); }} data-testid="import-cancel">Cancel</button></header>
      <section className="card fn-card">
        <div className="btnrow"><button onClick={choose} data-testid="import-file">{d.file?.name ? 'Choose another file' : 'Choose a file'}</button><span className="micro">Text, Word, PDF or image{onDevice ? ', from the phone or a cloud app such as Drive' : ''}. The file is not copied into the app.</span></div>
        {d.file?.name && <p className="fn-file" data-testid="import-file-name">📄 <b>{d.file.name}</b> <em>{d.file.size ? size(d.file.size) : ''}</em> <button className="linkbtn" onClick={() => { holdFile(null); editImport({ file: d.file?.link ? { name: '', mime: '', size: 0, ref: '', link: d.file.link } : null, raw: binary ? '' : d.raw }); }}>Remove</button></p>}
        {!binary && <Field label={d.file?.name ? 'Text read from the file' : 'Or paste the notes'}><textarea rows={9} value={d.raw} placeholder="Paste notes here. Bullets, paragraphs, “Name: what they said”…" data-testid="import-text" onChange={(e) => editImport({ raw: e.target.value })} /></Field>}
        <div className="row2">
          <Field label="Name in the archive"><input value={d.name} placeholder="e.g. Coordinator interview, 12 March" data-testid="import-name" onChange={(e) => editImport({ name: e.target.value })} /></Field>
          <Field label="Link to the original (optional)" hint="A share link from Drive, OneDrive or Dropbox, to open it from here."><input type="url" value={d.file?.link ?? ''} placeholder="https://" data-testid="import-link" onChange={(e) => setLink(e.target.value)} /></Field>
        </div>
        <fieldset className="fn-what"><legend>What is it?</legend>
          <div className="seg" role="radiogroup">
            <button role="radio" aria-checked={d.docType === 'notes'} className={d.docType === 'notes' ? 'on' : ''} onClick={() => editImport({ docType: 'notes' })} data-testid="type-notes">My field notes</button>
            <button role="radio" aria-checked={d.docType === 'document'} className={d.docType === 'document' ? 'on' : ''} onClick={() => editImport({ docType: 'document' })} data-testid="type-document">A document</button>
          </div>
          <p className="micro">{d.docType === 'document' ? 'A report, procedure, form or email. What it says is marked “documented”: how work is meant to run, which is not the same as seeing it.' : 'What you saw and were told. Only what your notes say you saw is marked “seen”.'}</p>
        </fieldset>
        <SourcePicker d={d} />
        {!binary && d.raw.trim() && <NamesPanel d={d} open />}
      </section>
      {busy ? <p className="fn-busy" role="status" data-testid="import-busy">{busy}</p> : binary ? (
        <section className="card fn-actions">
          {!filesOn ? <p className="micro warn" data-testid="files-off">Sending PDFs and images to Claude is off for this project, because names in them cannot be replaced first. Turn it on in <button className="linkbtn" onClick={() => setNav('settings')}>Project settings</button>, or paste the text instead.</p>
            : !claude.ready ? <p className="micro warn">{claude.why}</p>
              : <button className="primary" onClick={() => setAsk(true)} data-testid="read-claude">Read and split with Claude</button>}
          <details className="plain"><summary>Keep it for reference only, without notes</summary>
            <Field label="What is in it"><textarea rows={2} value={about} placeholder="A sentence or two, so you can find it later" data-testid="import-about" onChange={(e) => setAbout(e.target.value)} /></Field>
            <button disabled={!about.trim()} onClick={keepOnly} data-testid="keep-reference">Add to the archive</button>
          </details>
        </section>
      ) : (
        <section className="card fn-actions">
          <div className="btnrow">
            <button className={claude.ready ? '' : 'primary'} disabled={!d.raw.trim()} onClick={onPhone} data-testid="split-phone">Split on this {onDevice ? 'phone' : 'device'}</button>
            {claude.ready && <button className="primary" disabled={!d.raw.trim()} onClick={() => setAsk(true)} data-testid="split-claude">Split with Claude</button>}
          </div>
          <p className="micro">{claude.ready ? `On this ${onDevice ? 'phone' : 'device'}: by bullets, speakers and sentences; nothing leaves it. With Claude: by meaning, with better places on the map.` : claude.why}</p>
        </section>
      )}
      {ask && <ClaudeConsent onClose={() => setAsk(false)} onSend={withClaude} what={binary
        ? <p><b>{d.file?.name}</b> will be sent as it is. Names in it cannot be replaced first; you can replace them in the text Claude sends back.</p>
        : <><p>{d.raw.length.toLocaleString()} characters of {d.docType === 'document' ? 'the document' : 'your notes'} will be sent{d.names.some((n) => !n.on || n.with.trim()) ? ', with the names you replaced' : ''}.</p>
          {unreplaced().length > 0 && <p className="micro warn" data-testid="names-left">Still in the text: {unreplaced().map((f) => f.name).join(', ')}. Replace them first if they are people.</p>}</>} />}
    </div>
  );
}

// ---- review: the proposed notes, marked in the text ----------------------------------------------------
function DocView({ d, onTapGap }: { d: ImportDraft; onTapGap: (offset: number) => void }) {
  const located = d.proposals.filter((p) => p.start >= 0).sort((a, b) => a.start - b.start);
  const model = useStore((s) => s.model)!;
  const parts: React.ReactNode[] = [];
  let pos = 0;
  const gap = (a: number, b: number) => parts.push(<span key={`g${a}`} className="fn-gap" data-from={a} onClick={(e) => {
    const r = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(e.clientX, e.clientY);
    onTapGap(a + (r && r.startContainer.parentElement === e.currentTarget ? r.startOffset : 0));
  }}>{d.text.slice(a, b)}</span>);
  for (const p of located) {
    const s = Math.max(p.start, pos);
    if (s > pos) gap(pos, s);
    if (p.end > s) {
      const look = lookReasons(p).length > 0, dim = d.filter === 'look' && !look;
      parts.push(
        <mark key={p.key} className={`fn-span k-${p.kind}${p.include ? '' : ' out'}${look ? ' look' : ''}${dim ? ' dim' : ''}${d.selected === p.key ? ' sel' : ''}`} data-key={p.key} data-testid="fn-span"
          role="button" tabIndex={0} onClick={() => editImport({ selected: p.key })} onKeyDown={(e) => { if (e.key === 'Enter') editImport({ selected: p.key }); }}>
          {d.text.slice(s, p.end)}
          <span className="fn-place">{!p.include ? (p.duplicateOf ? 'already saved' : 'left out') : p.notOnMap ? '＋ not on map' : p.targetId ? `→ ${targetLabel(model, p.targetId) ?? p.targetId}` : 'not placed'}</span>
        </mark>,
      );
    }
    pos = Math.max(pos, p.end);
  }
  if (pos < d.text.length) gap(pos, d.text.length);
  return <div className="fn-doc" data-testid="fn-doc">{parts}</div>;
}

const CERTS: [Proposal['certainty'], string][] = [['observed', CERTAINTY_LABEL.observed], ['reported', CERTAINTY_LABEL.reported], ['documented', CERTAINTY_LABEL.documented], ['inferred', CERTAINTY_LABEL.inferred], [null, 'Not sure']];

function ProposalEditor({ d, p }: { d: ImportDraft; p: Proposal }) {
  const model = useStore((s) => s.model)!, sources = useStore((s) => s.evidence.sources);
  const ref = useRef<HTMLTextAreaElement>(null);
  const order = d.proposals.filter((x) => x.start >= 0).sort((a, b) => a.start - b.start).concat(d.proposals.filter((x) => x.start < 0));
  const i = order.findIndex((x) => x.key === p.key);
  const set = (patch: Partial<Proposal>) => editImport((x) => ({ proposals: x.proposals.map((y) => (y.key === p.key ? { ...y, ...patch } : y)) }));
  const go = (dir: 1 | -1, onlyLook = false) => { for (let k = i + dir; k >= 0 && k < order.length; k += dir) if (!onlyLook || lookReasons(order[k]).length) return editImport({ selected: order[k].key }); editImport({ selected: null }); };
  const join = (other?: Proposal) => { if (!other) return; const m = merge(d.text, p, other); editImport((x) => ({ proposals: [...x.proposals.filter((y) => y.key !== p.key && y.key !== other.key), m], selected: m.key })); };
  const cut = () => { const at = ref.current?.selectionStart ?? 0; const r = splitAt(d.text, p, at, model); if (!r) return toast('Put the cursor where the note should be cut. A note you have edited cannot be cut.'); editImport((x) => ({ proposals: [...x.proposals.filter((y) => y.key !== p.key), ...r], selected: r[0].key })); };
  const reasons = lookReasons(p);
  // The passage goes to the top of the screen, clear of this sheet (which covers the lower part on a phone).
  useEffect(() => { document.querySelector(`[data-key="${p.key}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [p.key]);
  // Escape, and the Android Back button (which sends Escape), close the editor and stay on the review.
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !getState().modal) editImport({ selected: null }); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
  return (
    <div className="fn-sheet" role="dialog" aria-label="Proposed note" data-testid="fn-editor" data-back-closes="">
      <div className="fn-sheet-head">
        <b>Note {i + 1} of {order.length}</b>
        <span className="spacer" />
        <button className="iconbtn" aria-label="Previous note" onClick={() => go(-1)}>‹</button><button className="iconbtn" aria-label="Next note" onClick={() => go(1)}>›</button>
        <button className="iconbtn" aria-label="Close" onClick={() => editImport({ selected: null })}>✕</button>
      </div>
      {reasons.length > 0 && <ul className="fn-reasons">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {p.duplicateOf && <p className="micro warn">A note with these words is already saved in this project.</p>}
      <textarea ref={ref} rows={3} value={p.text} aria-label="Note text" data-testid="fn-text" onChange={(e) => set({ text: e.target.value })} />
      {p.readable && <div className="btnrow fn-readable"><span className="micro">Claude's rewording: “{p.readable}”</span>{p.text === p.readable ? <button className="linkbtn" onClick={() => set({ text: p.excerpt })}>Use your words</button> : <button className="linkbtn" onClick={() => set({ text: p.readable })}>Use the rewording</button>}</div>}
      <div className="fn-row"><span className="fn-label">Kind</span><div className="seg">{IMPORT_KINDS.map((k) => <button key={k} className={p.kind === k ? 'on' : ''} aria-pressed={p.kind === k} onClick={() => set({ kind: k, ...(k === 'hypothesis' ? { certainty: 'inferred' } : {}) })} data-kind={k}>{IMPORT_KIND_LABEL[k]}</button>)}</div></div>
      <div className="fn-row"><span className="fn-label">How you know</span><div className="seg">{CERTS.map(([c, label]) => <button key={label} className={p.certainty === c ? 'on' : ''} aria-pressed={p.certainty === c} onClick={() => set({ certainty: c })} data-cert={c ?? 'none'}>{label}</button>)}</div></div>
      <div className="fn-row"><span className="fn-label">On the map</span>
        <select value={p.notOnMap ? '__new' : p.targetId ?? ''} aria-label="Place on the map" data-testid="fn-place" onChange={(e) => set(e.target.value === '__new' ? { targetId: null, notOnMap: p.notOnMap || 'Not on the map yet', confidence: 'high' } : { targetId: e.target.value || null, notOnMap: '', confidence: 'high' })}>
          <option value="">Not placed (inbox)</option>
          <optgroup label="Boxes">{model.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</optgroup>
          <optgroup label="Connections">{model.edges.map((e) => <option key={e.id} value={e.id}>{e.label} ({model.nodes.find((n) => n.id === e.from)?.label} → {model.nodes.find((n) => n.id === e.to)?.label})</option>)}</optgroup>
          <option value="__new">Something not on the map</option>
        </select></div>
      {p.notOnMap && <input value={p.notOnMap} aria-label="What is missing from the map" placeholder="What is missing, e.g. a call to the applicant" onChange={(e) => set({ notOnMap: e.target.value })} />}
      {(d.mode === 'several' || p.sourceId) && <div className="fn-row"><span className="fn-label">From</span>
        <select value={p.sourceId ?? ''} aria-label="Source of this note" onChange={(e) => set({ sourceId: e.target.value || null })}><option value="">{p.speaker ? `As labelled: ${p.speaker}` : 'As for the whole text'}</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.anonId}</option>)}</select></div>}
      {p.why && <p className="micro">Why: {p.why}</p>}
      <div className="btnrow fn-sheet-actions">
        <button onClick={() => set({ include: !p.include })} data-testid="fn-include">{p.include ? 'Leave out' : 'Include'}</button>
        <button onClick={() => join(order[i - 1])} disabled={i <= 0}>Join with previous</button>
        <button onClick={() => join(order[i + 1])} disabled={i >= order.length - 1}>Join with next</button>
        <button onClick={cut}>Cut at cursor</button>
        <span className="spacer" />
        <button className="primary" onClick={() => go(1, d.filter === 'look')} data-testid="fn-next">{d.filter === 'look' ? 'Next to check' : 'Next'}</button>
      </div>
    </div>
  );
}

function ImportReview({ d }: { d: ImportDraft }) {
  const model = useStore((s) => s.model)!, sources = useStore((s) => s.evidence.sources);
  const [saving, setSaving] = useState(false);
  const included = d.proposals.filter((p) => p.include), toCheck = included.filter((p) => lookReasons(p).length);
  const placed = included.filter((p) => p.targetId).length, missing = d.proposals.filter((p) => p.start < 0);
  const speakers = [...new Set(d.proposals.map((p) => p.speaker).filter(Boolean))];
  const selected = d.proposals.find((p) => p.key === d.selected);
  const save = async () => {
    setSaving(true);
    try {
      const r = await saveImport();
      if (r) toast(`Saved ${r.notes.length} note${r.notes.length === 1 ? '' : 's'}: ${r.notes.filter((n) => n.targetId).length} on the map, ${r.notes.filter((n) => !n.targetId).length} in the inbox`);
    } catch (e) { fail(e); } finally { setSaving(false); }
  };
  const back = () => { if (confirm('Go back to the text? The proposed notes and your changes to them are dropped.')) editImport({ step: 'input', proposals: [], selected: null }); };
  return (
    <div className="page import-page review" data-testid="import-review">
      <header className="fn-bar">
        <button className="linkbtn" onClick={back} data-testid="review-back">‹ Text</button>
        <span className="fn-count" data-testid="review-count"><b>{included.length}</b> note{included.length === 1 ? '' : 's'} · {placed} placed</span>
        {toCheck.length > 0 && <button className={`fn-check${d.filter === 'look' ? ' on' : ''}`} aria-pressed={d.filter === 'look'} onClick={() => editImport(d.filter === 'look' ? { filter: 'all' } : { filter: 'look', selected: toCheck[0]?.key ?? null })} data-testid="filter-look">{toCheck.length} to check</button>}
        <button className="primary" disabled={saving || (!included.length && !d.file)} onClick={save} data-testid="review-save">{saving ? 'Saving…' : `Save ${included.length}`}</button>
      </header>
      <p className="micro fn-hint">{d.method === 'claude' ? 'Split by Claude. ' : d.method === 'fixture' ? 'Split by the test splitter (no AI). ' : 'Split on this device. '}Tap a marked passage to check it, or unmarked text to make a note of it. Colours: <span className="fn-key k-observation">observation</span> <span className="fn-key k-measurement">measurement</span> <span className="fn-key k-question">question</span> <span className="fn-key k-hypothesis">interpretation</span></p>
      <NamesPanel d={d} open={d.method !== 'phone' && findNames(d.text, model).length > 0} />
      {d.mode === 'several' && speakers.length > 0 && (
        <details className="fn-names" open><summary>Speakers <em>{speakers.length}</em></summary>
          <ul className="fn-name-list">{speakers.map((sp) => (
            <li key={sp}><b>{sp}</b><select value={d.speakers[sp] ?? `new:${sp}`} aria-label={`Source for ${sp}`} onChange={(e) => editImport((x) => ({ speakers: { ...x.speakers, [sp]: e.target.value || null } }))}>
              <option value={`new:${sp}`}>New source: {sp}</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.anonId}</option>)}<option value="">No source</option></select></li>
          ))}</ul>
        </details>
      )}
      <DocView d={d} onTapGap={(at) => { const p = proposalAt(d.text, at, d.proposals, model, d.docType); if (p) editImport((x) => ({ proposals: [...x.proposals, p], selected: p.key })); }} />
      {missing.length > 0 && <section className="fn-missing"><h4>Not found word for word in the text</h4>{missing.map((p) => <button key={p.key} className="rowbtn" onClick={() => editImport({ selected: p.key })}><span>{p.text}</span></button>)}</section>}
      {!d.proposals.length && <p className="micro">No notes were found. Tap a sentence to make one, or go back and add text.</p>}
      {selected && <ProposalEditor d={d} p={selected} />}
    </div>
  );
}

/** Project setting: Claude key on the phone, and whether PDFs and images may be sent to Claude. */
export function ClaudeSettings() {
  const project = useStore((s) => s.project)!, provider = useStore((s) => s.provider);
  const [key, setKey] = useState(claudeKey()), [saved, setSaved] = useState(!!claudeKey());
  const on = project.meta.aiFiles === 'on';
  const toggle = async () => {
    try { await patch(`/projects/${project.id}`, { aiFiles: on ? 'off' : 'on' }); await reloadProjectMeta(); toast(on ? 'PDFs and images will not be sent to Claude' : 'PDFs and images can be sent to Claude when you choose'); } catch (e) { fail(e); }
  };
  const status = onlineClaude(provider);
  return (
    <section className="card" data-testid="claude-settings">
      <h3>Claude for the archive</h3>
      <p className="micro">Claude can split notes by meaning and read PDFs and pictures. It is only used when you press a Claude button, and you see what is sent first.</p>
      {onDevice ? (<>
        <Field label="Your Claude API key" hint="Saved on this phone only. Get one at console.anthropic.com."><input type="password" value={key} autoComplete="off" placeholder="sk-ant-…" data-testid="claude-key" onChange={(e) => { setKey(e.target.value); setSaved(false); }} /></Field>
        <div className="btnrow"><button className="primary" disabled={saved} onClick={() => { setClaudeKey(key); setSaved(true); toast(key.trim() ? 'Key saved on this phone' : 'Key removed'); }} data-testid="claude-key-save">Save key</button>
          {saved && key && <button className="linkbtn danger" onClick={() => { setClaudeKey(''); setKey(''); setSaved(false); toast('Key removed'); }}>Remove key</button>}</div>
      </>) : <p className="micro">{status.ready ? 'Claude is set up on this server.' : status.why}</p>}
      <label className="check" data-testid="ai-files"><input type="checkbox" checked={on} disabled={!canEdit()} onChange={toggle} /> Allow sending PDFs and images to Claude for this project</label>
      <p className="micro">{on ? 'On: names in a file cannot be replaced before Claude reads it. Replace them in the text it returns before saving.' : 'Off: PDFs and images can still be added for reference, or paste their text.'}</p>
    </section>
  );
}
