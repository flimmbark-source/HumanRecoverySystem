// Wide and deep research jobs, and the shared human review inbox.
import { useEffect, useState } from 'react';
import { post, patch } from './api';
import { canEdit, closeModal, createDoc, fail, openModal, refreshEvidence, refreshResearch, loadBranch, toast, useStore, type CandidateRow, type RunRow } from './store';
import { Empty, Field, Modal, Sentence, when } from './ui';
import { CANDIDATE_KIND_LABEL, type Candidate } from '../shared/candidates';
import { describe } from '../shared/sentence';
import { insightTitle } from '../shared/evidence';
import type { ActionCode } from '../shared/model';

const STATUS_LABEL: Record<string, string> = { queued: 'Queued', running: 'Running', ready_for_review: 'Ready for review', failed: 'Failed', cancelled: 'Cancelled' };

export function RunModal({ data }: { data: { mode: 'wide' | 'deep'; insightId?: string } }) {
  const pid = useStore((s) => s.project!.id), notes = useStore((s) => s.evidence.notes), insights = useStore((s) => s.evidence.insights), sources = useStore((s) => s.evidence.sources), provider = useStore((s) => s.provider);
  const [question, setQuestion] = useState(''), [topics, setTopics] = useState(''), [picked, setPicked] = useState<string[]>([]), [insightId, setInsightId] = useState(data.insightId ?? '');
  const approved = notes.filter((n) => n.excerptApproved), blocked = notes.length - approved.length;
  const submit = async () => {
    try {
      await post(`/projects/${pid}/research/runs`, data.mode === 'wide' ? { mode: 'wide', question, topics: topics.split(/[,\n]/).map((t) => t.trim()).filter(Boolean) } : { mode: 'deep', question, noteIds: picked, insightId: insightId || null });
      toast('Job queued. Results will wait in the review inbox.'); closeModal(); await refreshResearch();
    } catch (e) { fail(e); }
  };
  return (
    <Modal title={data.mode === 'wide' ? 'Wide research: public patterns and existing solutions' : 'Deep research: approved notes against the map'} onClose={closeModal} wide footer={<button className="primary" onClick={submit} disabled={question.trim().length < 5} data-testid="run-submit">Queue job</button>}>
      {provider?.synthetic && <p className="alert warn">{provider.label}</p>}
      <Field label="Question"><textarea rows={3} value={question} data-testid="run-question" onChange={(e) => setQuestion(e.target.value)} placeholder={data.mode === 'wide' ? 'How do comparable programmes handle…?' : 'What would explain…? What would show we are wrong?'} /></Field>
      {data.mode === 'wide' ? (<>
        <Field label="Approved public topics" hint="Comma separated. Only the question, the workflow scope and these topics are sent. No notes, sources or participant data."><input value={topics} onChange={(e) => setTopics(e.target.value)} /></Field>
        <p className="micro">Public findings can shape what to ask next. Claims about this organization still need internal evidence.</p>
      </>) : (<>
        <Field label="Insight to explore (optional)"><select value={insightId} onChange={(e) => setInsightId(e.target.value)}><option value="">None</option>{insights.map((i) => <option key={i.id} value={i.id}>{insightTitle(i)}</option>)}</select></Field>
        <fieldset className="picklist" data-testid="run-notes"><legend>Approved excerpts to send ({picked.length} selected)</legend>
          {approved.map((n) => <label key={n.id} className="check"><input type="checkbox" checked={picked.includes(n.id)} data-note-pick={n.id} onChange={(e) => setPicked(e.target.checked ? [...picked, n.id] : picked.filter((x) => x !== n.id))} /> <span><b>{sources.find((s) => s.id === n.sourceId)?.anonId ?? 'No source'}</b> · {n.text.slice(0, 140)}</span></label>)}
          {!approved.length && <p className="micro">No note is approved yet. Open a note, tick “Approved, de-identified excerpt”, and it will appear here.</p>}
        </fieldset>
        <p className="micro">{blocked} other note{blocked === 1 ? ' is' : 's are'} not approved and cannot be sent. The job also receives the structure of the current baseline map (labels and links, no notes).</p>
      </>)}
    </Modal>
  );
}

export function CandidateImportModal() {
  const pid = useStore((s) => s.project!.id);
  const [text, setText] = useState(''), [error, setError] = useState<{ path: string; message: string }[] | string | null>(null);
  const run = async () => {
    setError(null);
    let bundle: unknown;
    try { bundle = JSON.parse(text); } catch { setError('This is not valid JSON.'); return; }
    try { const r = await post(`/projects/${pid}/candidates/import`, { bundle }); toast(`${r.imported} candidate${r.imported === 1 ? '' : 's'} added to the review inbox`); closeModal(); await refreshResearch(); }
    catch (e: any) { setError(e.body?.issues?.length ? e.body.issues : e.message); }
  };
  return (
    <Modal title="Import agent findings for review" onClose={closeModal} wide footer={<button className="primary" onClick={run} disabled={!text.trim()} data-testid="cand-import-run">Validate and import</button>}>
      <p className="micro">Paste or load a candidate file produced with the Weave research skill (format <code>weave-research-candidates</code>, version 1 or 2). Nothing changes the map until you accept a candidate.</p>
      <input type="file" accept="application/json,.json" aria-label="Candidate JSON file" data-testid="cand-file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
      <Field label="Candidate JSON"><textarea rows={10} value={text} data-testid="cand-json" onChange={(e) => setText(e.target.value)} spellCheck={false} /></Field>
      {error && <div className="alert bad" data-testid="cand-import-error"><b>Nothing was imported.</b>{typeof error === 'string' ? <p>{error}</p> : <ul>{error.slice(0, 12).map((i, k) => <li key={k}><code>{i.path}</code> {i.message}</li>)}</ul>}</div>}
    </Modal>
  );
}

function Preview({ c }: { c: Candidate }) {
  const model = useStore((s) => s.model)!;
  const label = (id?: string) => (id ? model.nodes.find((n) => n.id === id)?.label ?? model.edges.find((e) => e.id === id)?.label ?? model.activities.find((a) => a.id === id)?.label ?? `${id} (not on this map)` : null);
  if (c.kind === 'relationship') {
    const d = describe({ edge: { from: c.fromId, to: c.toId, type: c.connectionType, label: c.label, workItem: c.workItem ?? '', result: c.result ?? '', inputState: c.inputState ?? '', outputState: c.outputState ?? '', description: '' }, performerId: c.performerId ?? null, actionCode: (c.actionCode as ActionCode | undefined) ?? null, nodes: model.nodes });
    return <div className="cand-diff"><b>Adds connection “{c.label}”</b> ({c.connectionType}) {label(c.fromId)} → {label(c.toId)}<p data-testid="cand-sentence"><Sentence segments={d.segments} /></p>{d.unknowns.length > 0 && <p className="micro warn">Left unknown: {d.unknowns.join('; ')}</p>}</div>;
  }
  if (c.kind === 'node') return <div className="cand-diff"><b>Adds {c.nodeType} “{c.label}”</b></div>;
  if (c.kind === 'activity') return <div className="cand-diff"><b>Adds internal activity “{c.label}”</b> at {label(c.ownerId)} · {c.minutes === null ? 'duration unknown' : `${c.minutes} min (${c.measurementBasis})`}</div>;
  if (c.kind === 'note') return <div className="cand-diff"><b>Adds {c.noteType}</b>{c.targetId ? <> on {label(c.targetId)}</> : ' to the inbox'}<p>{c.text}</p></div>;
  if (c.kind === 'contradiction') return <div className="cand-diff"><b>Sources disagree</b>{c.targetId && <> about {label(c.targetId)}</>}<p>{c.text}</p><ul>{c.accounts.map((a, i) => <li key={i}><b>{a.sourceId}:</b> {a.claim}</li>)}</ul></div>;
  if (c.kind === 'measurement_target') return <div className="cand-diff"><b>Measurement gap</b>{c.targetId && <> on {label(c.targetId)}</>}<p>{c.text}</p><p className="micro">Metric: {c.metric}{c.method ? ` · ${c.method}` : ''}</p></div>;
  return <div className="cand-diff"><b>{c.recommendation === 'close' ? 'Recommends closing this line of inquiry' : c.recommendation === 'test_existing' ? 'Recommends testing an existing solution' : 'Recommends investigating'}</b>{c.optionLabel && <>: {c.optionLabel}</>}<p>{c.reason}</p><p className="micro"><b>Coverage:</b> {c.coverage}</p>{c.fitGaps && <p className="micro"><b>Fit gaps:</b> {c.fitGaps}</p>}{c.uncertainty && <p className="micro"><b>Uncertainty:</b> {c.uncertainty}</p>}</div>;
}

function CandidateCard({ c }: { c: CandidateRow }) {
  const pid = useStore((s) => s.project!.id), runs = useStore((s) => s.research?.runs ?? []);
  const [editing, setEditing] = useState(false), [json, setJson] = useState(''), [note, setNote] = useState(c.reviewNote), [busy, setBusy] = useState(false);
  const p = c.payload, run = runs.find((r) => r.id === c.runId);
  const act = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); toast(msg); await Promise.all([refreshResearch(), refreshEvidence()]); } catch (e) { fail(e); await refreshResearch().catch(() => {}); } finally { setBusy(false); } };
  const accept = () => act(async () => { const r = await post(`/projects/${pid}/candidates/${c.id}/accept`); if (['node', 'edge', 'activity'].includes(r.applied?.kind)) await loadBranch('baseline'); if (r.alreadyAccepted) toast('Already accepted; nothing changed'); }, 'Accepted');
  const ro = !canEdit() || c.status === 'accepted';
  return (
    <article className={`candidate st-${c.status}`} data-candidate={c.id} data-kind={p.kind} data-status={c.status} data-testid="candidate">
      <header>
        <span className="chip">{CANDIDATE_KIND_LABEL[p.kind]}</span><b>{p.summary}</b>
        <span className={`chip st-${c.status}`} data-testid="cand-status">{c.status === 'pending' ? 'Awaiting review' : c.status === 'needs_evidence' ? 'Needs evidence' : c.status}</span>
      </header>
      <div className="cand-flags">
        {c.origin === 'fixture' && <span className="chip warnchip">Synthetic fixture output</span>}{c.origin === 'import' && <span className="chip">Imported file</span>}{c.origin === 'agent' && <span className="chip">Agent: {run?.provider}</span>}
        {c.edited && <span className="chip">Edited by reviewer</span>}
        {c.duplicateOf && <span className="chip warnchip" data-testid="cand-duplicate">Duplicate of an earlier candidate</span>}
        {c.alreadyInModel && <span className="chip warnchip">Already on the map</span>}
        {c.stale && <span className="chip warnchip" data-testid="cand-stale">Baseline changed since this was produced</span>}
        {c.refIssues.map((i) => <span key={i} className="chip bad">{i}</span>)}
      </div>
      <Preview c={p} />
      <dl className="cand-basis">
        <div><dt>Basis</dt><dd data-testid="cand-basis">“{p.basis}”</dd></div>
        <div><dt>Source</dt><dd>{p.sourceId}{'sourceUrl' in p && p.sourceUrl ? <> · <a href={p.sourceUrl} target="_blank" rel="noreferrer noopener">{p.sourceUrl}</a></> : null}{'retrievedAt' in p && p.retrievedAt ? ` · retrieved ${p.retrievedAt}` : ''}{'sourceDate' in p && p.sourceDate ? ` · dated ${p.sourceDate}` : ''}</dd></div>
        <div><dt>Certainty</dt><dd>{p.certainty}{p.certainty === 'inferred' ? ' (a hypothesis, not a measured fact)' : ''}</dd></div>
        {c.reviewer && <div><dt>Review</dt><dd>{c.status} by {c.reviewer} · {when(c.reviewedAt)}{c.reviewNote ? ` · ${c.reviewNote}` : ''}</dd></div>}
      </dl>
      {!ro && (editing ? (
        <div><Field label="Edit proposal (JSON)"><textarea rows={8} value={json} spellCheck={false} data-testid="cand-edit-json" onChange={(e) => setJson(e.target.value)} /></Field>
          <div className="btnrow"><button className="primary" data-testid="cand-edit-save" onClick={() => { let payload: unknown; try { payload = JSON.parse(json); } catch { toast('Not valid JSON', 'error'); return; } void act(() => patch(`/projects/${pid}/candidates/${c.id}`, { payload }), 'Candidate updated').then(() => setEditing(false)); }}>Save edit</button><button onClick={() => setEditing(false)}>Cancel</button></div></div>
      ) : (
        <div className="cand-actions">
          <input value={note} placeholder="Review note (optional)" aria-label="Review note" onChange={(e) => setNote(e.target.value)} />
          <button className="primary" disabled={busy || c.refIssues.length > 0 || c.alreadyInModel} onClick={accept} data-testid="cand-accept">Accept</button>
          <button disabled={busy} onClick={() => { setJson(JSON.stringify(p, null, 2)); setEditing(true); }} data-testid="cand-edit">Edit</button>
          <button disabled={busy} onClick={() => act(() => patch(`/projects/${pid}/candidates/${c.id}`, { status: 'needs_evidence', reviewNote: note }), 'Marked as needing evidence')} data-testid="cand-needs">Needs evidence</button>
          <button disabled={busy} onClick={() => act(() => patch(`/projects/${pid}/candidates/${c.id}`, { status: 'rejected', reviewNote: note }), 'Rejected')} data-testid="cand-reject">Reject</button>
          {c.status !== 'pending' && <button className="linkbtn" onClick={() => act(() => patch(`/projects/${pid}/candidates/${c.id}`, { status: 'pending' }), 'Reopened')}>Reopen</button>}
        </div>
      ))}
    </article>
  );
}

function RunCard({ r }: { r: RunRow }) {
  const pid = useStore((s) => s.project!.id);
  const res = r.result;
  const act = (path: string, msg: string) => post(`/projects/${pid}/research/runs/${r.id}/${path}`).then(() => { toast(msg); return refreshResearch(); }).catch(fail);
  return (
    <article className={`run st-${r.status}`} data-run={r.id} data-status={r.status} data-testid="run">
      <header><span className="chip">{r.mode === 'wide' ? 'Wide' : 'Deep'}</span><b>{r.question}</b><span className={`chip st-${r.status}`} data-testid="run-status">{STATUS_LABEL[r.status]}</span></header>
      <p className="micro">{when(r.createdAt)} · {r.provider} · attempt {r.attempts} of {r.maxAttempts} · against baseline revision {r.input?.revisionId}{r.mode === 'deep' ? ` · ${r.input?.noteIds?.length ?? 0} approved excerpts sent` : ''}</p>
      {r.error && <p className={`alert ${r.status === 'failed' ? 'bad' : 'warn'}`} data-testid="run-error">{r.error}</p>}
      {res && (<div className="run-result">
        {res.synthetic && <p className="alert warn" data-testid="run-synthetic">{res.providerLabel}</p>}
        <p>{res.summary}</p>
        {res.coverage && <><h4>Coverage against the observed workflow</h4><p data-testid="run-coverage">{res.coverage}</p></>}
        {res.citations?.length > 0 && <><h4>Sources</h4><ol className="citations" data-testid="run-citations">{res.citations.map((c: any, i: number) => <li key={i}><a href={c.url} target="_blank" rel="noreferrer noopener">{c.title || c.url}</a> <em>retrieved {c.retrievedAt}</em><blockquote>“{c.excerpt}”</blockquote>{c.covers && <span><b>Covers:</b> {c.covers} </span>}{c.fallsShort && <span><b>Falls short:</b> {c.fallsShort}</span>}</li>)}</ol></>}
        {res.followUpQuestions?.length > 0 && <><h4>Suggested next questions <em>(yours to edit)</em></h4><ul data-testid="run-followups">{res.followUpQuestions.map((qn: string) => <li key={qn}>{qn} {canEdit() && <button className="linkbtn" onClick={() => createDoc('notes', { kind: 'question', text: qn, category: 'Follow-up question' }).then(() => toast('Saved as a question in the inbox; edit it there')).catch(fail)}>Save as a question</button>}</li>)}</ul></>}
        {res.gapsToCheckWithParticipants?.length > 0 && <><h4>Gaps worth checking with participants</h4><ul>{res.gapsToCheckWithParticipants.map((g: string) => <li key={g}>{g}</li>)}</ul></>}
        <p className="micro">{res.candidateCount} candidate{res.candidateCount === 1 ? '' : 's'} in the review inbox.</p>
      </div>)}
      {canEdit() && <div className="btnrow">
        {(r.status === 'queued' || r.status === 'running') && <button onClick={() => act('cancel', 'Cancellation requested')} data-testid="run-cancel">Cancel</button>}
        {(r.status === 'failed' || r.status === 'cancelled') && <button onClick={() => act('retry', 'Queued again')} data-testid="run-retry">Retry</button>}
      </div>}
    </article>
  );
}

export function Research() {
  const research = useStore((s) => s.research), provider = useStore((s) => s.provider);
  const [filter, setFilter] = useState('pending');
  useEffect(() => { void refreshResearch().catch(fail); }, []);
  const active = research?.runs.some((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => { if (!active) return; const t = setInterval(() => void refreshResearch().catch(() => {}), 1500); return () => clearInterval(t); }, [active]);
  const cands = (research?.candidates ?? []).filter((c) => filter === 'all' || c.status === filter);
  const count = (s: string) => research?.candidates.filter((c) => c.status === s).length ?? 0;
  return (
    <div className="page" data-testid="research">
      <header className="page-head"><div><h1>Research and review</h1><p>Agents propose; a researcher decides. Nothing reaches the map, the notes or the register until it is accepted here.</p></div></header>
      <div className={`alert ${provider?.available ? (provider.synthetic ? 'warn' : '') : 'warn'}`} data-testid="provider-status"><b>{provider?.label}</b>{provider?.reason && <p>{provider.reason}</p>}{provider?.available && !provider.synthetic && <p>Jobs are bounded by a time budget and a search cap, and can only return proposals.</p>}</div>
      {canEdit() && <div className="btnrow">
        <button className="primary" disabled={!provider?.available} onClick={() => openModal('run', { mode: 'wide' })} data-testid="new-wide">New wide research</button>
        <button className="primary" disabled={!provider?.available} onClick={() => openModal('run', { mode: 'deep' })} data-testid="new-deep">New deep research</button>
        <button onClick={() => openModal('candidates')} data-testid="cand-import">Import agent findings</button>
      </div>}
      <h2>Review inbox</h2>
      <div className="tabs">{[['pending', 'Awaiting review'], ['needs_evidence', 'Needs evidence'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['all', 'All']].map(([k, l]) => <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)} data-testid={`inbox-${k}`}>{l}{k !== 'all' ? ` (${count(k)})` : ''}</button>)}</div>
      {!cands.length && <Empty title="Nothing here">{filter === 'pending' ? 'Run a job or import a candidate file. Imported and agent findings wait here for your decision.' : 'No candidates with this status.'}</Empty>}
      {cands.map((c) => <CandidateCard key={c.id + c.status + JSON.stringify(c.payload).length} c={c} />)}
      <h2>Jobs</h2>
      {!research?.runs.length && <Empty title="No jobs yet">Wide research scans public practice. Deep research works through approved notes against the current map.</Empty>}
      {research?.runs.map((r) => <RunCard key={r.id} r={r} />)}
    </div>
  );
}
