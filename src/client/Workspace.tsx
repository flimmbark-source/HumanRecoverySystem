import { useEffect, useState } from 'react';
import { canEdit, closeModal, discardRecovered, fail, flush, getState, loadBranch, loadProject, openModal, resolveKeepMine, resolveUseTheirs, restoreRecovered, saveNow, setMode, setNav, setState, signOut, startInsight, useStore, type Mode, type Nav } from './store';
import { addEdge, addNode } from './ops';
import { Graph } from './Graph';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { LinkModal, NoteModal, SessionModal } from './Capture';
import { NotesBoard } from './Board';
import { InsightBar, InsightButton, Insights, SpotlightBanner } from './Insights';
import { Decide } from './Decide';
import { CandidateImportModal, Research, RunModal } from './Research';
import { Report } from './Report';
import { Settings } from './Settings';
import { Field, Modal, onDevice, saveFile } from './ui';
import { EDGE_TYPES, EDGE_TYPE_LABEL, NODE_KINDS, NODE_KIND_LABEL, type EdgeType, type NodeKind } from '../shared/model';

const NAVS: [Nav, string, string][] = [['map', 'Map', '◎'], ['notes', 'Notes', '✎'], ['insights', 'Insights', '✦'], ['decide', 'Decide', '⚖'], ['research', 'Research', '⌕'], ['report', 'Brief', '▤'], ['settings', 'Project', '⚙']];
const MODES: [Mode, string][] = [['structure', 'Structure'], ['timeline', 'Timeline'], ['scenario', 'Scenario']];

function NodeModal() {
  const [kind, setKind] = useState<NodeKind>('person'), [label, setLabel] = useState(''), [scope, setScope] = useState<'internal' | 'external' | 'context'>('internal');
  return (
    <Modal title="Add a node" onClose={closeModal} footer={<><button onClick={() => { setState({ placing: kind, modal: null }); }}>Place by clicking the map</button><button className="primary" data-testid="node-add" onClick={() => { addNode(kind, undefined, label, scope); closeModal(); }}>Add to map</button></>}>
      <Field label="Type"><select value={kind} onChange={(e) => setKind(e.target.value as NodeKind)} data-testid="node-kind">{NODE_KINDS.map((k) => <option key={k} value={k}>{NODE_KIND_LABEL[k]}</option>)}</select></Field>
      <Field label="Name"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Coordinator" data-autofocus data-testid="node-name" onKeyDown={(e) => { if (e.key === 'Enter') { addNode(kind, undefined, label, scope); closeModal(); } }} /></Field>
      <Field label="Scope"><select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} data-testid="node-new-scope"><option value="internal">Within the reviewed scope</option><option value="external">External, with a direct interface</option><option value="context">Context only</option></select></Field>
    </Modal>
  );
}
function ConnectModal() {
  const model = useStore((s) => s.model)!, selection = useStore((s) => s.selection);
  const [from, setFrom] = useState(selection?.type === 'node' ? selection.id : model.nodes[0]?.id ?? ''), [to, setTo] = useState(''), [type, setType] = useState<EdgeType>('flow'), [label, setLabel] = useState('');
  const ok = from && to && from !== to;
  const add = () => { if (ok && addEdge(from, to, type, label)) closeModal(); };
  return (
    <Modal title="Add a connection" onClose={closeModal} footer={<button className="primary" disabled={!ok} onClick={add} data-testid="connect-add">Connect</button>}>
      <p className="micro">The same as dragging from a node’s port, without the mouse. Who performs the work is chosen afterwards, in Edit.</p>
      <div className="row2">
        <Field label="From"><select value={from} onChange={(e) => setFrom(e.target.value)} data-testid="connect-from">{model.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select></Field>
        <Field label="To"><select value={to} onChange={(e) => setTo(e.target.value)} data-testid="connect-to"><option value="">Choose…</option>{model.nodes.filter((n) => n.id !== from).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select></Field>
      </div>
      <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value as EdgeType)} data-testid="connect-type">{EDGE_TYPES.map((t) => <option key={t} value={t}>{EDGE_TYPE_LABEL[t]}</option>)}</select></Field>
      <Field label="Short label"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Triage application" data-testid="connect-label" onKeyDown={(e) => e.key === 'Enter' && add()} /></Field>
    </Modal>
  );
}

function SaveStatus() {
  const save = useStore((s) => s.save), error = useStore((s) => s.saveError), role = useStore((s) => s.role);
  if (role === 'reader') return <span className="savestate" data-testid="save-status" data-state="readonly">Read only</span>;
  const label = { saved: 'Saved', dirty: 'Unsaved changes…', saving: 'Saving…', failed: 'Not saved', conflict: 'Conflict' }[save];
  return (<span className={`savestate ${save}`} data-testid="save-status" data-state={save} role="status" title={error}>{label}{save === 'failed' && <button className="linkbtn" onClick={() => void saveNow()} data-testid="save-retry">Retry</button>}</span>);
}

function Banners() {
  const save = useStore((s) => s.save), error = useStore((s) => s.saveError), conflict = useStore((s) => s.conflict), recovered = useStore((s) => s.recovered), model = useStore((s) => s.model);
  const download = () => void saveFile(new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' }), 'weave-local-draft.json');
  return (<>
    {recovered && (<div className="banner warn" role="alert" data-testid="recovered-banner"><span><b>Unsaved draft found.</b> Changes from {new Date(recovered.at).toLocaleString()} were kept in this browser but never reached the server.</span><span><button className="primary" onClick={restoreRecovered} data-testid="recover-restore">Restore draft</button><button onClick={discardRecovered} data-testid="recover-discard">Discard</button></span></div>)}
    {save === 'failed' && (<div className="banner bad" role="alert" data-testid="save-failed-banner"><span><b>Your last change is not saved yet.</b> {error} It is kept in this browser and will be retried.</span><span><button className="primary" onClick={() => void saveNow()}>Retry now</button><button onClick={download}>Download draft</button></span></div>)}
    {save === 'conflict' && conflict && (<div className="banner bad" role="alert" data-testid="conflict-banner"><span><b>Someone else saved this map while you were editing.</b> {conflict.revision.author} saved revision {conflict.revision.seq} (“{conflict.revision.summary || 'edit'}”). Your draft is intact; nothing was overwritten.</span>
      <span><button className="primary" onClick={resolveKeepMine} data-testid="conflict-keep">Keep my version (theirs stays in history)</button><button onClick={resolveUseTheirs} data-testid="conflict-theirs">Use their version</button><button onClick={download}>Download my draft</button></span></div>)}
  </>);
}

export function Workspace({ pid }: { pid: string }) {
  const project = useStore((s) => s.project), loading = useStore((s) => s.loading), loadError = useStore((s) => s.loadError), nav = useStore((s) => s.nav), mode = useStore((s) => s.mode);
  const branches = useStore((s) => s.branches), branchId = useStore((s) => s.branchId), modal = useStore((s) => s.modal), session = useStore((s) => s.session), selection = useStore((s) => s.selection), model = useStore((s) => s.model);
  const counts = useStore((s) => s.evidence), pending = useStore((s) => s.research?.candidates.filter((c) => c.status === 'pending').length ?? 0);
  const [addOpen, setAddOpen] = useState(false), capturing = useStore((s) => !!s.insightDraft);
  useEffect(() => { void loadProject(pid); }, [pid]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { const s = getState().save; if (s === 'dirty' || s === 'saving' || s === 'failed') { e.preventDefault(); } };
    const key = (e: KeyboardEvent) => { const tag = (e.target as HTMLElement)?.tagName; if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.ctrlKey || e.metaKey || e.altKey) return; if (e.key.toLowerCase() === 'n' && canEdit()) { e.preventDefault(); openModal('note'); } };
    window.addEventListener('beforeunload', before); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('beforeunload', before); window.removeEventListener('keydown', key); };
  }, []);
  if (loadError) return <main className="auth"><div className="authcard"><h1>This project could not be opened</h1><p className="alert bad" data-testid="load-error">{loadError}</p><a className="btn" href="#/">Back to projects</a></div></main>;
  if (loading || !project || !model) return <main className="auth"><p className="micro">Opening project…</p></main>;
  const branch = branches.find((b) => b.id === branchId);
  const badge: Partial<Record<Nav, number>> = { notes: counts.notes.length, insights: counts.insights.length, decide: counts.opportunities.length, research: pending };
  return (
    <div className={`app nav-${nav}`} data-testid="workspace">
      <nav className="left" aria-label="Sections">
        <a className="brand" href="#/" aria-label="All projects" onClick={() => void flush()}><div className="brandmark">w</div><div className="brandtext"><div className="brandname">weave</div><div className="kicker">Operational Studio</div></div></a>
        <div className="workspace-card"><span className="kicker">Workflow</span><b title={project.name}>{project.name}</b>{project.isSynthetic && <span className="chip warnchip">synthetic data</span>}</div>
        <ul className="navlist">{NAVS.map(([k, label, icon]) => (<li key={k}><button className={`navbtn${nav === k ? ' active' : ''}`} aria-current={nav === k ? 'page' : undefined} onClick={() => setNav(k)} data-testid={`nav-${k}`}><span className="navicon" aria-hidden="true">{icon}</span><span className="navlabel">{label}</span>{badge[k] ? <span className="count">{badge[k]}</span> : null}</button></li>))}</ul>
        <div className="left-bottom"><a className="linkbtn" href="#/" onClick={() => void flush()}>All projects</a>{!onDevice && <button className="linkbtn" onClick={signOut}>Sign out</button>}</div>
      </nav>
      <div className="center">
        <header className="topbar">
          <select className="branch-select" value={branchId} aria-label="Baseline or scenario" data-testid="branch-select" onChange={(e) => loadBranch(e.target.value).catch(fail)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.kind === 'baseline' ? 'Baseline' : `Scenario: ${b.name}`}</option>)}
          </select>
          {nav === 'map' && (<div className="modegroup" role="tablist" aria-label="Map mode">{MODES.map(([k, label]) => <button key={k} role="tab" aria-selected={mode === k} className={`mode${mode === k ? ' active' : ''}`} onClick={() => setMode(k)} data-testid={`mode-${k}`}>{label}</button>)}</div>)}
          <span className="spacer" />
          <SaveStatus />
          {canEdit() && <button className="sessionbar" onClick={() => openModal('session')} data-testid="session-button" title="Fieldwork session">{session ? `◎ ${session.label}` : '◎ Start session'}</button>}
          {canEdit() && (<div className="addwrap">
            <button className="primary" aria-haspopup="menu" aria-expanded={addOpen} onClick={() => setAddOpen(!addOpen)} data-testid="add-menu">+ Add</button>
            {addOpen && (<div className="addpop" role="menu" onClick={() => setAddOpen(false)}>
              <button role="menuitem" onClick={() => openModal('note')} data-testid="add-note">Note{selection ? ' on selection' : ''} <kbd>N</kbd></button>
              <button role="menuitem" onClick={() => { setNav('map'); openModal('node'); }} data-testid="add-node">Node…</button>
              <button role="menuitem" onClick={() => { setNav('map'); openModal('connect'); }} data-testid="add-connection">Connection…</button>
              <button role="menuitem" onClick={startInsight}>Insight</button>
              <button role="menuitem" onClick={() => { setNav('research'); openModal('candidates'); }}>Review agent findings…</button>
            </div>)}
          </div>)}
        </header>
        <Banners />
        {nav === 'map' && <SpotlightBanner />}
        {branch?.kind === 'scenario' && nav === 'map' && <div className="banner info" data-testid="scenario-banner"><span>Editing scenario <b>{branch.name}</b>. The baseline and its evidence are not affected.</span><button className="linkbtn" onClick={() => loadBranch('baseline').catch(fail)}>Back to baseline</button></div>}
        <main className="main" id="main">
          {nav === 'map' ? (<div className="mapview"><Graph />{mode === 'timeline' && <Timeline />}
            <div className={`map-tools${capturing ? ' capturing' : ''}`}>{canEdit() && <button className="primary narrow-only" onClick={() => openModal('note')} data-testid="fab-note">+ Note</button>}<button className="narrow-only" onClick={() => setState({ inspectorOpen: true })} data-testid="open-details">{selection ? 'Details' : mode === 'scenario' ? 'Scenario' : 'Overview'}</button>{canEdit() && <InsightButton />}</div>
            {capturing && <InsightBar />}
          </div>) : nav === 'notes' ? <NotesBoard /> : nav === 'insights' ? <Insights /> : nav === 'decide' ? <Decide /> : nav === 'research' ? <Research /> : nav === 'report' ? <Report /> : <Settings />}
        </main>
      </div>
      {nav === 'map' && <Inspector />}
      {nav === 'map' && <div className="scrim" onClick={() => setState({ inspectorOpen: false })} />}
      {modal?.kind === 'note' && <NoteModal data={modal.data} />}
      {modal?.kind === 'session' && <SessionModal />}
      {modal?.kind === 'link' && <LinkModal data={modal.data} />}
      {modal?.kind === 'node' && <NodeModal />}
      {modal?.kind === 'connect' && <ConnectModal />}
      {modal?.kind === 'run' && <RunModal data={modal.data} />}
      {modal?.kind === 'deep' && <RunModal data={{ mode: 'deep', insightId: modal.data?.insightId }} />}
      {modal?.kind === 'candidates' && <CandidateImportModal />}
    </div>
  );
}
