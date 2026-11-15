import { useEffect, useMemo, useState } from 'react';
import { canEdit, editModel, select, setRoute, toast, useStore } from './store';
import { getPlay, MOVE_SHARE, pausePlay, resetPlay, setPlay, startPlay, usePlay } from './play';
import { Field, Modal, Sentence, fmtMinutes } from './ui';
import { analyzeRoute, routeFromEdges, suggestRoute } from '../shared/routes';
import { computeElapsed, fmtFigure } from '../shared/impact';
import { describeEdge } from '../shared/sentence';
import { newId, type Model, type WRoute } from '../shared/model';

function RouteBuilder({ model, routeId, onClose }: { model: Model; routeId: string | null; onClose: () => void }) {
  const existing = model.routes.find((r) => r.id === routeId);
  const [route, setR] = useState<WRoute>(existing ? structuredClone(existing) : { id: newId('r', model.routes.map((r) => r.id)), name: `Route ${model.routes.length + 1}`, startNodeId: model.startNodeId, endNodeId: null, steps: [], caseWeight: null });
  const a = analyzeRoute(model, { ...route, endNodeId: null });
  const last = [...a.steps].reverse().find((s) => !s.missing);
  const at = last?.toNodeId ?? route.startNodeId;
  const atNode = model.nodes.find((n) => n.id === at);
  const outgoing = model.edges.filter((e) => e.from === at && (e.type === 'flow' || e.type === 'info'));
  const internal = model.activities.filter((x) => !x.edgeId && x.ownerNodeId === at);
  const used = (id: string) => route.steps.filter((s) => s.refId === id).length;
  const add = (kind: 'edge' | 'activity', refId: string) => setR((r) => ({ ...r, steps: [...r.steps, { id: newId('s', r.steps.map((s) => s.id)), kind, refId }] }));
  const suggest = () => { const s = suggestRoute(model, route.startNodeId); if (s.edgeIds.length) setR((r) => ({ ...r, steps: routeFromEdges(model, r.name, s.edgeIds).steps })); toast(s.message); };
  const save = () => {
    if (!route.steps.length) { toast('Add at least one step.', 'error'); return; }
    const final = { ...route, name: route.name.trim() || 'Route', endNodeId: last?.toNodeId ?? null };
    editModel((m) => { const i = m.routes.findIndex((r) => r.id === final.id); if (i >= 0) m.routes[i] = final; else m.routes.push(final); }, 'Save route');
    setRoute(final.id); onClose();
  };
  return (
    <Modal title={existing ? 'Edit route' : 'New route'} onClose={onClose} wide footer={<>{existing && <button className="danger" onClick={() => { editModel((m) => { m.routes = m.routes.filter((r) => r.id !== existing.id); }, 'Delete route'); setRoute(model.routes.find((r) => r.id !== existing.id)?.id ?? null); onClose(); }}>Delete route</button>}<button className="primary" onClick={save} data-testid="route-save">Save route</button></>}>
      <p className="micro">A route is an explicit, ordered list of steps. Where the flow branches you choose the branch; a repeat is added as its own step, so playback is always bounded.</p>
      <div className="row2">
        <Field label="Route name"><input value={route.name} onChange={(e) => setR({ ...route, name: e.target.value })} data-testid="route-name" /></Field>
        <Field label="Starts at"><select value={route.startNodeId ?? ''} disabled={route.steps.length > 0} data-testid="route-start" onChange={(e) => setR({ ...route, startNodeId: e.target.value || null })}><option value="">Choose…</option>{model.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</select></Field>
      </div>
      <ol className="route-steps" data-testid="route-steps">
        {a.steps.map((s) => <li key={s.stepId} className={s.missing ? 'missing' : ''}>{s.label}{s.occurrence > 1 && <em> · repeat {s.occurrence}</em>}{s.kind === 'activity' && <em> · internal activity</em>}</li>)}
        {!a.steps.length && <li className="micro">No steps yet.</li>}
      </ol>
      {a.flags.filter((f) => f.level === 'error' && f.code !== 'empty').map((f) => <p key={f.message} className="micro warn">{f.message}</p>)}
      <div className="route-next" data-testid="route-next">
        <b>Next step from {atNode?.label ?? '…'}</b>
        {outgoing.length > 1 && <p className="micro warn">The flow branches here. Choose the branch this route follows.</p>}
        <div className="btnrow">
          {outgoing.map((e) => <button key={e.id} data-next={e.id} onClick={() => add('edge', e.id)}>{e.label} → {model.nodes.find((n) => n.id === e.to)?.label}{used(e.id) ? ` (repeat ${used(e.id) + 1})` : ''}</button>)}
          {internal.map((x) => <button key={x.id} data-next={x.id} onClick={() => add('activity', x.id)}>◈ {x.label}{used(x.id) ? ` (repeat ${used(x.id) + 1})` : ''}</button>)}
          {!outgoing.length && !internal.length && <span className="micro">{at ? 'Nothing continues from here. This is the end of the route.' : 'Choose where the route starts.'}</span>}
        </div>
        <div className="btnrow"><button className="linkbtn" onClick={suggest} data-testid="route-suggest">Follow the flow until it branches</button><button className="linkbtn" disabled={!route.steps.length} onClick={() => setR({ ...route, steps: route.steps.slice(0, -1) })}>Remove last step</button></div>
      </div>
    </Modal>
  );
}

export function Timeline() {
  const model = useStore((s) => s.model)!, routeId = useStore((s) => s.routeId);
  const t = usePlay((p) => p.t), playing = usePlay((p) => p.playing), loop = usePlay((p) => p.loop);
  const [builder, setBuilder] = useState<null | 'new' | 'edit'>(null);
  const route = model.routes.find((r) => r.id === routeId) ?? null;
  const analysis = useMemo(() => (route ? analyzeRoute(model, route) : null), [model, route]);
  const elapsed = useMemo(() => (route ? computeElapsed(model, route.id) : null), [model, route]);
  const n = analysis?.playable ? analysis.steps.length : 0;
  useEffect(() => { resetPlay(n); return () => pausePlay(); }, [n, routeId]);
  const i = analysis && n ? Math.min(Math.floor(t), n - 1) : -1;
  const step = i >= 0 ? analysis!.steps[i] : null;
  const frac = Math.min(1, t - Math.max(0, i));
  const waiting = step ? frac > MOVE_SHARE && (step.activity?.waitMinutes.value ?? 0) !== 0 : false;
  const d = step?.edge ? describeEdge(model, step.edge, step.activity) : null;
  const go = (x: number) => { pausePlay(); setPlay({ t: Math.max(0, Math.min(n, x)) }); };
  const suggestion = !model.routes.length ? suggestRoute(model) : null;

  return (
    <div className="playbar" data-testid="timeline">
      <div className="playbar-top">
        <label className="field inline"><span className="field-label">Route</span>
          <select value={routeId ?? ''} onChange={(e) => setRoute(e.target.value || null)} data-testid="route-select" aria-label="Route to play">
            {!model.routes.length && <option value="">No route yet</option>}{model.routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        {canEdit() && <><button onClick={() => setBuilder('new')} data-testid="route-new">New route</button>{route && <button onClick={() => setBuilder('edit')} data-testid="route-edit">Edit</button>}</>}
        {elapsed && (<span className="playbar-totals" data-testid="route-totals">
          <span><b data-testid="route-active">{elapsed.active.value !== null ? fmtFigure(elapsed.active) : '?'}</b> min active</span>
          <span><b data-testid="route-waiting">{elapsed.waiting.value !== null ? fmtFigure(elapsed.waiting) : '?'}</b> min waiting</span>
          <span><b data-testid="route-elapsed">{elapsed.elapsed.value !== null ? fmtFigure(elapsed.elapsed) : 'Incomplete'}</b> {elapsed.elapsed.value !== null ? 'min elapsed' : ''}</span>
        </span>)}
      </div>
      {!route && <p className="micro" data-testid="route-empty">{suggestion ? suggestion.message : 'Choose a route.'} {canEdit() && 'Create a named route to trace a case.'}</p>}
      {analysis && analysis.flags.filter((f) => f.code !== 'repeat' || true).length > 0 && (
        <ul className="route-flags" data-testid="route-flags">{analysis.flags.map((f) => <li key={f.message} data-level={f.level} data-code={f.code} className={f.level}>{f.level === 'error' ? 'Cannot play: ' : f.code === 'timing' ? 'Illustrative: ' : ''}{f.message}</li>)}</ul>
      )}
      {route && (
        <>
          <div className="playbar-controls">
            <button onClick={() => go(Math.max(0, (frac < 0.05 ? i - 1 : i)))} disabled={!n} aria-label="Previous step" data-testid="play-prev">⏮</button>
            <button className="primary" disabled={!n} onClick={() => (playing ? pausePlay() : startPlay())} data-testid="play-toggle" aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
            <button onClick={() => go(Math.min(n, i + 1))} disabled={!n} aria-label="Next step" data-testid="play-next">⏭</button>
            <label className="toggle"><input type="checkbox" checked={loop} onChange={(e) => setPlay({ loop: e.target.checked })} data-testid="play-loop" /> Loop</label>
            <input type="range" min={0} max={Math.max(1, n * 100)} value={Math.round(t * 100)} disabled={!n} aria-label="Scrub through the route" data-testid="play-scrub" onChange={(e) => go(Number(e.target.value) / 100)} />
            <span className="micro" data-testid="play-position">{n ? `Step ${Math.min(n, i + 1)} of ${n}` : 'Not playable'}</span>
          </div>
          {step && (
            <div className="playbar-step" data-testid="play-step">
              <button className="linkbtn strong" onClick={() => select(step.edge ? { type: 'edge', id: step.edge.id } : { type: 'activity', id: step.refId })} data-testid="play-step-label">{step.label}{step.occurrence > 1 ? ` (repeat ${step.occurrence})` : ''}</button>
              <span className={`phase ${waiting ? 'waiting' : 'active'}`} data-testid="play-phase">{waiting ? `Waiting · ${fmtMinutes(step.activity?.waitMinutes.value ?? null)}` : `Working · ${fmtMinutes(step.activity?.activeMinutes.value ?? null)} active`}</span>
              {step.edge && <span className="state" data-testid="play-state">{step.edge.inputState || 'state not defined'} → {step.edge.outputState || 'state not defined'}</span>}
              {d && <p data-testid="play-sentence"><Sentence segments={d.segments} /></p>}
            </div>
          )}
        </>
      )}
      {builder && <RouteBuilder model={model} routeId={builder === 'edit' ? routeId : null} onClose={() => setBuilder(null)} />}
      <span hidden>{getPlay().steps}</span>
    </div>
  );
}
