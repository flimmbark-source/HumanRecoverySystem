// Brief preview and exports. The preview renders exactly the anonymized data the PDF is built from.
import { useEffect, useState } from 'react';
import { get } from './api';
import { fail, flush, useStore } from './store';
import { Empty, when } from './ui';

export function Report() {
  const pid = useStore((s) => s.project!.id), evidence = useStore((s) => s.evidence);
  const [b, setB] = useState<any>(null), [effort, setEffort] = useState<any>(null);
  const load = () => flush().then(() => Promise.all([get(`/projects/${pid}/export/brief.json`), get(`/projects/${pid}/audit`)])).then(([brief, audit]) => { setB(brief); setEffort(audit); }).catch(fail);
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [pid, evidence]);
  const href = (f: string) => `/api/projects/${pid}/export/${f}`;
  if (!b) return <div className="page"><p className="micro">Building the brief…</p></div>;
  const cs = b.currentState;
  return (
    <div className="page report" data-testid="report">
      <header className="page-head"><div><h1>Decision brief</h1><p>Anonymized for leadership: role- and workflow-level findings, approved excerpts and approved source IDs only.</p></div></header>
      <div className="btnrow exports" data-testid="exports">
        <a className="btn primary" href={href('brief.pdf')} download data-testid="export-brief" onClick={() => setTimeout(load, 1500)}>Decision brief (PDF)</a>
        <a className="btn" href={href('map.pdf')} download data-testid="export-map">Current-state map (PDF)</a>
        <a className="btn" href={href('opportunities.xlsx')} download data-testid="export-xlsx">Opportunity sheet (XLSX)</a>
        <a className="btn" href={href('opportunities.csv')} download data-testid="export-csv">Opportunity sheet (CSV)</a>
        <a className="btn" href={href('workspace.json')} download data-testid="export-json">Workspace backup (JSON)</a>
        <button onClick={() => window.print()}>Print this preview</button>
      </div>
      <article className="brief" data-testid="brief-preview">
        {b.synthetic && <p className="alert warn">Synthetic demonstration data. Names, sources, figures and relationships are invented.</p>}
        <h2>{b.projectName}</h2>
        <p className="micro">Generated {when(b.generatedAt)} · map as of {when(b.asOf)}</p>
        {b.scope.researchQuestion && <p><b>Research question.</b> {b.scope.researchQuestion}</p>}
        {b.scope.scopeDescription && <p><b>Scope.</b> {b.scope.scopeDescription}</p>}
        <h3>How the work runs today</h3>
        <table className="impact"><tbody>
          <tr><th>Staff effort</th><td data-testid="brief-percase">{cs.effortPerCase}</td><td>{cs.effortNote}</td></tr>
          <tr><th>Monthly effort</th><td data-testid="brief-monthly">{cs.effortMonthly}</td><td>Volume: {cs.volume}</td></tr>
          {cs.routes.map((r: any) => <tr key={r.name}><th>Route “{r.name}”</th><td>{r.elapsed} elapsed</td><td>{r.active} active + {r.waiting} waiting, sequential</td></tr>)}
        </tbody></table>
        {cs.missing.length > 0 && <div className="alert warn" data-testid="brief-missing"><b>Not yet measured</b><ul>{cs.missing.map((m: string) => <li key={m}>{m}</li>)}</ul></div>}
        <details className="plain"><summary>Handoffs in plain language ({cs.handoffs.length})</summary><ul>{cs.handoffs.map((h: any) => <li key={h.label}><b>{h.label}</b> <em>({h.type})</em>: {h.sentence}{h.unknowns.length > 0 && <span className="micro warn"> Not yet known: {h.unknowns.join('; ')}</span>}</li>)}</ul></details>
        <h3>Opportunities and recommendations</h3>
        {!b.recommendations.length && <Empty title="Nothing to recommend yet">Add an opportunity in Decide.</Empty>}
        {b.recommendations.map((r: any, i: number) => (
          <section key={r.id} className="brief-rec" data-rec={r.id}>
            <small className={r.isHypothesis ? 'warn' : ''} data-testid="rec-heading">{i + 1}. {r.heading} · {r.evidenceLevel}</small>
            <h4>{r.title}</h4>
            {r.stale && <p className="alert warn">The scenario behind this item changed after it was selected.</p>}
            <div className="triad">
              <section><h5>What was observed</h5><ul data-testid="rec-observations">{r.observations.map((o: any, k: number) => <li key={k} data-relation={o.relation}><b>{o.relation === 'supports' ? 'Supports' : o.relation === 'contradicts' ? 'Contradicts' : 'Related'}</b> · {o.kind}, {o.certainty} · {o.source}{o.text ? <> — “{o.text}”</> : <em> — excerpt not approved for export</em>}</li>)}{!r.observations.length && <li className="micro">No observations linked.</li>}</ul></section>
              <section><h5>Interpretation</h5>{r.insights.map((x: any) => <p key={x.title}><b>{x.title}</b>{x.body && x.body !== x.title ? `: ${x.body}` : ''}</p>)}<p>{r.interpretation}</p></section>
              <section><h5>Evidence gaps</h5><ul data-testid="rec-gaps">{r.gaps.map((g: string) => <li key={g}>{g}</li>)}{!r.gaps.length && <li className="micro">None recorded.</li>}</ul></section>
            </div>
            {r.preserve && <p><b>Protect.</b> {r.preserve}</p>}{r.stakeholders && <p><b>Whose day changes.</b> {r.stakeholders}</p>}
            {r.option && <div className="brief-option"><b>{r.option.smallestReversible ? 'Smallest reversible change' : 'Proposed option'}: {r.option.title}</b> <em>({r.option.kindLabel}, confidence {r.option.confidence})</em>
              <ul>{[['Benefits', r.option.benefits], ['Downsides and human costs', r.option.downsides], ['Added or shifted work', r.option.shiftedWork], ['Effort', r.option.effort], ['Costs', r.option.costs], ['Tradeoffs', r.option.tradeoffs], ['Unknowns', r.option.unknowns], ['What to test', r.option.test]].filter(([, v]) => v).map(([k, v]) => <li key={k}><b>{k}:</b> {v}</li>)}</ul></div>}
            {r.alternatives.length > 0 && <p className="micro"><b>Also compared:</b> {r.alternatives.map((a: any) => `${a.title} (${a.kindLabel})`).join('; ')}</p>}
            {r.comparison && (<div className="brief-comparison" data-testid="rec-comparison">
              <h5>Modeled comparison: {r.comparison.scenarioName} <em>vs {r.comparison.pinnedTo}</em></h5>
              <table className="impact"><thead><tr><th>Measure</th><th>Baseline</th><th>Proposed</th><th>Change</th></tr></thead><tbody>{r.comparison.lines.map((l: any) => <tr key={l.label}><th>{l.label}<small>{l.note}</small></th><td>{l.baseline}</td><td>{l.proposed}</td><td>{l.change}</td></tr>)}</tbody></table>
              {r.comparison.unverified && <p className="micro warn">Inputs include unverified or estimated values: modeled figures, not measured results.</p>}
              <p><b>Cash.</b> {r.comparison.cash.join(' ')}</p>
              {r.comparison.humanEffects.length > 0 && <><b>Human and service effects</b><ul data-testid="rec-human">{r.comparison.humanEffects.map((h: any, k: number) => <li key={k}>{h.role} — {h.kind} ({h.direction}): {h.description} <em>Magnitude: {h.magnitude}.</em>{h.validation && <> Checked by: {h.validation}</>}</li>)}</ul></>}
              {r.comparison.workingConditions.length > 0 && <><b>Working conditions</b><ul>{r.comparison.workingConditions.map((w: any, k: number) => <li key={k}>{w.role} · {w.indicator}: {w.baseline} → {w.expected} <em>({w.basis})</em></li>)}</ul></>}
              {r.comparison.guardrails.length > 0 && <><b>Guardrails</b><ul data-testid="rec-guardrails">{r.comparison.guardrails.map((g: any) => <li key={g.metric}><b>{g.metric}</b>: {g.detail}</li>)}</ul></>}
              {r.comparison.preserve && <p><b>Preserves.</b> {r.comparison.preserve}</p>}{r.comparison.reversal && <p><b>To reverse.</b> {r.comparison.reversal}</p>}
            </div>)}
            {r.validationPlan && <p><b>Validation plan.</b> {r.validationPlan}</p>}
          </section>
        ))}
        <h3>Provenance</h3>
        <ul data-testid="brief-provenance">{b.provenance.map((s: any) => <li key={s.id}>{s.id} <em>({s.type})</em>{s.url && <> — <a href={s.url}>{s.url}</a></>}</li>)}{!b.provenance.length && <li className="micro">No sources are approved for citation.</li>}</ul>
        <p className="micro" data-testid="brief-withheld">{b.withheld.join(' ')}</p>
      </article>
      {effort && (<section className="effortlog" data-testid="effort-log">
        <h3>Research effort in this workspace</h3>
        <table className="impact"><thead><tr><th>Phase</th><th>Actions</th><th>Active time</th><th>First</th><th>Last</th></tr></thead><tbody>{effort.effort.map((e: any) => <tr key={e.phase}><th>{e.phase}</th><td>{e.actions}</td><td>{Math.floor(e.activeSeconds / 60)} min {e.activeSeconds % 60} s</td><td>{when(e.first)}</td><td>{when(e.last)}</td></tr>)}</tbody></table>
        <p className="micro">{effort.note} Active time counts consecutive actions less than five minutes apart.</p>
      </section>)}
    </div>
  );
}
