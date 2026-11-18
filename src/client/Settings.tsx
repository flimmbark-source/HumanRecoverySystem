import { useEffect, useState } from 'react';
import { del, get, patch, post } from './api';
import { canEdit, fail, flush, getState, loadBranch, loadProject, reloadProjectMeta, toast, useStore } from './store';
import { Field, onDevice, when } from './ui';
import { ImportPanel } from './Projects';

const META: [string, string, number][] = [['researchQuestion', 'Research question', 2], ['orgUnit', 'Organization or unit', 1], ['scopeDescription', 'Workflow scope', 3], ['startLabel', 'Where the workflow starts', 1], ['intendedOutcome', 'Intended outcome', 2], ['externalInterfaces', 'Known external interfaces', 2]];

export function Settings() {
  const project = useStore((s) => s.project)!, role = useStore((s) => s.role), members = useStore((s) => s.members), branchId = useStore((s) => s.branchId), branches = useStore((s) => s.branches), revision = useStore((s) => s.revision);
  const [name, setName] = useState(project.name), [meta, setMeta] = useState<Record<string, string>>(project.meta), [status, setStatus] = useState(project.status);
  const [email, setEmail] = useState(''), [mrole, setMrole] = useState('editor'), [revs, setRevs] = useState<any[]>([]), [audit, setAudit] = useState<any[]>([]), [backups, setBackups] = useState<any[]>([]);
  const pid = project.id, ro = !canEdit(), owner = role === 'owner';
  const refresh = () => { get(`/projects/${pid}/branches/${branchId}/revisions`).then((r) => setRevs(r.revisions)).catch(fail); get(`/projects/${pid}/audit`).then((r) => setAudit(r.entries)).catch(fail); if (owner) get(`/projects/${pid}/backups`).then((r) => setBackups(r.backups)).catch(() => {}); };
  useEffect(refresh, [pid, branchId, revision?.id]); // eslint-disable-line
  const save = async () => { try { await patch(`/projects/${pid}`, { name, status, ...meta }); await reloadProjectMeta(); toast('Project details saved'); } catch (e) { fail(e); } };
  const restore = async (rid: string, seq: number) => {
    if (!confirm(`Restore revision ${seq}? The current version stays in history.`)) return;
    try { await flush(); await post(`/projects/${pid}/branches/${branchId}/restore`, { revisionId: rid, expectedRevisionId: getState().revision!.id }); await loadBranch(branchId); toast(`Revision ${seq} restored as a new revision`); } catch (e) { fail(e); }
  };
  return (
    <div className="page" data-testid="settings">
      <header className="page-head"><div><h1>Project</h1><p>Your access: <b data-testid="my-role">{role}</b>{project.isSynthetic ? ' · synthetic demonstration data' : ''}</p></div></header>
      <section className="card">
        <h3>Scope</h3>
        <div className="row2"><Field label="Workflow name"><input value={name} disabled={ro} data-testid="project-name" onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Status"><select value={status} disabled={ro} onChange={(e) => setStatus(e.target.value)}><option value="draft">Working draft</option><option value="active">Active</option><option value="archived">Archived</option></select></Field></div>
        {META.map(([k, label, rows]) => <Field key={k} label={label}><textarea rows={rows} value={meta[k] ?? ''} disabled={ro} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} /></Field>)}
        {!ro && <button className="primary" onClick={save} data-testid="project-save">Save details</button>}
      </section>
      {!onDevice && <section className="card" data-testid="members">
        <h3>People with access</h3>
        <p className="micro">Projects are private. Only the people listed here can open this one. Readers cannot change anything.</p>
        <table className="impact"><tbody>{members.map((m) => <tr key={m.id}><th>{m.name}<small>{m.email}</small></th><td>{m.role}</td><td>{owner && <button className="linkbtn danger" onClick={() => del(`/projects/${pid}/members/${m.id}`).then(reloadProjectMeta).catch(fail)}>Remove</button>}</td></tr>)}</tbody></table>
        {owner && <div className="capture-row"><input type="email" value={email} placeholder="colleague@example.org" aria-label="Email to add" data-testid="member-email" onChange={(e) => setEmail(e.target.value)} /><select value={mrole} aria-label="Role" data-testid="member-role" onChange={(e) => setMrole(e.target.value)}><option value="editor">Researcher (can edit)</option><option value="reader">Reader</option><option value="owner">Owner</option></select><button data-testid="member-add" onClick={() => post(`/projects/${pid}/members`, { email, role: mrole }).then(() => { setEmail(''); toast('Access updated'); return reloadProjectMeta(); }).catch(fail)}>Add or change</button></div>}
      </section>}
      <section className="card" data-testid="history">
        <h3>History of “{branches.find((b) => b.id === branchId)?.name}”</h3>
        <p className="micro">Every saved change is an immutable revision. Restoring one adds a new revision; nothing is overwritten.</p>
        <ol className="history">{revs.slice(0, 30).map((r) => <li key={r.id} data-rev={r.id}><b>Revision {r.seq}</b> · {r.summary || 'Edit'} <em>{r.author} · {when(r.createdAt)}</em>{r.restoredFrom && <span className="chip">restore</span>}{r.id === revision?.id ? <span className="chip ok">current</span> : !ro && <button className="linkbtn" data-testid="restore" onClick={() => restore(r.id, r.seq)}>Restore</button>}</li>)}</ol>
      </section>
      <section className="card">
        <h3>Backup and transfer</h3>
        <a className="btn" href={`/api/projects/${pid}/export/workspace.json`} download>Download workspace backup (JSON)</a>
        {owner && (<details className="plain" data-testid="replace"><summary>Replace this project from a file…</summary>
          <p className="micro warn">Imports normally create a new project. Replacing is for restoring a backup: you will preview the file, type the project name, and a backup of the current contents is saved first.</p>
          <ImportPanel replace={{ pid, name: project.name }} onDone={() => loadProject(pid)} />
          {backups.length > 0 && <><h4>Backups taken before a replace</h4><ul>{backups.map((b) => <li key={b.id}><a href={`/api/projects/${pid}/backups/${b.id}`} download={`backup-${b.id}.json`}>{when(b.createdAt)}</a> · {b.reason}</li>)}</ul></>}
        </details>)}
        {owner && <div className="lens-danger"><button className="danger" onClick={async () => { if (prompt(`Type the project name to delete it permanently:`) === project.name) { try { await del(`/projects/${pid}`); location.hash = '#/'; } catch (e) { fail(e); } } }}>Delete project</button></div>}
      </section>
      <section className="card" data-testid="audit">
        <h3>Activity log</h3>
        <ol className="history">{audit.slice(0, 60).map((a) => <li key={a.id} data-action={a.action}><b>{a.action}</b> {a.entityId && <code>{a.entityId}</code>} <em>{a.actor} · {when(a.createdAt)}</em></li>)}</ol>
      </section>
    </div>
  );
}
