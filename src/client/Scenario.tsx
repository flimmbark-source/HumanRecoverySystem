import { useMemo, useState } from 'react';
import { AdoptButton } from './MapProposals';
import { canEdit, createScenario, editModel, fail, getState, loadBranch, select, setCompare, setState, toast, useStore } from './store';
import { del, patch } from './api';
import { NoteCard } from './Capture';
import { Field, QtyInput, BasisChip } from './ui';
import { compare, fmtDelta, fmtFigure, type Comparison, type Delta, type Figure } from '../shared/impact';
import { anchorState, diffModels } from '../shared/diff';
import { BASIS, newId, qty, type Assessment, type Basis, type Model } from '../shared/model';

type FieldDef = { key: string; label: string; type?: 'text' | 'area' | 'number' | 'select'; options?: readonly (string | [string, string])[]; wide?: boolean };

/** Small table-like editor for the assessment lists (cash items, human effects, guardrails, working conditions). */
function ListEditor<T extends { id: string }>({ title, items, fields, make, onChange, addLabel, testid, hint }: { title: string; items: T[]; fields: FieldDef[]; make: () => T; onChange: (items: T[]) => void; addLabel: string; testid: string; hint?: string }) {
  const ro = !canEdit();
  const set = (i: number, key: string, value: unknown) => onChange(items.map((it, j) => (j === i ? { ...it, [key]: value } : it)));
  return (
    <section className="listed" data-testid={testid}>
      <h4>{title}</h4>
      {hint && <p className="micro">{hint}</p>}
      {items.map((it, i) => (
        <div className="listed-item" key={it.id}>
          {fields.map((f) => {
            const v = (it as Record<string, unknown>)[f.key];
            return (
              <label key={f.key} className={`field${f.wide || f.type === 'area' ? ' wide' : ''}`}><span className="field-label">{f.label}</span>
                {f.type === 'select' ? <select value={String(v ?? '')} disabled={ro} data-field={f.key} onChange={(e) => set(i, f.key, e.target.value)}>{f.options!.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o as string} value={o as string}>{(o as string).replace(/_/g, ' ')}</option>))}</select>
                  : f.type === 'number' ? <input type="number" step="any" min={0} value={v === null || v === undefined ? '' : String(v)} placeholder="Unknown" disabled={ro} data-field={f.key} onChange={(e) => set(i, f.key, e.target.value === '' ? null : Number(e.target.value))} />
                    : f.type === 'area' ? <textarea rows={2} value={String(v ?? '')} disabled={ro} data-field={f.key} onChange={(e) => set(i, f.key, e.target.value)} />
                      : <input value={String(v ?? '')} disabled={ro} data-field={f.key} onChange={(e) => set(i, f.key, e.target.value)} />}
              </label>
            );
          })}
          {!ro && <button className="linkbtn danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>}
        </div>
      ))}
      {!ro && <button onClick={() => onChange([...items, make()])} data-testid={`${testid}-add`}>{addLabel}</button>}
    </section>
  );
}

const fig = (f: Figure | null | undefined, unit: string) => !f ? '—' : f.value !== null ? `${fmtFigure(f)} ${unit}` : f.range ? `${fmtFigure(f)} ${unit}` : f.status === 'unknown' ? 'Unknown' : `Incomplete (${fmtFigure({ ...f, value: f.knownSubtotal })} ${unit} known)`;
const dl = (d: Delta, unit: string) => (d.value === null ? (d.status === 'unknown' ? 'Unknown' : 'Incomplete') : `${fmtDelta(d)} ${unit}`);

export function ImpactTable({ c }: { c: Comparison }) {
  const rows: [string, string, string, string, string, string][] = [
    ['percase', 'Effort per case', fig(c.base.effort.perCase, 'min'), fig(c.scenario.effort.perCase, 'min'), dl(c.perCase, 'min'), 'per case'],
    ['modeled', 'Monthly effort at modeled volumes', fig(c.base.effort.monthly, 'h'), fig(c.scenario.effort.monthly, 'h'), dl(c.atModeledVolumes, 'h'), c.atModeledVolumes.denominator],
    ['common', 'Monthly effort, like for like', fig(c.base.effort.monthly, 'h'), fig(c.atCommonVolume.scenarioMonthly, 'h'), dl(c.atCommonVolume, 'h'), c.atCommonVolume.denominator],
  ];
  if (c.elapsed) rows.push(['elapsed', 'Elapsed time on route', fig(c.base.elapsed?.elapsed, 'min'), fig(c.scenario.elapsed?.elapsed, 'min'), dl(c.elapsed, 'min'), c.elapsed.denominator]);
  return (
    <table className="impact" data-testid="impact-table">
      <thead><tr><th>Measure</th><th>Baseline</th><th>Proposed</th><th>Change</th></tr></thead>
      <tbody>{rows.map(([k, label, b, s, d, den]) => (<tr key={k} data-row={k}><th>{label}<small>{den}</small></th><td data-col="base">{b}</td><td data-col="scenario">{s}</td><td data-col="delta" className={d.startsWith('−') ? 'good' : d.startsWith('+') ? 'bad' : 'unk'}>{d}</td></tr>))}</tbody>
    </table>
  );
}

function setAssessment(fn: (a: Assessment) => void, key: string) { editModel((m) => fn(m.assessment), 'Edit scenario assessment', `assess:${key}`); }

function Changes({ base, model }: { base: Model; model: Model }) {
  const d = useMemo(() => diffModels(base, model), [base, model]);
  const exists = (id: string) => [...model.nodes, ...model.edges, ...model.activities].some((x) => x.id === id);
  const go = (id: string) => { const t = model.nodes.some((n) => n.id === id) ? 'node' : model.edges.some((e) => e.id === id) ? 'edge' : 'activity'; select({ type: t, id }); };
  if (!d.changes.length && !d.volumeChanged) return <p className="micro">No structural or timing changes yet. Edit the map, a connection or the volume to test the idea.</p>;
  return (
    <div data-testid="scenario-changes">
      {d.volumeChanged && <p className="change changed"><b>Volume</b> {d.volumeChanged.before} → {d.volumeChanged.after}</p>}
      <ul className="changes">
        {d.changes.map((c) => (
          <li key={c.kind + c.id} className={`change ${c.change}`} data-change={c.change} data-id={c.id}>
            <span className="tag">{c.change}</span> {exists(c.id) ? <button className="linkbtn" onClick={() => go(c.id)}>{c.label}</button> : <b>{c.label}</b>} <em>{c.kind === 'edge' ? 'connection' : c.kind}</em>
            {c.fields.length > 0 && <ul>{c.fields.map((f) => <li key={f.field}>{f.field}: {f.before} → {f.after}</li>)}</ul>}
          </li>
        ))}
      </ul>
      {d.affectedActors.length > 0 && <p className="micro"><b>Actors touched:</b> {d.affectedActors.join(', ')}</p>}
      {d.brokenRoutes.map((r) => <div key={r.routeId} className="alert bad" data-testid="broken-route"><b>Broken handoff on “{r.name}”</b><ul>{r.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>)}
      {d.unreachableOutcomes.map((o) => <div key={o.id} className="alert bad" data-testid="unreachable"><b>Outcome no longer reachable:</b> {o.label}</div>)}
      {d.downstream.length > 0 && (<div className="alert warn" data-testid="downstream"><b>Downstream, worth investigating</b><p className="micro">A flag is a place to look, not a calculated effect.</p><ul>{d.downstream.map((x) => <li key={x.id}>{exists(x.id) ? <button className="linkbtn" onClick={() => go(x.id)}>{x.label}</button> : x.label} <em>{x.because}</em></li>)}</ul></div>)}
      {d.unresolved.length > 0 && <div className="alert"><b>Unresolved</b><ul>{d.unresolved.map((u) => <li key={u}>{u}</li>)}</ul></div>}
    </div>
  );
}

function Impact({ base, model }: { base: Model; model: Model }) {
  const routeId = useStore((s) => s.routeId);
  const c = useMemo(() => compare(base, model, routeId), [base, model, routeId]);
  const a = model.assessment, f = c.financial;
  const missing = [...c.base.effort.monthly.missing.map((m) => ({ ...m, side: 'baseline' })), ...c.scenario.effort.monthly.missing.map((m) => ({ ...m, side: 'scenario' }))];
  const ro = !canEdit();
  return (
    <div data-testid="scenario-impact">
      <div className="row2">
        <QtyInput label="Scenario volume" unitLabel="cases/month" q={model.volume} disabled={ro} testid="scenario-volume" onChange={(q) => editModel((m) => { m.volume = { ...q, unit: 'cases/month' }; }, 'Change scenario volume', 'volume')} />
      </div>
      <ImpactTable c={c} />
      {c.unverifiedInputs && <p className="micro warn" data-testid="impact-unverified">Inputs include unverified, estimated or assumed values. These are modeled figures, not measured results.</p>}
      {(c.atCommonVolume.value === null || c.atModeledVolumes.value === null) && <p className="micro warn" data-testid="impact-incomplete">{c.atCommonVolume.note || c.atModeledVolumes.note}</p>}
      {missing.length > 0 && (<div className="alert warn" data-testid="impact-missing"><b>Still needs measurement</b><ul>{missing.map((m, i) => <li key={i}>{m.side}: <button className="linkbtn" onClick={() => { const act = model.activities.find((x) => x.id === m.id); if (act?.edgeId) select({ type: 'edge', id: act.edgeId }); else if (act) select({ type: 'activity', id: act.id }); }}>{m.label}</button> · {m.field} {m.reason}</li>)}</ul></div>)}
      {!routeId && <p className="micro">Choose a route in Timeline to compare elapsed time.</p>}

      <h4>Money</h4>
      <p className="micro">Released time is capacity. It only becomes cash through a documented mechanism such as fewer paid overtime hours or a retired invoice.</p>
      <div className="statgrid" data-testid="cash-summary">
        <div className="stat"><small>Net recurring cash</small><b data-testid="cash-net">{f.netRecurring.value !== null ? `${f.netRecurring.value} ${f.currency ?? ''}/month` : 'Unknown'}</b></div>
        <div className="stat"><small>Simple payback</small><b data-testid="cash-payback">{f.paybackMonths.value !== null ? `${Math.round(f.paybackMonths.value * 10) / 10} months` : 'Not calculated'}</b></div>
        <div className="stat"><small>One-time cost</small><b>{f.oneTime !== null ? `${f.oneTime} ${f.currency ?? ''}` : 'Not entered'}</b></div>
        <div className="stat"><small>Value of released time</small><b data-testid="capacity-value">{f.capacityValue.value !== null ? `${Math.round(f.capacityValue.value)} ${f.currency ?? ''}/month` : 'Not valued'}</b></div>
      </div>
      {f.netRecurring.note && <p className="micro warn" data-testid="cash-note">{f.netRecurring.note}</p>}
      {f.paybackMonths.note && f.netRecurring.value !== null && <p className="micro">{f.paybackMonths.note}</p>}
      {f.issues.map((i) => <p key={i} className="micro warn" data-testid="cash-issue">{i}</p>)}
      <p className="micro">{f.capacityValue.note}</p>
      <div className="row2">
        <Field label="Currency"><input value={a.currency} disabled={ro} placeholder="EUR" data-testid="assess-currency" onChange={(e) => setAssessment((x) => { x.currency = e.target.value.toUpperCase().slice(0, 8); }, 'currency')} /></Field>
        <Field label="Horizon (months)"><input type="number" min={0} value={a.horizonMonths ?? ''} disabled={ro} placeholder="Not set" onChange={(e) => setAssessment((x) => { x.horizonMonths = e.target.value === '' ? null : Number(e.target.value); }, 'horizon')} /></Field>
      </div>
      <QtyInput label="Applicable hourly rate (capacity only)" unitLabel={`${a.currency || 'currency'}/hour`} q={a.hourlyRate ?? qty(null, `${a.currency}/hour`)} disabled={ro} testid="assess-rate" onChange={(q) => setAssessment((x) => { x.hourlyRate = q.value === null ? null : { ...q, unit: `${x.currency}/hour` }; }, 'rate')} />
      <ListEditor title="Cash items" testid="cash-items" addLabel="+ Cash item" items={a.cashItems} onChange={(items) => setAssessment((x) => { x.cashItems = items; }, 'cash')}
        make={() => ({ id: newId('c'), label: 'New item', kind: 'recurring_saving' as const, amount: null, currency: a.currency, period: 'month' as const, mechanism: '', basis: 'estimated' as Basis, sourceIds: [] })}
        fields={[{ key: 'label', label: 'Label' }, { key: 'kind', label: 'Kind', type: 'select', options: [['recurring_saving', 'Recurring saving'], ['recurring_cost', 'Recurring cost'], ['one_time_cost', 'One-time cost']] }, { key: 'amount', label: 'Amount', type: 'number' }, { key: 'currency', label: 'Currency' },
          { key: 'period', label: 'Period', type: 'select', options: [['month', 'per month'], ['year', 'per year'], ['once', 'once']] }, { key: 'basis', label: 'Basis', type: 'select', options: BASIS }, { key: 'mechanism', label: 'Documented cost mechanism (required for a saving to count)', wide: true }]} />
      {f.items.filter((i) => !i.counted).map((i) => <p key={i.id} className="micro warn">“{i.label}” is not counted: {i.reason}.</p>)}
    </div>
  );
}

function People({ base, model }: { base: Model; model: Model }) {
  const c = useMemo(() => compare(base, model, null), [base, model]);
  const a = model.assessment, ro = !canEdit();
  const roles = model.nodes.filter((n) => n.kind === 'person' || n.kind === 'group').map((n) => n.label);
  const area = (key: keyof Assessment, label: string, hint: string, testid: string) => (
    <Field label={label} hint={hint}><textarea rows={2} value={String(a[key] ?? '')} disabled={ro} data-testid={testid} onChange={(e) => setAssessment((x) => { (x as Record<string, unknown>)[key] = e.target.value; }, key)} /></Field>
  );
  return (
    <div data-testid="scenario-people">
      <h4>Workload by role, like for like</h4>
      <table className="impact" data-testid="role-table"><thead><tr><th>Role</th><th>Baseline</th><th>Proposed</th><th>Change</th></tr></thead>
        <tbody>{c.byRole.map((r) => <tr key={r.roleId ?? 'none'}><th>{r.roleLabel}</th><td>{fig(r.base, 'h/mo')}</td><td>{fig(r.scenario, 'h/mo')}</td><td className={r.delta.value && r.delta.value > 0 ? 'bad' : r.delta.value && r.delta.value < 0 ? 'good' : 'unk'}>{dl(r.delta, 'h')}{r.delta.value && r.delta.value > 0 ? ' · absorbs work' : ''}</td></tr>)}</tbody></table>
      {area('preserve', 'What already works and is protected', 'The practice this change must not damage', 'assess-preserve')}
      <ListEditor title="Human and service effects" testid="human-effects" addLabel="+ Effect" hint="Role or workflow level only. Leave magnitude empty when it has not been measured; the concern still travels into the report." items={a.humanEffects} onChange={(items) => setAssessment((x) => { x.humanEffects = items; }, 'human')}
        make={() => ({ id: newId('he'), role: roles[0] ?? '', nodeId: null, kind: 'benefit' as const, direction: 'uncertain' as const, description: '', magnitude: null, missingData: '', validation: '' })}
        fields={[{ key: 'role', label: 'Role affected' }, { key: 'kind', label: 'Kind', type: 'select', options: ['benefit', 'added_work', 'shifted_work', 'lost_contact', 'accessibility', 'relationship', 'quality', 'risk'] }, { key: 'direction', label: 'Direction', type: 'select', options: ['positive', 'negative', 'uncertain'] },
          { key: 'description', label: 'What changes for them', type: 'area' }, { key: 'missingData', label: 'Missing data', wide: true }, { key: 'validation', label: 'How it will be checked', wide: true }]} />
      <ListEditor title="Working conditions" testid="working-conditions" addLabel="+ Indicator" hint="Compare the working day: interruptions, after-hours work, unplanned cover, time for the work where people add value." items={a.workingConditions} onChange={(items) => setAssessment((x) => { x.workingConditions = items; }, 'wc')}
        make={() => ({ id: newId('wc'), role: roles[0] ?? '', indicator: '', baseline: '', expected: '', basis: 'unknown' as Basis, note: '' })}
        fields={[{ key: 'role', label: 'Role' }, { key: 'indicator', label: 'Indicator' }, { key: 'baseline', label: 'Today' }, { key: 'expected', label: 'Expected' }, { key: 'basis', label: 'Basis', type: 'select', options: BASIS }]} />
      <ListEditor title="Guardrails" testid="guardrails" addLabel="+ Guardrail" hint="How the team will know whether workload, work-life balance and service quality held up." items={a.guardrails} onChange={(items) => setAssessment((x) => { x.guardrails = items; }, 'guard')}
        make={() => ({ id: newId('g'), metric: 'New metric', denominator: '', baselinePeriod: '', baseline: null, target: '', direction: 'hold' as const, owner: '', method: '', followUp: '', rollbackTrigger: '' })}
        fields={[{ key: 'metric', label: 'Metric' }, { key: 'denominator', label: 'Denominator' }, { key: 'baselinePeriod', label: 'Baseline period' }, { key: 'target', label: 'Target or threshold' }, { key: 'direction', label: 'Direction', type: 'select', options: [['higher_is_better', 'Higher is better'], ['lower_is_better', 'Lower is better'], ['hold', 'Hold steady']] },
          { key: 'owner', label: 'Owner (role)' }, { key: 'method', label: 'Collection method' }, { key: 'followUp', label: 'Follow-up date' }, { key: 'rollbackTrigger', label: 'Rollback trigger', wide: true }]} />
      {area('reversal', 'How to reverse the change', 'What undoing it takes, and who decides', 'assess-reversal')}
      {area('participantFeedback', 'Feedback from the people affected', 'Preferences and support they asked for', 'assess-feedback')}
      {area('unknowns', 'Still unknown', 'What has not been measured', 'assess-unknowns')}
      {area('validation', 'How the trial will be checked', 'Check service quality and workload together', 'assess-validation')}
    </div>
  );
}

export function ScenarioPanel() {
  const model = useStore((s) => s.model)!, branches = useStore((s) => s.branches), branchId = useStore((s) => s.branchId), lineage = useStore((s) => s.lineage);
  const compareTo = useStore((s) => s.compareTo), compareModel = useStore((s) => s.compareModel), notes = useStore((s) => s.evidence.notes), project = useStore((s) => s.project)!;
  const [tab, setTab] = useState<'changes' | 'impact' | 'people' | 'evidence'>('changes'), [name, setName] = useState(''), [hyp, setHyp] = useState('');
  const branch = branches.find((b) => b.id === branchId)!;
  const scenarios = branches.filter((b) => b.kind === 'scenario');
  const ro = !canEdit();
  const create = async () => { try { await createScenario(name.trim() || `Scenario ${scenarios.length + 1}`, { hypothesis: hyp }); setName(''); setHyp(''); toast('Scenario branched. The baseline and its evidence are untouched.'); } catch (e) { fail(e); } };
  const meta = async (body: Record<string, unknown>) => { try { await patch(`/projects/${project.id}/branches/${branchId}`, body); setState((s) => ({ branches: s.branches.map((b) => (b.id === branchId ? { ...b, ...body } as typeof b : b)) })); } catch (e) { fail(e); } };
  const historical = notes.filter((n) => n.targetId && anchorState(model, n.targetId) === 'historical');

  const creator = !ro && (
    <div className="newscenario">
      <h4>{branch.kind === 'baseline' ? 'Branch a scenario from the baseline' : 'Branch a further scenario from this one'}</h4>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Scenario ${scenarios.length + 1}`} data-testid="scenario-name" /></Field>
      <Field label="Hypothesis (optional)"><textarea rows={2} value={hyp} onChange={(e) => setHyp(e.target.value)} placeholder="If we…, then…, because…" /></Field>
      <button className="primary" onClick={create} data-testid="scenario-create">Branch scenario</button>
    </div>
  );

  if (branch.kind === 'baseline') {
    return (
      <div data-testid="scenario-panel">
        <p className="quiet-caption">A scenario is a private copy of the map pinned to the baseline as it is right now. Editing it never changes the baseline or its evidence.</p>
        <ul className="plainlist">{scenarios.map((s) => <li key={s.id}><button className="rowbtn" onClick={() => loadBranch(s.id).catch(fail)}><span>{s.name}</span><em>{s.parentBranchId ? `from ${branches.find((b) => b.id === s.parentBranchId)?.name}` : 'from baseline'} · {s.status.replace('_', ' ')}</em></button></li>)}{!scenarios.length && <li className="micro">No scenarios yet.</li>}</ul>
        {creator}
      </div>
    );
  }
  return (
    <div data-testid="scenario-panel">
      <Field label="Scenario"><input value={branch.name} disabled={ro} onChange={(e) => setState((s) => ({ branches: s.branches.map((b) => (b.id === branchId ? { ...b, name: e.target.value } : b)) }))} onBlur={(e) => meta({ name: e.target.value || 'Scenario' })} /></Field>
      <Field label="Hypothesis"><textarea rows={2} defaultValue={branch.hypothesis} disabled={ro} onBlur={(e) => meta({ hypothesis: e.target.value })} /></Field>
      <div className="lineage" data-testid="lineage">
        <b>Lineage</b>
        <ol>{lineage.map((l) => <li key={l.revisionId}>{l.relation}: {l.branchName}, revision {l.seq} <em>({l.createdAt.slice(0, 10)}, pinned)</em></li>)}</ol>
      </div>
      <div className="row2">
        <Field label="Compare with"><select value={compareTo ?? ''} data-testid="compare-select" onChange={(e) => setCompare(e.target.value).catch(fail)}>{lineage.map((l) => <option key={l.revisionId} value={l.revisionId}>{l.relation === 'original baseline' ? 'Original baseline' : l.relation === 'parent' ? `Parent: ${l.branchName}` : l.branchName} (rev {l.seq})</option>)}</select></Field>
        <Field label="Review status"><select value={branch.status} disabled={ro} onChange={(e) => meta({ status: e.target.value })}><option value="draft">Draft</option><option value="in_review">In review</option><option value="reviewed">Reviewed</option></select></Field>
      </div>
      <div className="tabs" role="tablist">{(['changes', 'impact', 'people', 'evidence'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)} data-testid={`tab-${t}`}>{t === 'people' ? 'People & guardrails' : t[0].toUpperCase() + t.slice(1)}{t === 'evidence' && historical.length ? ` (${historical.length})` : ''}</button>)}</div>
      {!compareModel ? <p className="micro">Loading comparison…</p> : tab === 'changes' ? <Changes base={compareModel} model={model} /> : tab === 'impact' ? <Impact base={compareModel} model={model} /> : tab === 'people' ? <People base={compareModel} model={model} /> : (
        <div data-testid="scenario-evidence">
          <p className="micro">Evidence stays attached to the baseline. Notes whose target was removed in this scenario are shown here as historical, never deleted or re-pointed.</p>
          {historical.map((n) => <NoteCard key={n.id} note={n} />)}
          {!historical.length && <p className="micro">Every attached note still has its target in this scenario.</p>}
        </div>
      )}
      {!ro && <div className="adopt-row"><AdoptButton name={branch.name} /><p className="micro">Makes this the main map. The current main map stays in its history.</p></div>}
      {creator}
      {!ro && <div className="lens-danger"><button className="danger" onClick={async () => { if (!confirm(`Delete scenario “${branch.name}”? The baseline is not affected.`)) return; try { await del(`/projects/${project.id}/branches/${branchId}`); setState((s) => ({ branches: s.branches.filter((b) => b.id !== branchId) })); await loadBranch('baseline'); void getState(); } catch (e) { fail(e); } }}>Delete scenario</button></div>}
    </div>
  );
}
