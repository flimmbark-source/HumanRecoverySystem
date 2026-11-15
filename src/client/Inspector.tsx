import { useEffect, useRef, useState } from 'react';
import { canEdit, editModel, openModal, select, setState, toast, useStore } from './store';
import { addInternalActivity, deleteItem, updateActivity, updateActivityForEdge, updateEdge, updateNode } from './ops';
import { NoteCard, QuickCapture } from './Capture';
import { BasisChip, Field, QtyInput, Sentence, TokenKey, fmtMinutes } from './ui';
import { TYPE_COLOR, KIND_ICON } from './Graph';
import { ScenarioPanel } from './Scenario';
import { ACTION_CODES, EDGE_TYPES, EDGE_TYPE_LABEL, NODE_KINDS, NODE_KIND_LABEL, SCOPES, activityForEdge, type ActionCode, type EdgeType, type Model, type WActivity, type WEdge } from '../shared/model';
import { ACTION_LABEL, PERFORMER_RELATION_LABEL, describeEdge } from '../shared/sentence';
import { computeEffort } from '../shared/impact';

const SCOPE_LABEL = { internal: 'Within the reviewed scope', external: 'External, with a direct interface', context: 'Context only (can be filtered)' };

function useDisclosure(key: string, id: string) {
  // Each layer opens deliberately and stays as the researcher left it while the same item is selected.
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [id, key]);
  return { open, onToggle: (e: React.SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open) };
}

function TimingEditor({ a, onChange, disabled }: { a: WActivity; onChange: (fn: (a: WActivity) => void, field: string) => void; disabled: boolean }) {
  return (
    <>
      <QtyInput label="Active time" unitLabel="minutes" q={a.activeMinutes} disabled={disabled} testid="edit-active" onChange={(q) => onChange((x) => { x.activeMinutes = q; }, 'active')} />
      <QtyInput label="Waiting time" unitLabel="hours" scale={60} q={a.waitMinutes} disabled={disabled} testid="edit-wait" onChange={(q) => onChange((x) => { x.waitMinutes = q; }, 'wait')} />
      <QtyInput label="Occurrences" unitLabel="per case" q={a.occurrencesPerCase} disabled={disabled} testid="edit-occ" onChange={(q) => onChange((x) => { x.occurrencesPerCase = q; }, 'occ')} />
      <Field label="How was the active time established?" hint="Method, sample size, period and source ID"><input value={a.activeMinutes.method ?? ''} disabled={disabled} placeholder="e.g. timed 12 cases, Process walk 02" onChange={(e) => onChange((x) => { x.activeMinutes.method = e.target.value; }, 'method')} /></Field>
      <label className="check"><input type="checkbox" checked={a.includedInWorkload} disabled={disabled} onChange={(e) => onChange((x) => { x.includedInWorkload = e.target.checked; }, 'incl')} /> Count this activity in workload totals</label>
      <p className="micro">An empty box means unknown. Enter 0 only when zero is what was found.</p>
    </>
  );
}

function EdgeLens({ model, edge }: { model: Model; edge: WEdge }) {
  const notes = useStore((s) => s.evidence.notes).filter((n) => n.targetId === edge.id);
  const compareModel = useStore((s) => s.compareModel), mode = useStore((s) => s.mode);
  const a = activityForEdge(model, edge.id);
  const d = describeEdge(model, edge, a);
  const [gaps, setGaps] = useState(false);
  const perf = useDisclosure('perf', edge.id), evid = useDisclosure('evid', edge.id), edit = useDisclosure('edit', edge.id);
  const ro = !canEdit() || mode === 'timeline';
  const from = model.nodes.find((n) => n.id === edge.from), to = model.nodes.find((n) => n.id === edge.to);
  const effort = computeEffort(model);
  const contribution = a ? effort.contributions.find((c) => c.activityId === a.id) : null;
  const before = compareModel ? activityForEdge(compareModel, edge.id) : null;
  const operational = edge.type === 'flow' || edge.type === 'info';
  const basis = a ? (a.activeMinutes.value === null ? 'unknown' : a.activeMinutes.basis) : 'unknown';
  const setAct = (fn: (x: WActivity) => void, field: string) => updateActivityForEdge(edge.id, fn, field);
  const txt = (k: keyof WEdge, label: string, placeholder = '') => (
    <Field label={label}><input value={String(edge[k] ?? '')} disabled={ro} placeholder={placeholder} data-testid={`edit-${k}`} onChange={(e) => updateEdge(edge.id, { [k]: e.target.value } as Partial<WEdge>, k)} /></Field>
  );

  return (
    <div className="lens" style={{ ['--lens-accent' as string]: TYPE_COLOR[edge.type] }} data-testid="edge-lens">
      <div className="lens-top">
        <div className="lens-top-row">
          <span className="lens-type" data-kind={edge.type} data-testid="lens-type"><i />{EDGE_TYPE_LABEL[edge.type]}</span>
          {operational && <BasisChip basis={basis} />}
        </div>
        <h2 data-testid="lens-title">{edge.label}</h2>
        <div className="lens-actors" data-testid="lens-route">
          <button onClick={() => from && select({ type: 'node', id: from.id })}>{from?.label ?? 'Unknown'}</button><span aria-hidden="true">{edge.directed ? '→' : '—'}</span><span className="sr">to</span>
          <button onClick={() => to && select({ type: 'node', id: to.id })}>{to?.label ?? 'Unknown'}</button>
        </div>
      </div>

      <div className="lens-narrative">
        <p data-testid="sentence"><Sentence segments={d.segments} /></p>
        <div className="lens-narrative-footer">
          {d.unknowns.length > 0 ? <button className="linkbtn warn" aria-expanded={gaps} onClick={() => setGaps(!gaps)} data-testid="gaps-toggle">{d.unknowns.length} not yet known</button> : <span className="micro">All parts identified</span>}
          <button className="linkbtn" onClick={() => { void navigator.clipboard?.writeText(d.sentence); toast('Sentence copied'); }}>Copy</button>
        </div>
        {gaps && <ul className="lens-gaps" data-testid="gaps">{d.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>}
        <TokenKey />
      </div>

      {operational && (
        <div className="lens-compact-flow" data-testid="iao">
          <div className="lens-flow-cell in"><small>Input</small><strong>{d.input.item || <i>Item not identified</i>}</strong><em data-testid="iao-in-state">{d.input.state || 'state not defined'}</em></div>
          <span className="lens-flow-arrow" aria-hidden="true">→</span>
          <div className="lens-flow-cell work"><small>Action</small><strong data-testid="iao-performer">{d.performer ?? 'Performer not identified'}</strong><em>{d.verb ?? 'action not classified'} · {PERFORMER_RELATION_LABEL[d.performerRelation]}</em></div>
          <span className="lens-flow-arrow" aria-hidden="true">→</span>
          <div className="lens-flow-cell out"><small>Output</small><strong>{d.output.result || <i>Result not described</i>}</strong><em data-testid="iao-out-state">{d.output.state || 'state not defined'}</em></div>
        </div>
      )}
      {a && (<div className="lens-inline-metrics"><span><b>{fmtMinutes(a.activeMinutes.value)}</b> active</span><span><b>{fmtMinutes(a.waitMinutes.value)}</b> waiting</span><span><b>{notes.length}</b> {notes.length === 1 ? 'note' : 'notes'}</span></div>)}
      {edge.description && <p className="lens-description">{edge.description}</p>}
      {(edge.conditions || edge.exceptions) && <p className="lens-description">{edge.conditions && <>Applies when: {edge.conditions}. </>}{edge.exceptions && <>Exceptions: {edge.exceptions}.</>}</p>}

      <div className="lens-disclosure-list">
        <details className="lens-disclosure" data-testid="disc-performance" {...perf}>
          <summary><span className="disclosure-icon time">◷</span><span>Performance<small>{a ? `${fmtMinutes(a.activeMinutes.value)} active · ${basis}` : 'No activity recorded on this link'}</small></span><span className="disclosure-chevron">⌄</span></summary>
          {perf.open && (<div className="lens-pane">
            {!a ? <p className="micro">This {EDGE_TYPE_LABEL[edge.type].toLowerCase()} link has no activity, so it adds no effort or waiting. Add timing in Edit if work really happens here.</p> : (<>
              <div className="lens-data-pair">
                <div><small>Active per occurrence</small><strong data-testid="perf-active">{fmtMinutes(a.activeMinutes.value)}</strong><span><BasisChip basis={basis} /></span></div>
                <div><small>Waiting</small><strong data-testid="perf-wait">{fmtMinutes(a.waitMinutes.value)}</strong><span><BasisChip basis={a.waitMinutes.value === null ? 'unknown' : a.waitMinutes.basis} /></span></div>
              </div>
              <div className="lens-fact-row"><span>Occurrences per case</span><b>{a.occurrencesPerCase.value ?? 'Unknown'}</b></div>
              <div className="lens-fact-row"><span>Effort per case</span><b>{contribution?.perCase != null ? `${contribution.perCase} min` : 'Unknown'}</b></div>
              <div className="lens-fact-row"><span>Monthly effort at {effort.volume ?? 'unknown'} cases</span><b>{contribution?.perCase != null && effort.volume !== null ? `${Math.round((contribution.perCase * effort.volume) / 6) / 10} h` : 'Unknown'}</b></div>
              <div className="lens-fact-row"><span>Counted in workload</span><b>{a.includedInWorkload ? 'Yes' : 'No'}</b></div>
              {a.activeMinutes.method && <div className="lens-fact-row"><span>Method</span><b>{a.activeMinutes.method}</b></div>}
              {before && compareModel && (before.activeMinutes.value !== a.activeMinutes.value || before.waitMinutes.value !== a.waitMinutes.value) && (
                <div className="lens-change" data-testid="perf-change"><b>Changed in this scenario</b><p>Active {fmtMinutes(before.activeMinutes.value)} → {fmtMinutes(a.activeMinutes.value)} · waiting {fmtMinutes(before.waitMinutes.value)} → {fmtMinutes(a.waitMinutes.value)}. An arithmetic comparison, not a confirmed saving.</p></div>
              )}
              {(basis === 'unverified' || basis === 'assumed' || basis === 'estimated') && <div className="lens-caution"><span>Not a measurement</span><p>This figure is {basis}. Results that use it carry the same tag until a basis is recorded.</p></div>}
            </>)}
          </div>)}
        </details>

        <details className="lens-disclosure" data-testid="disc-evidence" {...evid}>
          <summary><span className="disclosure-icon evidence">✎</span><span>Evidence<small>{notes.length ? `${notes.length} attached ${notes.length === 1 ? 'note' : 'notes'}` : 'Nothing attached yet'}</small></span><span className="disclosure-chevron">⌄</span></summary>
          {evid.open && (<div className="lens-pane">
            <QuickCapture targetId={edge.id} compact />
            {notes.map((n) => <NoteCard key={n.id} note={n} showTarget={false} />)}
            <p className="micro">The generated sentence is a reading of the model, not new evidence.</p>
          </div>)}
        </details>

        <details className="lens-disclosure" data-testid="disc-edit" {...edit}>
          <summary><span className="disclosure-icon edit">⚙</span><span>Edit<small>{ro ? 'Read only' : 'Structured fields that drive the sentence'}</small></span><span className="disclosure-chevron">⌄</span></summary>
          {edit.open && (<div className="lens-pane conn-editbody">
            <div className="semantic-preview" data-testid="preview"><small>PREVIEW</small><p><Sentence segments={d.segments} /></p></div>
            {txt('label', 'Short label')}
            <div className="row2">
              <Field label="Type"><select value={edge.type} disabled={ro} data-testid="edit-type" onChange={(e) => updateEdge(edge.id, { type: e.target.value as EdgeType })}>{EDGE_TYPES.map((t) => <option key={t} value={t}>{EDGE_TYPE_LABEL[t]}</option>)}</select></Field>
              <Field label="Direction"><select value={edge.directed ? 'y' : 'n'} disabled={ro} onChange={(e) => updateEdge(edge.id, { directed: e.target.value === 'y' })}><option value="y">Directed</option><option value="n">Undirected</option></select></Field>
            </div>
            <div className="row2">
              <Field label="From"><select value={edge.from} disabled={ro} onChange={(e) => e.target.value !== edge.to && updateEdge(edge.id, { from: e.target.value })}>{model.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select></Field>
              <Field label="To"><select value={edge.to} disabled={ro} onChange={(e) => e.target.value !== edge.from && updateEdge(edge.id, { to: e.target.value })}>{model.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select></Field>
            </div>
            <h4>Who does what</h4>
            <Field label="Performer" hint="Chosen explicitly. Never assumed from the direction of the line.">
              <select value={a?.performerId ?? ''} disabled={ro} data-testid="edit-performer" onChange={(e) => setAct((x) => { x.performerId = e.target.value || null; }, 'performer')}>
                <option value="">Unknown / not identified</option>
                {model.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}{n.id === edge.from ? ' (sender)' : n.id === edge.to ? ' (receiver)' : ' (third party)'}</option>)}
              </select>
            </Field>
            <Field label="Action"><select value={a?.actionCode ?? ''} disabled={ro} data-testid="edit-action" onChange={(e) => setAct((x) => { x.actionCode = (e.target.value || null) as ActionCode | null; }, 'action')}><option value="">Not classified</option>{ACTION_CODES.map((c) => <option key={c} value={c}>{ACTION_LABEL[c]}</option>)}</select></Field>
            <h4>What moves and how it changes</h4>
            {txt('workItem', 'Work item', 'e.g. Application')}
            <div className="row2">{txt('inputState', 'Input state', 'e.g. submitted')}{txt('outputState', 'Output state', 'e.g. ready for placement')}</div>
            {txt('result', 'Result produced', 'e.g. Ready for placement')}
            {txt('conditions', 'Applies when')}{txt('exceptions', 'Exceptions')}
            <Field label="Notes on this connection"><textarea rows={2} value={edge.description} disabled={ro} onChange={(e) => updateEdge(edge.id, { description: e.target.value }, 'description')} /></Field>
            <h4>Timing</h4>
            {a ? <TimingEditor a={a} onChange={setAct} disabled={ro} /> : <button disabled={ro} onClick={() => setAct(() => {}, 'create')}>Record an activity on this link</button>}
            {!ro && <div className="lens-danger"><button className="danger" data-testid="delete-item" onClick={() => deleteItem({ type: 'edge', id: edge.id })}>Delete connection</button></div>}
          </div>)}
        </details>
      </div>
    </div>
  );
}

function NodePanel({ model, id }: { model: Model; id: string }) {
  const n = model.nodes.find((x) => x.id === id)!;
  const notes = useStore((s) => s.evidence.notes).filter((x) => x.targetId === id), mode = useStore((s) => s.mode);
  const ro = !canEdit() || mode === 'timeline';
  const edges = model.edges.filter((e) => e.from === id || e.to === id);
  const internal = model.activities.filter((a) => !a.edgeId && a.ownerNodeId === id);
  const edit = useDisclosure('edit', id);
  return (
    <div className="lens" data-testid="node-panel">
      <div className="lens-top"><span className="lens-type"><b aria-hidden="true">{KIND_ICON[n.kind]}</b> {NODE_KIND_LABEL[n.kind]}</span>{n.scope !== 'internal' && <span className="chip scope">{n.scope.toUpperCase()}</span>}</div>
      <h2>{n.label}</h2>
      <p className="lens-description">{n.role}{n.role && n.description ? ' · ' : ''}{n.description}</p>
      <p className="micro">{SCOPE_LABEL[n.scope]}{model.startNodeId === id ? ' · Start of the workflow' : ''}</p>
      <h4>Connections</h4>
      <ul className="plainlist">{edges.map((e) => <li key={e.id}><button className="rowbtn" onClick={() => select({ type: 'edge', id: e.id })}><span>{e.label}</span><em>{EDGE_TYPE_LABEL[e.type]} · {e.from === id ? 'out' : 'in'}</em></button></li>)}{!edges.length && <li className="micro">Not connected yet.</li>}</ul>
      <h4>Internal activities</h4>
      <ul className="plainlist">{internal.map((a) => <li key={a.id}><button className="rowbtn" onClick={() => select({ type: 'activity', id: a.id })}><span>{a.label}</span><em>{fmtMinutes(a.activeMinutes.value)} active</em></button></li>)}{!internal.length && <li className="micro">None recorded.</li>}</ul>
      {!ro && <div className="btnrow"><button onClick={() => addInternalActivity(id)}>+ Internal activity</button><button onClick={() => { setState({ linkFrom: id, inspectorOpen: false }); toast('Choose the destination node on the map.'); }}>+ Connect from here</button></div>}
      <div className="lens-disclosure-list">
        <details className="lens-disclosure" open><summary><span className="disclosure-icon evidence">✎</span><span>Evidence<small>{notes.length} attached</small></span><span className="disclosure-chevron">⌄</span></summary>
          <div className="lens-pane"><QuickCapture targetId={id} compact />{notes.map((x) => <NoteCard key={x.id} note={x} showTarget={false} />)}</div>
        </details>
        <details className="lens-disclosure" data-testid="disc-edit" {...edit}><summary><span className="disclosure-icon edit">⚙</span><span>Edit<small>{ro ? 'Read only' : 'Name, type and scope'}</small></span><span className="disclosure-chevron">⌄</span></summary>
          {edit.open && (<div className="lens-pane conn-editbody">
            <Field label="Name"><input value={n.label} disabled={ro} data-testid="node-label" onChange={(e) => updateNode(id, { label: e.target.value || 'Untitled' }, 'label')} /></Field>
            <Field label="Role or subtitle"><input value={n.role} disabled={ro} onChange={(e) => updateNode(id, { role: e.target.value }, 'role')} /></Field>
            <div className="row2">
              <Field label="Type"><select value={n.kind} disabled={ro} onChange={(e) => updateNode(id, { kind: e.target.value as typeof n.kind })}>{NODE_KINDS.map((k) => <option key={k} value={k}>{NODE_KIND_LABEL[k]}</option>)}</select></Field>
              <Field label="Scope"><select value={n.scope} disabled={ro} data-testid="node-scope" onChange={(e) => updateNode(id, { scope: e.target.value as typeof n.scope })}>{SCOPES.map((k) => <option key={k} value={k}>{SCOPE_LABEL[k]}</option>)}</select></Field>
            </div>
            <Field label="Part of group"><select value={n.parentId ?? ''} disabled={ro} onChange={(e) => updateNode(id, { parentId: e.target.value || null })}><option value="">None</option>{model.nodes.filter((g) => g.kind === 'group' && g.id !== id).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></Field>
            <Field label="Description"><textarea rows={2} value={n.description} disabled={ro} onChange={(e) => updateNode(id, { description: e.target.value }, 'description')} /></Field>
            {!ro && <div className="btnrow"><button onClick={() => editModel((m) => { m.startNodeId = id; }, 'Set start')} disabled={model.startNodeId === id}>Set as workflow start</button><button className="danger" data-testid="delete-item" onClick={() => deleteItem({ type: 'node', id })}>Delete node</button></div>}
          </div>)}
        </details>
      </div>
    </div>
  );
}

function ActivityPanel({ model, id }: { model: Model; id: string }) {
  const a = model.activities.find((x) => x.id === id)!;
  const notes = useStore((s) => s.evidence.notes).filter((x) => x.targetId === id), mode = useStore((s) => s.mode);
  const ro = !canEdit() || mode === 'timeline';
  const owner = model.nodes.find((n) => n.id === a.ownerNodeId), performer = model.nodes.find((n) => n.id === a.performerId);
  return (
    <div className="lens" data-testid="activity-panel">
      <div className="lens-top"><span className="lens-type">◈ Internal activity</span><BasisChip basis={a.activeMinutes.value === null ? 'unknown' : a.activeMinutes.basis} /></div>
      <h2>{a.label}</h2>
      <p className="lens-description">Work done at <button className="linkbtn" onClick={() => owner && select({ type: 'node', id: owner.id })}>{owner?.label ?? 'an unknown node'}</button> by {performer?.label ?? 'a performer who is not identified'}. No handoff is involved.</p>
      <div className="lens-inline-metrics"><span><b>{fmtMinutes(a.activeMinutes.value)}</b> active</span><span><b>{fmtMinutes(a.waitMinutes.value)}</b> waiting</span></div>
      <div className="conn-editbody">
        <Field label="Label"><input value={a.label} disabled={ro} onChange={(e) => updateActivity(id, (x) => { x.label = e.target.value || 'Activity'; }, 'label')} /></Field>
        <div className="row2">
          <Field label="Performer"><select value={a.performerId ?? ''} disabled={ro} onChange={(e) => updateActivity(id, (x) => { x.performerId = e.target.value || null; })}><option value="">Unknown</option>{model.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select></Field>
          <Field label="Action"><select value={a.actionCode ?? ''} disabled={ro} onChange={(e) => updateActivity(id, (x) => { x.actionCode = (e.target.value || null) as ActionCode | null; })}><option value="">Not classified</option>{ACTION_CODES.map((c) => <option key={c} value={c}>{ACTION_LABEL[c]}</option>)}</select></Field>
        </div>
        <TimingEditor a={a} disabled={ro} onChange={(fn, field) => updateActivity(id, fn, field)} />
        {!ro && <div className="lens-danger"><button className="danger" onClick={() => deleteItem({ type: 'activity', id })}>Delete activity</button></div>}
      </div>
      <h4>Evidence</h4>
      <QuickCapture targetId={id} compact />{notes.map((x) => <NoteCard key={x.id} note={x} showTarget={false} />)}
    </div>
  );
}

/** Nothing selected: a quiet panel with the map as a keyboard-reachable outline. */
function Quiet({ model }: { model: Model }) {
  const notes = useStore((s) => s.evidence.notes);
  const effort = computeEffort(model);
  return (
    <div className="quiet" data-testid="quiet-panel">
      <p className="quiet-caption">Select a node or a line to read it. Details open only when you ask for them.</p>
      <div className="statgrid">
        <div className="stat"><small>Effort per case</small><b data-testid="stat-percase">{effort.perCase.value !== null ? `${effort.perCase.value} min` : effort.perCase.status === 'unknown' ? 'Unknown' : `Incomplete · ${effort.perCase.knownSubtotal} min known`}</b></div>
        <div className="stat"><small>Monthly effort</small><b data-testid="stat-monthly">{effort.monthly.value !== null ? `${Math.round(effort.monthly.value * 10) / 10} h` : effort.monthly.status === 'unknown' ? 'Unknown' : 'Incomplete'}</b></div>
      </div>
      {effort.monthly.basis.some((b) => b === 'unverified') && <p className="micro warn" data-testid="unverified-note">Based on unverified sample inputs. These are not findings.</p>}
      {effort.perCase.missing.length > 0 && <p className="micro warn">{effort.perCase.missing.length} included {effort.perCase.missing.length === 1 ? 'input is' : 'inputs are'} missing: {effort.perCase.missing.map((x) => x.label).join(', ')}.</p>}
      <h4>Map outline</h4>
      <ul className="plainlist outline" data-testid="outline">
        {model.nodes.map((n) => <li key={n.id}><button className="rowbtn" onClick={() => select({ type: 'node', id: n.id })}><span>{n.label}</span><em>{NODE_KIND_LABEL[n.kind]}{n.scope !== 'internal' ? ` · ${n.scope}` : ''}</em></button></li>)}
        {model.edges.map((e) => <li key={e.id}><button className="rowbtn" onClick={() => select({ type: 'edge', id: e.id })}><span>{e.label}</span><em>{EDGE_TYPE_LABEL[e.type]} · {notes.filter((n) => n.targetId === e.id).length} notes</em></button></li>)}
      </ul>
      {canEdit() && <div className="btnrow"><button onClick={() => openModal('node')}>+ Node</button><button onClick={() => openModal('connect')}>+ Connection</button><button onClick={() => openModal('note', { targetId: null })}>+ Note</button></div>}
    </div>
  );
}

export function Inspector() {
  const model = useStore((s) => s.model), selection = useStore((s) => s.selection), open = useStore((s) => s.inspectorOpen), mode = useStore((s) => s.mode);
  const ref = useRef<HTMLElement>(null), opener = useRef<HTMLElement | null>(null);
  // Remember what opened the drawer so focus returns there when it closes.
  useEffect(() => { if (open) { opener.current = document.activeElement as HTMLElement; if (window.innerWidth <= 990) ref.current?.focus(); } else if (opener.current?.isConnected) { opener.current.focus(); opener.current = null; } }, [open]);
  if (!model) return null;
  const sel = selection && (selection.type === 'node' ? model.nodes.some((n) => n.id === selection.id) : selection.type === 'edge' ? model.edges.some((e) => e.id === selection.id) : model.activities.some((a) => a.id === selection.id)) ? selection : null;
  return (
    <aside className={`right${open ? ' open' : ''}`} ref={ref} tabIndex={-1} aria-label="Details" data-testid="inspector" onKeyDown={(e) => { if (e.key === 'Escape' && open) setState({ inspectorOpen: false }); }}>
      <div className="righthead">
        <b>{sel ? (sel.type === 'edge' ? 'Connection' : sel.type === 'node' ? 'Node' : 'Activity') : mode === 'scenario' ? 'Scenario' : 'Overview'}</b>
        <span>
          {sel && <button className="linkbtn" onClick={() => select(null)} data-testid="clear-selection">Clear</button>}
          <button className="iconbtn drawer-close" aria-label="Close details and return to the map" data-testid="drawer-close" onClick={() => setState({ inspectorOpen: false })}>✕</button>
        </span>
      </div>
      <div className="inspector">
        {sel?.type === 'edge' ? <EdgeLens model={model} edge={model.edges.find((e) => e.id === sel.id)!} />
          : sel?.type === 'node' ? <NodePanel model={model} id={sel.id} />
            : sel?.type === 'activity' ? <ActivityPanel model={model} id={sel.id} />
              : mode === 'scenario' ? <ScenarioPanel /> : <Quiet model={model} />}
      </div>
    </aside>
  );
}
