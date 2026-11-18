// Insights: captured on the map (Insight button, tap the boxes it is about, write the thought), and reviewed on the
// Insights page with the linked items, the details picked within them, the evidence, and suggested supporting data.
import { useEffect, useState } from 'react';
import { canEdit, cancelInsight, createDoc, createScenario, deleteDocById, editInsightDraft, fail, finishInsight, getState, goToTarget, openModal, setNav, showOnMap, startInsight, toast, updateDoc, useStore, type V } from './store';
import { jumpTo, targetOptions } from './Capture';
import { Empty, when } from './ui';
import { EVIDENCE_LEVEL_LABEL, evidenceFor, insightTitle, itemFacts, notesForInsight, suggestSupport, terms, type Suggestion } from '../shared/evidence';
import { RELATIONS, RELATION_LABEL, type Insight } from '../shared/workspace';

// ---- capture on the map ------------------------------------------------------------------------------
async function save() { try { await finishInsight(); } catch (e) { fail(e); } }

/** Starts capture; pressed again it saves what was picked or written, or just closes when there is nothing. */
export function InsightButton() {
  const draft = useStore((s) => s.insightDraft);
  const has = !!draft && (!!draft.text.trim() || draft.picks.length > 0);
  return (
    <button className={`insight-btn${draft ? ' active' : ''}`} aria-pressed={!!draft} data-testid="insight-mode" onClick={() => (draft ? void save() : startInsight())}>
      ✦ {draft ? (has ? 'Save insight' : 'Cancel') : 'Insight'}
    </button>
  );
}

/** The text box under the map buttons while an insight is captured. The map itself shows the picks. */
export function InsightBar() {
  const draft = useStore((s) => s.insightDraft)!;
  useEffect(() => {
    // Escape (and the Android Back button, which sends Escape) leaves capture without saving.
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !getState().modal) cancelInsight(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  const n = draft.picks.length;
  return (
    <div className="insight-bar" data-back-closes="" role="group" aria-label="New insight" data-testid="insight-bar">
      <input type="text" value={draft.text} placeholder="What is the insight? Enter saves it" aria-label="Insight text" enterKeyHint="done" data-testid="insight-text"
        onChange={(e) => editInsightDraft({ text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }} />
      <p className="micro" data-testid="insight-pick-count">{n ? `${n} box${n === 1 ? '' : 'es'} linked. Tap a box again to unlink it.` : 'Tap the boxes on the map that this insight is about.'}</p>
    </div>
  );
}

/** On the map, while it shows the items behind one insight. */
export function SpotlightBanner() {
  const spotlight = useStore((s) => s.spotlight), insight = useStore((s) => s.evidence.insights.find((i) => i.id === s.spotlight));
  if (!spotlight || !insight) return null;
  return (
    <div className="banner info" data-testid="spotlight-banner">
      <span className="banner-text">Showing the items behind <b>{insightTitle(insight)}</b>. Other items are faded.</span>
      <span><button className="linkbtn" onClick={() => { showOnMap(null); jumpTo('insight', insight.id); }}>Back to the insight</button><button className="linkbtn" onClick={() => showOnMap(null)}>Done</button></span>
    </div>
  );
}

// ---- the Insights page -------------------------------------------------------------------------------
function Marked({ text, matched }: { text: string; matched: string[] }) {
  const want = new Set(matched);
  return <>{text.split(/([A-Za-z]{4,})/).map((part, i) => ([...terms(part)].some((t) => want.has(t)) ? <mark key={i}>{part}</mark> : part))}</>;
}

function LinkedItem({ insight, id }: { insight: V<Insight>; id: string }) {
  const model = useStore((s) => s.model)!, notes = useStore((s) => s.evidence.notes), links = useStore((s) => s.evidence.links);
  const ro = !canEdit(), f = itemFacts(model, id), focus = insight.focus[id] ?? [];
  const unlink = () => { const rest = { ...insight.focus }; delete rest[id]; return updateDoc('insights', insight.id, { modelLinks: insight.modelLinks.filter((x) => x !== id), focus: rest }).catch(fail); };
  if (!f) return (
    <div className="linked-item historical" data-testid="linked-item"><div className="linked-item-head"><small>Not on this version of the map</small><b>{id}</b>{!ro && <button className="linkbtn danger" onClick={unlink}>Remove</button>}</div></div>
  );
  const toggle = (key: string) => {
    const next = focus.includes(key) ? focus.filter((k) => k !== key) : [...focus, key];
    const all = { ...insight.focus, [id]: next };
    if (!next.length) delete all[id];
    updateDoc('insights', insight.id, { focus: all }).catch(fail);
  };
  const linkedNotes = new Set(notesForInsight(insight.id, notes, links).map((l) => l.note.id));
  const onItem = notes.filter((n) => n.targetId === id);
  const row = (fact: (typeof f.facts)[number], on: boolean) => (
    <div key={fact.key} className={`fact${on ? ' on' : ''}`} data-fact={fact.key}>
      <dt>{fact.label}</dt><dd>{fact.value}</dd>
      {!ro && <button className="iconbtn star" aria-pressed={on} aria-label={on ? `Stop highlighting ${fact.label}` : `Highlight ${fact.label} for this insight`} onClick={() => toggle(fact.key)}>{on ? '★' : '☆'}</button>}
    </div>
  );
  return (
    <div className="linked-item" data-item={id} data-testid="linked-item">
      <div className="linked-item-head"><small>{f.kind}</small><b>{f.name}</b>
        <span className="spacer" /><button className="linkbtn" onClick={() => goToTarget(id)}>Open</button>{!ro && <button className="linkbtn danger" aria-label={`Unlink ${f.name}`} onClick={unlink}>Unlink</button>}
      </div>
      {focus.length ? <dl className="facts">{f.facts.filter((x) => focus.includes(x.key)).map((x) => row(x, true))}</dl>
        : <p className="micro">About the whole item.{!ro && ' Star the details this insight is about.'}</p>}
      <details className="plain"><summary>{focus.length ? 'Other details' : 'Details'} ({f.facts.filter((x) => !focus.includes(x.key)).length})</summary>
        <dl className="facts">{f.facts.filter((x) => !focus.includes(x.key)).map((x) => row(x, false))}</dl>
      </details>
      {onItem.length > 0 && (
        <div className="item-notes"><small>Notes on this item</small>
          <ul>{onItem.map((n) => (
            <li key={n.id}><button className="linkbtn" onClick={() => jumpTo('note', n.id)}>{n.text.slice(0, 140)}</button>
              {linkedNotes.has(n.id) ? <span className="chip ok">Evidence</span> : !ro && <button className="linkbtn" data-testid="use-as-evidence" onClick={() => createDoc('links', { fromType: 'insight', fromId: insight.id, toType: 'note', toId: n.id, relation: 'supports' }).catch(fail)}>Use as evidence</button>}
            </li>
          ))}</ul>
        </div>
      )}
    </div>
  );
}

function Suggestions({ insight, text }: { insight: V<Insight>; text: string }) {
  const model = useStore((s) => s.model)!, notes = useStore((s) => s.evidence.notes), links = useStore((s) => s.evidence.links);
  const [list, setList] = useState<Suggestion[] | null>(null);
  const find = () => setList(suggestSupport(text, notes, model, new Set(notesForInsight(insight.id, notes, links).map((l) => l.note.id)), new Set(insight.modelLinks)));
  const drop = (s: Suggestion) => setList((l) => l && l.filter((x) => x !== s));
  const accept = async (s: Suggestion) => {
    try {
      if (s.type === 'note') await createDoc('links', { fromType: 'insight', fromId: insight.id, toType: 'note', toId: s.id, relation: 'supports' });
      else await updateDoc('insights', insight.id, { modelLinks: [...insight.modelLinks, s.id] });
      drop(s); toast('Linked to the insight');
    } catch (e) { fail(e); }
  };
  return (
    <section className="insight-section">
      <h4>Possible supporting data</h4>
      {list === null ? <button onClick={find} data-testid="find-support">Find supporting data</button> : (
        <>
          <p className="micro">Notes and map items that share words with this insight. A word match, not a judgement: check each one before you link it.</p>
          {!list.length && <p className="micro">Nothing else shares its key words.</p>}
          <ul className="suggestions">{list.map((s) => (
            <li key={`${s.type}:${s.id}`} data-testid="suggestion">
              <span className="chip">{s.type === 'note' ? 'Note' : 'Map item'}</span>
              <span className="sug-text"><Marked text={s.text.slice(0, 220)} matched={s.matched} /></span>
              {canEdit() && <span className="btnrow"><button onClick={() => accept(s)} data-testid="suggestion-link">Link</button><button className="linkbtn" onClick={() => drop(s)}>Dismiss</button></span>}
            </li>
          ))}</ul>
        </>
      )}
    </section>
  );
}

function InsightCard({ insight }: { insight: V<Insight> }) {
  const notes = useStore((s) => s.evidence.notes), links = useStore((s) => s.evidence.links), sources = useStore((s) => s.evidence.sources), opportunities = useStore((s) => s.evidence.opportunities);
  const [title, setTitle] = useState(insight.title), [body, setBody] = useState(insight.body), [busy, setBusy] = useState(false);
  const linked = notesForInsight(insight.id, notes, links);
  const ev = evidenceFor([insight.id], [], notes, links);
  const dirty = title !== insight.title || body !== insight.body;
  const ro = !canEdit();
  const saveText = async () => { setBusy(true); try { await updateDoc('insights', insight.id, { title, body }); toast('Insight saved'); } catch (e) { fail(e); } finally { setBusy(false); } };
  const toOpportunity = async () => {
    try { const o = await createDoc('opportunities', { title: insightTitle({ ...insight, title, body }), insightIds: [insight.id], targetIds: insight.modelLinks }); setNav('decide'); setTimeout(() => document.querySelector(`[data-opportunity="${o.id}"]`)?.scrollIntoView({ block: 'start' }), 80); toast('Opportunity created from this insight'); } catch (e) { fail(e); }
  };
  return (
    <article className="insight" data-insight={insight.id} data-testid="insight">
      <header className="insight-head">
        <span className={`chip ev-${ev.level}`} data-testid="insight-evidence">{EVIDENCE_LEVEL_LABEL[ev.level]}</span>
        <span className="micro">{insight.modelLinks.length} linked item{insight.modelLinks.length === 1 ? '' : 's'} · {linked.length} note{linked.length === 1 ? '' : 's'} · updated {when(insight.updatedAt)}</span>
      </header>
      <input className="insight-title" value={title} disabled={ro} placeholder="Title (optional)" aria-label="Insight title" onChange={(e) => setTitle(e.target.value)} />
      <textarea className="insight-body" rows={3} value={body} disabled={ro} placeholder="Write the thought as it is. No source, category or template needed." aria-label="Insight text" data-testid="insight-body" onChange={(e) => setBody(e.target.value)} />
      {!ro && dirty && <div className="btnrow"><button className="primary" disabled={busy} onClick={saveText} data-testid="insight-save">Save changes</button><button className="linkbtn" onClick={() => { setTitle(insight.title); setBody(insight.body); }}>Discard</button></div>}

      <section className="insight-section">
        <h4>Linked map items {insight.modelLinks.length > 0 && <button className="linkbtn" onClick={() => showOnMap(insight.id)} data-testid="show-on-map">Show on map</button>}</h4>
        {!insight.modelLinks.length && <p className="micro">Not linked to the map. That is fine for an early thought.</p>}
        <div className="linked-items" data-testid="insight-model-links">{insight.modelLinks.map((id) => <LinkedItem key={id} insight={insight} id={id} />)}</div>
        {!ro && <select value="" aria-label="Link this insight to a map item" className="inline-select" onChange={(e) => e.target.value && updateDoc('insights', insight.id, { modelLinks: [...insight.modelLinks, e.target.value] }).catch(fail)}><option value="">Link another map item…</option>{targetOptions().filter((o) => !insight.modelLinks.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
      </section>

      <section className="insight-section">
        <h4>Evidence</h4>
        {!linked.length && <p className="micro">No notes linked yet.</p>}
        <ul className="evlist">
          {linked.map((l) => (
            <li key={l.linkId} data-relation={l.relation} data-testid="insight-link">
              {ro ? <span className={`rel rel-${l.relation}`}>{RELATION_LABEL[l.relation]}</span> : (
                <select value={l.relation} aria-label="Relation" className={`rel rel-${l.relation}`} onChange={(e) => updateDoc('links', l.linkId, { relation: e.target.value }).catch(fail)}>{RELATIONS.map((r) => <option key={r} value={r}>{RELATION_LABEL[r]}</option>)}</select>
              )}
              <button className="linkbtn" onClick={() => jumpTo('note', l.note.id)} data-testid="insight-note-link">{l.note.text.slice(0, 110)}</button>
              <em>{sources.find((s) => s.id === l.note.sourceId)?.anonId ?? 'no source'}{l.note.certainty ? ` · ${l.note.certainty}` : ''}</em>
              {!ro && <button className="linkbtn danger" aria-label="Detach this note" data-testid="detach" onClick={() => deleteDocById('links', l.linkId).catch(fail)}>Detach</button>}
            </li>
          ))}
        </ul>
        {ev.gaps.length > 0 && linked.length > 0 && <ul className="gaplist">{ev.gaps.map((g) => <li key={g}>{g}</li>)}</ul>}
        {!ro && <button onClick={() => openModal('link', { fromType: 'insight', fromId: insight.id })} data-testid="insight-attach">Attach evidence</button>}
      </section>

      <Suggestions insight={insight} text={`${title} ${body}`} />

      {opportunities.filter((o) => o.insightIds.includes(insight.id)).map((o) => <p key={o.id} className="micro">Used in opportunity: <button className="linkbtn" onClick={() => setNav('decide')}>{o.title}</button></p>)}
      {!ro && <footer className="btnrow insight-actions">
        <button onClick={toOpportunity} data-testid="insight-to-opportunity">Create opportunity</button>
        <button onClick={() => createScenario(`Test: ${insightTitle({ ...insight, title, body }).slice(0, 60)}`, { fromBranchId: 'baseline', hypothesis: body, origin: { type: 'insight', id: insight.id } }).then(() => toast('Scenario branched from this insight')).catch(fail)} data-testid="insight-to-scenario">Test in a scenario</button>
        <button onClick={() => openModal('deep', { insightId: insight.id })}>Deep research…</button>
        <button className="linkbtn danger" onClick={async () => { if (confirm('Delete this insight? Notes linked to it are kept.')) await deleteDocById('insights', insight.id).catch(fail); }}>Delete</button>
      </footer>}
    </article>
  );
}

export function Insights() {
  const insights = useStore((s) => s.evidence.insights), notes = useStore((s) => s.evidence.notes), links = useStore((s) => s.evidence.links);
  const levels = insights.map((i) => evidenceFor([i.id], [], notes, links).level);
  const count = (l: string) => levels.filter((x) => x === l).length;
  return (
    <div className="page" data-testid="insights">
      <header className="page-head"><div><h1>Insights</h1><p>Working interpretations, with the map items and details each one is about and the evidence behind it.</p></div>
        {canEdit() && <button className="primary" onClick={startInsight} data-testid="insight-start">✦ New insight on the map</button>}</header>
      {insights.length > 0 && <p className="insight-summary micro">{insights.length} insight{insights.length === 1 ? '' : 's'} · {count('supported')} with several supporting sources · {count('thin')} thin · {count('contested')} contested · {count('none')} without evidence</p>}
      {!insights.length && <Empty title="No insights yet">On the map, press ✦ Insight, tap the boxes the insight is about, then write it and press Enter. An insight can also be text only.</Empty>}
      <div className="insights">{[...insights].reverse().map((i) => <InsightCard key={i.id} insight={i} />)}</div>
    </div>
  );
}
