// Opportunity register, option comparison and the recommendation, with observations, interpretation and gaps kept apart.
import { useState } from 'react';
import { canEdit, createDoc, createScenario, deleteDocById, fail, loadBranch, setNav, setState, toast, updateDoc, useStore, type V } from './store';
import { jumpTo } from './Capture';
import { Empty, Field } from './ui';
import { decisionHeading, EVIDENCE_LEVEL_LABEL, evidenceForOpportunity, insightTitle } from '../shared/evidence';
import { DECISION_STATES, OPTION_KINDS, OPTION_KIND_LABEL, RELATION_LABEL, type DecisionOption, type Opportunity } from '../shared/workspace';

const CRITERIA: [keyof Opportunity['criteria'], string, string][] = [['evidenceStrength', 'Evidence strength', '5 = strong'], ['expectedValue', 'Expected value', '5 = high'], ['effort', 'Effort', '5 = heavy'], ['humanRisk', 'Human risk', '5 = high']];
const STATE_LABEL: Record<string, string> = { exploring: 'Exploring', hypothesis: 'Hypothesis to test', recommended: 'Recommended', deferred: 'Deferred', closed: 'Closed' };
const OPTION_FIELDS: [keyof DecisionOption, string][] = [['benefits', 'Benefits'], ['downsides', 'Downsides and human costs'], ['shiftedWork', 'Added or shifted work, and for whom'], ['effort', 'Implementation effort'], ['costs', 'Costs'], ['tradeoffs', 'Tradeoffs'], ['unknowns', 'Unknowns and assumptions'], ['test', 'What to test']];

function Text({ value, onSave, label, rows = 2, testid, hint }: { value: string; onSave: (v: string) => void; label: string; rows?: number; testid?: string; hint?: string }) {
  const [v, setV] = useState(value);
  return <Field label={label} hint={hint}><textarea rows={rows} value={v} disabled={!canEdit()} data-testid={testid} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} /></Field>;
}

function OptionColumn({ o, opp }: { o: V<DecisionOption>; opp: V<Opportunity> }) {
  const branches = useStore((s) => s.branches);
  const ro = !canEdit();
  const save = (patch: Record<string, unknown>) => updateDoc('options', o.id, patch).catch(fail);
  const chosen = opp.recommendedOptionId === o.id;
  const sc = branches.find((b) => b.id === o.scenarioBranchId);
  const [title, setTitle] = useState(o.title);
  return (
    <div className={`option${chosen ? ' chosen' : ''}`} data-option={o.id} data-kind={o.kind}>
      <small>{OPTION_KIND_LABEL[o.kind]}</small>
      <input className="option-title" value={title} disabled={ro} aria-label="Option title" onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== o.title && save({ title: title || 'Option' })} />
      {OPTION_FIELDS.map(([k, label]) => <Text key={k} label={label} value={String(o[k] ?? '')} testid={`opt-${k}`} onSave={(v) => save({ [k]: v })} />)}
      <Field label="Confidence"><select value={o.confidence} disabled={ro} onChange={(e) => save({ confidence: e.target.value })}>{['unknown', 'low', 'medium', 'high'].map((c) => <option key={c}>{c}</option>)}</select></Field>
      <label className="check"><input type="checkbox" checked={o.smallestReversible} disabled={ro} data-testid="opt-smallest" onChange={(e) => save({ smallestReversible: e.target.checked })} /> Smallest reversible change</label>
      <label className="check"><input type="checkbox" checked={o.withinPilotScope} disabled={ro} onChange={(e) => save({ withinPilotScope: e.target.checked })} /> Within the pilot’s recommendation scope</label>
      {!o.withinPilotScope && <p className="micro warn">Exploratory: broader than a focused improvement to the existing structure.</p>}
      <div className="btnrow">
        {sc ? <button onClick={() => loadBranch(sc.id).then(() => setState({ nav: 'map', mode: 'scenario' })).catch(fail)} data-testid="opt-open-scenario">Open scenario “{sc.name}”</button>
          : !ro && o.kind !== 'status_quo' && <button data-testid="opt-scenario" onClick={async () => { try { const b = await createScenario(o.title, { fromBranchId: 'baseline', hypothesis: o.benefits, origin: { type: 'option', id: o.id } }); await updateDoc('options', o.id, { scenarioBranchId: b.id }); toast('Scenario branched for this option'); } catch (e) { fail(e); } }}>Test in a scenario</button>}
        {!ro && <button className={chosen ? '' : 'primary'} data-testid="opt-recommend" onClick={() => updateDoc('opportunities', opp.id, { recommendedOptionId: chosen ? null : o.id, citedRevisions: !chosen && sc ? { ...opp.citedRevisions, [sc.id]: sc.headRevisionId } : opp.citedRevisions }).catch(fail)}>{chosen ? 'Selected ✓ (undo)' : 'Select this option'}</button>}
        {!ro && <button className="linkbtn danger" onClick={() => confirm('Remove this option?') && deleteDocById('options', o.id).catch(fail)}>Remove</button>}
      </div>
    </div>
  );
}

function OpportunityDetail({ o }: { o: V<Opportunity> }) {
  const ev0 = useStore((s) => s.evidence), branches = useStore((s) => s.branches);
  const ev = evidenceForOpportunity(o, ev0.notes, ev0.links);
  const options = ev0.options.filter((x) => x.opportunityId === o.id);
  const chosen = options.find((x) => x.id === o.recommendedOptionId);
  const ro = !canEdit();
  const save = (patch: Record<string, unknown>) => updateDoc('opportunities', o.id, patch).catch(fail);
  const heading = decisionHeading(o, chosen, ev);
  const isHyp = heading === 'Hypothesis to test';
  const sc = chosen?.scenarioBranchId ? branches.find((b) => b.id === chosen.scenarioBranchId) : null;
  const stale = !!sc && !!o.citedRevisions[sc.id] && o.citedRevisions[sc.id] !== sc.headRevisionId;
  const src = (id: string | null) => ev0.sources.find((s) => s.id === id)?.anonId ?? 'no source';
  const [title, setTitle] = useState(o.title);
  const obs = (list: typeof ev.supporting, empty: string) => list.length ? <ul className="evlist">{list.map((l) => <li key={l.note.id + l.via} data-relation={l.relation}><span className={`rel rel-${l.relation}`}>{RELATION_LABEL[l.relation]}</span><button className="linkbtn" onClick={() => jumpTo('note', l.note.id)}>{l.note.text.slice(0, 140)}</button><em>{l.note.kind}{l.note.certainty ? `, ${l.note.certainty}` : ''} · {src(l.note.sourceId)}</em></li>)}</ul> : <p className="micro">{empty}</p>;

  return (
    <article className="opportunity" data-opportunity={o.id} data-testid="opportunity">
      <header>
        <input className="opp-title" value={title} disabled={ro} aria-label="Opportunity title" onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== o.title && save({ title: title || 'Opportunity' })} />
        <span className={`chip ${isHyp || chosen?.withinPilotScope === false ? 'warnchip' : 'ok'}`} data-testid="opp-heading">{heading}</span>
        <span className={`chip ev-${ev.level}`} data-testid="opp-evidence">{EVIDENCE_LEVEL_LABEL[ev.level]}</span>
      </header>
      {isHyp && <p className="alert warn" data-testid="hypothesis-banner">This is a hypothesis to test. {ev.gaps[0]}</p>}
      {stale && <p className="alert warn" data-testid="stale-banner">The scenario behind this recommendation changed after it was selected. Review the figures, then <button className="linkbtn" onClick={() => save({ citedRevisions: { ...o.citedRevisions, [sc!.id]: sc!.headRevisionId } })}>mark as reviewed</button>.</p>}

      <div className="triad">
        <section data-testid="col-observations"><h4>Observations</h4><p className="micro">What was seen or reported, with its source.</p>
          {obs(ev.supporting, 'No supporting observation is linked.')}{ev.contradicting.length > 0 && obs(ev.contradicting, '')}{ev.other.length > 0 && obs(ev.other, '')}
        </section>
        <section data-testid="col-interpretation"><h4>Interpretation</h4><p className="micro">What the researcher makes of it.</p>
          <ul className="evlist">{o.insightIds.map((id) => { const i = ev0.insights.find((x) => x.id === id); return i && <li key={id}><button className="linkbtn" onClick={() => jumpTo('insight', id)}>{insightTitle(i)}</button>{!ro && <button className="linkbtn danger" onClick={() => save({ insightIds: o.insightIds.filter((x) => x !== id) })}>remove</button>}</li>; })}</ul>
          {!ro && <select value="" aria-label="Cite an insight" data-testid="opp-add-insight" onChange={(e) => e.target.value && save({ insightIds: [...o.insightIds, e.target.value] })}><option value="">Cite an insight…</option>{ev0.insights.filter((i) => !o.insightIds.includes(i.id)).map((i) => <option key={i.id} value={i.id}>{insightTitle(i)}</option>)}</select>}
          <Text label="Title for the leadership exports" value={o.reportTitle ?? ''} testid="opp-report-title" onSave={(v) => save({ reportTitle: v })} hint="Leave blank to use a numbered heading. The workspace title stays private." />
          <Text label="Interpretation for this decision" value={o.interpretation} testid="opp-interpretation" onSave={(v) => save({ interpretation: v })} hint="Write the summary you intend leadership to see. Linked insight drafts stay in the research workspace." />
        </section>
        <section data-testid="col-gaps"><h4>Gaps</h4><p className="micro">What is not yet known.</p>
          <p className="micro">{ev.sourceCount} linked supporting {ev.sourceCount === 1 ? 'source' : 'sources'}</p>
          <ul className="gaplist">{ev.gaps.map((g) => <li key={g}>{g}</li>)}{!ev.gaps.length && <li className="micro">Review how well the linked evidence supports the interpretation.</li>}</ul>
          <Text label="Remaining uncertainty" value={o.uncertainty} testid="opp-uncertainty" onSave={(v) => save({ uncertainty: v })} />
        </section>
      </div>

      <div className="row2">
        <Text label="What already works and deserves protection" value={o.preserve} testid="opp-preserve" onSave={(v) => save({ preserve: v })} />
        <Text label="Whose working day changes" hint="Roles, not names. Review any shift in responsibility with the people affected." value={o.stakeholders} testid="opp-stakeholders" onSave={(v) => save({ stakeholders: v })} />
      </div>

      <h4>Options compared</h4>
      <div className="options" data-testid="options">{options.map((x) => <OptionColumn key={x.id} o={x} opp={o} />)}</div>
      {!ro && <div className="btnrow" data-testid="add-options">{OPTION_KINDS.map((k) => <button key={k} data-add-option={k} onClick={() => createDoc('options', { opportunityId: o.id, kind: k, title: OPTION_KIND_LABEL[k] }).catch(fail)}>+ {OPTION_KIND_LABEL[k]}</button>)}</div>}

      <div className="row2">
        <Text label="Validation plan" value={o.validationPlan} rows={3} testid="opp-validation" onSave={(v) => save({ validationPlan: v })} />
        <div>
          <Field label="Decision state"><select value={o.decisionState} disabled={ro} data-testid="opp-state" onChange={(e) => save({ decisionState: e.target.value })}>{DECISION_STATES.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}</select></Field>
          {o.decisionState === 'closed' && <Text label="Reason for closing (a reviewer can reopen)" value={o.closeReason} onSave={(v) => save({ closeReason: v })} />}
          <div className="criteria">{CRITERIA.map(([k, label, hint]) => <Field key={k} label={label} hint={hint}><select value={o.criteria[k] ?? ''} disabled={ro} data-criterion={k} onChange={(e) => save({ criteria: { ...o.criteria, [k]: e.target.value === '' ? null : Number(e.target.value) } })}><option value="">Not rated</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>)}</div>
        </div>
      </div>
      <Text label="Internal working notes (never exported)" value={o.internalNotes} testid="opp-internal" onSave={(v) => save({ internalNotes: v })} />
      {!ro && <div className="lens-danger"><button className="linkbtn danger" onClick={() => confirm('Delete this opportunity and its options?') && deleteDocById('opportunities', o.id).catch(fail)}>Delete opportunity</button></div>}
    </article>
  );
}

export function Decide() {
  const ev = useStore((s) => s.evidence);
  const [sort, setSort] = useState<'rank' | keyof Opportunity['criteria']>('rank'), [open, setOpen] = useState<string | null>(null), [title, setTitle] = useState('');
  const dir = sort === 'effort' || sort === 'humanRisk' ? 1 : -1; // low effort and low risk first; high evidence and value first
  const list = [...ev.opportunities].sort((a, b) => sort === 'rank' ? (a.rank ?? 999) - (b.rank ?? 999) : dir * ((a.criteria[sort] ?? (dir > 0 ? 9 : 0)) - (b.criteria[sort] ?? (dir > 0 ? 9 : 0))));
  const current = list.find((o) => o.id === open) ?? list[0];
  const move = async (id: string, by: number) => {
    const order = list.map((o) => o.id), i = order.indexOf(id), j = i + by;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    try { for (let k = 0; k < order.length; k++) { const o = ev.opportunities.find((x) => x.id === order[k])!; if (o.rank !== k + 1) await updateDoc('opportunities', o.id, { rank: k + 1 }); } } catch (e) { fail(e); }
  };
  return (
    <div className="page" data-testid="decide">
      <header className="page-head"><div><h1>Opportunities and decisions</h1><p>Favor the smallest reversible improvement that strengthens how the work already runs. You choose the priority; sorting is only an aid.</p></div><button onClick={() => setNav('report')}>Preview brief</button></header>
      {canEdit() && <div className="capture-row add-opp"><input value={title} placeholder="New opportunity (or create one from an insight)" aria-label="New opportunity title" data-testid="opp-new" onChange={(e) => setTitle(e.target.value)} /><button className="primary" disabled={!title.trim()} data-testid="opp-add" onClick={async () => { try { const o = await createDoc('opportunities', { title: title.trim() }); setTitle(''); setOpen(o.id); } catch (e) { fail(e); } }}>Add opportunity</button></div>}
      {!list.length ? <Empty title="No opportunities yet">Create one from an insight, or add a blank hypothesis above.</Empty> : (
        <>
          <table className="register" data-testid="register">
            <thead><tr><th><button className="linkbtn" onClick={() => setSort('rank')}>Priority{sort === 'rank' ? ' ▾' : ''}</button></th><th>Opportunity</th><th>Status</th><th>Evidence</th>{CRITERIA.map(([k, label]) => <th key={k}><button className="linkbtn" data-sort={k} onClick={() => setSort(k)}>{label}{sort === k ? ' ▾' : ''}</button></th>)}<th>Selected option</th></tr></thead>
            <tbody>{list.map((o, i) => { const e = evidenceForOpportunity(o, ev.notes, ev.links), opt = ev.options.find((x) => x.id === o.recommendedOptionId); return (
              <tr key={o.id} className={current?.id === o.id ? 'current' : ''} data-row={o.id}>
                <td>{sort === 'rank' && canEdit() ? <><button className="iconbtn" aria-label="Move up" onClick={() => move(o.id, -1)}>↑</button><button className="iconbtn" aria-label="Move down" onClick={() => move(o.id, 1)}>↓</button></> : i + 1}</td>
                <td><button className="linkbtn strong" onClick={() => setOpen(o.id)}>{o.title}</button></td><td>{decisionHeading(o, opt, e)}</td><td><span className={`chip ev-${e.level}`}>{EVIDENCE_LEVEL_LABEL[e.level]}</span></td>
                {CRITERIA.map(([k]) => <td key={k}>{o.criteria[k] ?? '—'}</td>)}<td>{opt ? `${opt.title}${opt.smallestReversible ? ' · smallest reversible' : ''}` : '—'}</td>
              </tr>); })}</tbody>
          </table>
          {current && <OpportunityDetail key={current.id} o={current} />}
        </>
      )}
    </div>
  );
}
