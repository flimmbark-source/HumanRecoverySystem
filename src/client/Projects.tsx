import { useEffect, useState } from 'react';
import { get, post } from './api';
import { issuesText, ApiError } from './api';
import { fail, signIn, signOut, toast, useStore } from './store';
import { Field, onDevice, when } from './ui';

export function Login() {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState(''), [signup, setSignup] = useState(false), [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setError(''); try { await signIn(email, password, signup ? name : undefined); } catch (err) { setError(issuesText(err)); } };
  return (
    <main className="auth">
      <form className="authcard" onSubmit={submit}>
        <div className="brand"><div className="brandmark">w</div><div><div className="brandname">weave</div><div className="kicker">Operational Studio</div></div></div>
        <h1>{signup ? 'Create an account' : 'Sign in'}</h1>
        {signup && <Field label="Your name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></Field>}
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required data-testid="login-email" /></Field>
        <Field label="Password" hint={signup ? 'At least 8 characters' : undefined}><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} minLength={8} required data-testid="login-password" /></Field>
        {error && <p className="alert bad" role="alert" data-testid="login-error">{error}</p>}
        <button className="primary" type="submit" data-testid="login-submit">{signup ? 'Create account' : 'Sign in'}</button>
        <button type="button" className="linkbtn" onClick={() => setSignup(!signup)}>{signup ? 'I already have an account' : 'Create an account'}</button>
      </form>
    </main>
  );
}

/** Import with a mandatory preview. Creates a new project unless `replace` is given (owner-only, name-confirmed, backed up). */
export function ImportPanel({ replace, onDone }: { replace?: { pid: string; name: string }; onDone: (id: string) => void }) {
  const [data, setData] = useState<unknown>(null), [preview, setPreview] = useState<any>(null), [error, setError] = useState(''), [name, setName] = useState(''), [confirmName, setConfirmName] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState<any>(null);
  const load = async (file: File) => {
    setPreview(null); setError(''); setData(null); setDone(null);
    let parsed: unknown;
    try { parsed = JSON.parse(await file.text()); } catch { setError('This file is not valid JSON, so nothing was imported.'); return; }
    try { const p = await post('/import/preview', { data: parsed }); setData(parsed); setPreview(p); setName(p.summary?.name ?? ''); } catch (e) { setError(issuesText(e)); }
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = replace ? await post(`/projects/${replace.pid}/replace`, { data, confirmName }) : await post('/import', { data, name });
      toast(replace ? 'Project replaced. A backup of the previous contents was saved.' : 'Imported into a new project'); setDone(r);
      if (!r.decisions?.length) onDone(r.id ?? replace!.pid);
    } catch (e) { setError(e instanceof ApiError && e.body.issues ? issuesText(e) : issuesText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="import" data-testid="import-panel">
      <input type="file" accept="application/json,.json" aria-label="Workspace JSON file" data-testid="import-file" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
      <p className="micro">Accepts a Weave workspace export or a v0.7 prototype export. The file is checked completely before anything is written.</p>
      {error && <p className="alert bad" data-testid="import-error">{error}</p>}
      {preview && !preview.ok && (<div className="alert bad" data-testid="import-issues"><b>This file cannot be imported. Nothing was changed.</b><ul>{preview.issues.slice(0, 20).map((i: any, k: number) => <li key={k}><code>{i.path}</code> {i.message}</li>)}</ul>{preview.issues.length > 20 && <p>…and {preview.issues.length - 20} more</p>}</div>)}
      {preview?.ok && !done && (<div className="import-preview" data-testid="import-preview">
        <b>{preview.kind === 'legacy' ? 'v0.7 prototype export' : 'Weave workspace export'}</b>
        <p data-testid="import-summary">{preview.summary.nodes} nodes · {preview.summary.connections} connections · {preview.summary.notes} notes · {preview.summary.links} note links · {preview.summary.scenarios} scenarios · {preview.summary.revisions} revisions · {preview.summary.candidates} candidates</p>
        {preview.decisions.length > 0 && <Decisions list={preview.decisions} />}
        {replace ? <Field label={`Type “${replace.name}” to replace it`}><input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} data-testid="replace-confirm" /></Field> : <Field label="Name for the new project"><input value={name} onChange={(e) => setName(e.target.value)} data-testid="import-name" /></Field>}
        <button className={replace ? 'danger' : 'primary'} disabled={busy || (replace ? confirmName !== replace.name : !name.trim())} onClick={run} data-testid="import-run">{replace ? 'Back up and replace' : 'Import as a new project'}</button>
      </div>)}
      {done && (<div className="import-preview" data-testid="import-done"><b>Imported.</b>{done.decisions?.length > 0 && <Decisions list={done.decisions} />}<button className="primary" onClick={() => onDone(done.id ?? replace!.pid)} data-testid="import-open">Open the project</button></div>)}
    </div>
  );
}
function Decisions({ list }: { list: { recordId: string; kind: string; message: string; applied: string }[] }) {
  return (<div className="alert warn" data-testid="import-decisions"><b>{list.length} record{list.length === 1 ? '' : 's'} need your attention</b><ul>{list.map((d, i) => <li key={i} data-kind={d.kind} data-record={d.recordId}>{d.message} <em>{d.applied}</em></li>)}</ul></div>);
}

export function Projects() {
  const user = useStore((s) => s.user)!;
  const [projects, setProjects] = useState<any[] | null>(null), [mode, setMode] = useState<null | 'new' | 'import'>(null);
  const [f, setF] = useState({ name: '', template: 'blank', researchQuestion: '', orgUnit: '', scopeDescription: '', startLabel: '', outcomeLabel: '', intendedOutcome: '', externalInterfaces: '' });
  const load = () => get('/projects').then((r) => setProjects(r.projects)).catch(fail);
  useEffect(() => { void load(); }, []);
  const open = (id: string) => { location.hash = `#/p/${id}`; };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try { const r = await post('/projects', { ...f, name: f.name.trim() || (f.template === 'demo' ? 'Volunteer placement (synthetic demo)' : 'Untitled workflow') }); open(r.id); } catch (err) { fail(err); }
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <main className="projects" data-testid="projects">
      <header className="projects-head">
        <div className="brand"><div className="brandmark">w</div><div><div className="brandname">weave</div><div className="kicker">Operational Studio</div></div></div>
        {!onDevice && <span>{user.name} <button className="linkbtn" onClick={signOut} data-testid="signout">Sign out</button></span>}
      </header>
      <div className="projects-body">
        <div className="page-head"><div><h1>Projects</h1><p>One focused workflow per project. Projects are private to the people you add.</p></div>
          <div className="btnrow"><button className="primary" onClick={() => setMode(mode === 'new' ? null : 'new')} data-testid="new-project">New project</button><button onClick={() => setMode(mode === 'import' ? null : 'import')} data-testid="import-project">Import…</button></div></div>
        {mode === 'new' && (
          <form className="card" onSubmit={create} data-testid="new-project-form">
            <fieldset className="choice"><legend>Start from</legend>
              <label><input type="radio" name="tpl" checked={f.template === 'blank'} onChange={() => setF({ ...f, template: 'blank' })} data-testid="tpl-blank" /> A blank map with a start and an outcome</label>
              <label><input type="radio" name="tpl" checked={f.template === 'demo'} onChange={() => setF({ ...f, template: 'demo' })} data-testid="tpl-demo" /> The synthetic demo (invented data, for learning the tool)</label>
            </fieldset>
            <Field label="Workflow name"><input value={f.name} onChange={set('name')} placeholder={f.template === 'demo' ? 'Volunteer placement (synthetic demo)' : 'e.g. Volunteer placement'} data-testid="np-name" /></Field>
            {f.template === 'blank' && (<>
              <Field label="Research question"><textarea rows={2} value={f.researchQuestion} onChange={set('researchQuestion')} /></Field>
              <div className="row2"><Field label="Organization or unit"><input value={f.orgUnit} onChange={set('orgUnit')} /></Field><Field label="Known external interfaces"><input value={f.externalInterfaces} onChange={set('externalInterfaces')} /></Field></div>
              <Field label="Scope: what is in, what is out"><textarea rows={2} value={f.scopeDescription} onChange={set('scopeDescription')} /></Field>
              <div className="row2"><Field label="Where the work starts" hint="Becomes the first node"><input value={f.startLabel} onChange={set('startLabel')} placeholder="e.g. Volunteer" data-testid="np-start" /></Field><Field label="Outcome" hint="Becomes the second node"><input value={f.outcomeLabel} onChange={set('outcomeLabel')} placeholder="e.g. Placement confirmed" data-testid="np-outcome" /></Field></div>
              <Field label="Intended outcome of the research"><input value={f.intendedOutcome} onChange={set('intendedOutcome')} /></Field>
            </>)}
            <button className="primary" type="submit" data-testid="np-create">Create project</button>
          </form>
        )}
        {mode === 'import' && <div className="card"><h3>Import into a new project</h3><ImportPanel onDone={open} /></div>}
        {projects === null ? <p className="micro">Loading…</p> : !projects.length ? <div className="empty"><b>No projects yet</b><p>Create a blank project, open the synthetic demo, or import an export.</p></div> : (
          <ul className="projectlist">{projects.map((p) => (
            <li key={p.id}><button className="projectcard" onClick={() => open(p.id)} data-project={p.name}>
              <b>{p.name}</b>{p.isSynthetic && <span className="chip warnchip">synthetic</span>}<span className="chip">{p.role}</span>
              <p>{p.meta?.researchQuestion || 'No research question yet'}</p>
              <em>{p.noteCount} notes · {p.scenarioCount} scenarios · updated {when(p.updatedAt)}</em>
            </button></li>))}</ul>
        )}
      </div>
    </main>
  );
}
