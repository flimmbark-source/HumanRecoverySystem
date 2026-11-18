// Insights: the researcher's thoughts, each a compact box that opens onto the map cards it is about, with the
// details picked on those cards. A box opens the map for its insight; there the details panel picks more details.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addPendingToInsight, canEdit, cancelInsight, createDoc, createScenario, deleteDocById, editInsightDraft, editInsightsUi, endInsightCtx, fail, finishInsight, getState, openInsightOnMap, openModal, restoreInsightsScroll, setNav, setState, startInsight, toast, togglePending, updateDoc, useStore, type V } from './store';
import { jumpTo, targetOptions } from './Capture';
import { EdgeLabelBox, NodeBox, TYPE_COLOR, DASH } from './Graph';
import { Empty, Field } from './ui';
import { EVIDENCE_LEVEL_LABEL, evidenceFor, insightTitle, itemFacts, notesForInsight, suggestSupport, terms, type Suggestion } from '../shared/evidence';
import { EDGE_TYPES, type Model } from '../shared/model';
import { NODE_H, labelWidth, nodeW } from '../shared/layout';
import { RELATIONS, RELATION_LABEL, type Insight } from '../shared/workspace';

const thought = (i: Pick<Insight, 'title' | 'body'>) => i.body.trim() || i.title.trim() || 'Untitled insight';
const NOTE = 'note:';

// ---- capture on the map ------------------------------------------------------------------------------
async function save() { try { await finishInsight(); } catch (e) { fail(e); } }

/** Starts capture; pressed again it saves what was picked or written, or just closes when there is nothing. */
export function InsightButton() {
  const draft = useStore((s) => s.insightDraft), ctx = useStore((s) => s.insightCtx);
  const has = !!draft && (!!draft.text.trim() || draft.picks.length > 0);
  if (ctx) return null;
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

// ---- the map opened for one insight -----------------------------------------------------------------
/** One floating button: Back to insight, or, with details picked, Add to insight. */
export function InsightCtxButton() {
  const ctx = useStore((s) => s.insightCtx), sheet = useStore((s) => s.inspectorOpen);
  useEffect(() => {
    // Escape and the Android Back button: an open details sheet on a phone closes first, then the mode ends.
    const key = (e: KeyboardEvent) => {
      const s = getState();
      if (e.key !== 'Escape' || !s.insightCtx || s.modal || s.linkFrom || s.placing || s.insightDraft) return;
      e.stopPropagation();
      if (s.inspectorOpen && window.innerWidth <= 990) setState({ inspectorOpen: false });
      else endInsightCtx();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, []);
  if (!ctx) return null;
  const n = ctx.pending.length;
  return (
    <button className={`insight-fab${n ? ' add' : ''}${sheet ? ' over-sheet' : ''}`} data-back-closes="" data-testid="insight-fab" data-state={n ? 'add' : 'back'}
      onClick={() => (n ? void addPendingToInsight().catch(fail) : endInsightCtx())}>
      {n ? `✦ Add to insight (${n})` : '← Back to insight'}
    </button>
  );
}

/** True while the map is open for an insight. */
export const useInsightCtx = () => useStore((s) => !!s.insightCtx);

/**
 * A recorded field or note in the details panel. While the map is open for an insight it is highlighted where it is
 * shown: tapping it (or its ✦) selects it for the insight. Otherwise it renders its content unchanged.
 */
export function Pick({ item, k, label, inline, children }: { item: string; k: string; label: string; inline?: boolean; children: React.ReactNode }) {
  const on = useStore((s) => !!s.insightCtx);
  const added = useStore((s) => !!s.insightCtx && (s.evidence.insights.find((i) => i.id === s.insightCtx!.id)?.focus[item] ?? []).includes(k));
  const picked = useStore((s) => !!s.insightCtx?.pending.some((p) => p.item === item && p.key === k));
  if (!on) return <>{children}</>;
  const toggle = () => { if (!added && canEdit()) togglePending(item, k); };
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag className={`pickable${inline ? ' inline' : ''}${picked ? ' picked' : ''}${added ? ' added' : ''}`} data-pick={k}
      onClick={(e) => { const hit = (e.target as HTMLElement).closest('button,a,input,select,textarea,summary,label'); if (hit && e.currentTarget.contains(hit)) return; toggle(); }}>
      {children}
      <button type="button" className="pick-mark" aria-pressed={picked} disabled={added || !canEdit()} data-testid="pick-mark"
        aria-label={added ? `${label} is on the insight's card` : picked ? `Unselect ${label}` : `Select ${label} for the insight`}
        onClick={(e) => { e.stopPropagation(); toggle(); }}>{added ? '✓' : '✦'}</button>
    </Tag>
  );
}

/** At the top of the details panel while the map is open for an insight: the thought, and what is selected. */
export function InsightDetailPicker({ itemId }: { itemId: string | null }) {
  const ctx = useStore((s) => s.insightCtx), insight = useStore((s) => s.evidence.insights.find((i) => i.id === s.insightCtx?.id));
  const model = useStore((s) => s.model)!, notes = useStore((s) => s.evidence.notes);
  if (!ctx || !insight) return null;
  const name = (item: string, key: string) => {
    if (key.startsWith(NOTE)) return `Note: ${notes.find((n) => n.id === key.slice(NOTE.length))?.text.slice(0, 40) ?? 'deleted'}…`;
    return itemFacts(model, item, true)?.facts.find((f) => f.key === key)?.label ?? key;
  };
  const where = (item: string) => (item === itemId ? '' : `${itemFacts(model, item)?.name ?? item} · `);
  const onCard = itemId ? insight.focus[itemId] ?? [] : [];
  return (
    <section className="ctx-picker" data-testid="ctx-picker" aria-label="Details for the insight">
      <p className="ctx-picker-head"><span aria-hidden="true">✦</span> <span className="ctx-thought">{thought(insight)}</span></p>
      {ctx.pending.length > 0 ? (
        <ul className="ctx-chips" aria-label="Selected details">{ctx.pending.map((p) => (
          <li key={`${p.item}:${p.key}`} data-testid="ctx-selected" data-key={p.key}><span>{where(p.item)}{name(p.item, p.key)}</span>
            <button className="iconbtn" aria-label={`Unselect ${name(p.item, p.key)}`} onClick={() => togglePending(p.item, p.key)}>✕</button></li>
        ))}</ul>
      ) : <p className="micro">{itemId ? 'Tap a highlighted detail or note below to select it.' : 'Select a box or a connection on the map, then tap the details that belong with this thought.'}</p>}
      {onCard.length > 0 && <p className="micro ctx-oncard">On the card: {onCard.map((k) => name(itemId!, k)).join(' · ')}</p>}
    </section>
  );
}

// ---- map cards, as the map draws them ------------------------------------------------------------------
const PAD = 14;
function CardShape({ model, id, notes }: { model: Model; id: string; notes: number }) {
  const n = model.nodes.find((x) => x.id === id);
  if (n) {
    const w = nodeW(n);
    return (
      <svg className="card-shape" viewBox={`${-w / 2 - 4} ${-NODE_H / 2 - PAD} ${w + 4 + PAD} ${NODE_H + PAD + 26}`} width={(w + 4 + PAD) * 0.82} role="img" aria-label={n.label}>
        <g className="nodeSvg">{<NodeBox model={model} n={n} notes={notes} />}</g>
      </svg>
    );
  }
  const e = model.edges.find((x) => x.id === id);
  if (e) {
    const w = labelWidth(e.label), half = w / 2 + 26;
    return (
      <svg className="card-shape" viewBox={`${-half} -26 ${half * 2} 44`} width={half * 2 * 1.25} role="img" aria-label={e.label}>
        <defs>{EDGE_TYPES.map((t) => <marker key={t} id={`card-arrow-${t}`} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4.5 L1 8" fill="none" stroke={TYPE_COLOR[t]} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></marker>)}</defs>
        <line x1={-half + 2} y1={-4} x2={half - 4} y2={-4} stroke={TYPE_COLOR[e.type]} strokeWidth={2.6} strokeDasharray={DASH[e.type]} markerEnd={e.directed ? `url(#card-arrow-${e.type})` : undefined} />
        <g className="edgeLabel"><EdgeLabelBox model={model} e={e} /></g>
      </svg>
    );
  }
  const a = model.activities.find((x) => x.id === id);
  if (a) return <span className="card-activity" role="img" aria-label={a.label}><b aria-hidden="true">◈</b> {a.label}</span>;
  return <span className="card-missing">Not on this version of the map</span>;
}

function InsightCard({ insight, id, editing }: { insight: V<Insight>; id: string; editing: boolean }) {
  const model = useStore((s) => s.model)!, notes = useStore((s) => s.evidence.notes), links = useStore((s) => s.evidence.links), sources = useStore((s) => s.evidence.sources);
  const f = itemFacts(model, id, true), keys = insight.focus[id] ?? [];
  const evidenceHere = notesForInsight(insight.id, notes, links).filter((l) => l.note.targetId === id).map((l) => l.note.id);
  const noteIds = [...new Set([...keys.filter((k) => k.startsWith(NOTE)).map((k) => k.slice(NOTE.length)), ...evidenceHere])];
  const facts = keys.filter((k) => !k.startsWith(NOTE)).map((k) => f?.facts.find((x) => x.key === k) ?? { key: k, label: k, value: '' });
  const edge = model.edges.find((e) => e.id === id), name = (nid: string) => model.nodes.find((n) => n.id === nid)?.label ?? '?';
  const setFocus = (next: string[]) => { const all = { ...insight.focus, [id]: next }; if (!next.length) delete all[id]; return updateDoc('insights', insight.id, { focus: all }); };
  const dropFact = (key: string) => setFocus(keys.filter((k) => k !== key)).catch(fail);
  const dropNote = async (noteId: string) => {
    try {
      await setFocus(keys.filter((k) => k !== `${NOTE}${noteId}`));
      for (const l of notesForInsight(insight.id, notes, links).filter((x) => x.note.id === noteId)) await deleteDocById('links', l.linkId);
    } catch (e) { fail(e); }
  };
  const unlink = () => { const rest = { ...insight.focus }; delete rest[id]; updateDoc('insights', insight.id, { modelLinks: insight.modelLinks.filter((x) => x !== id), focus: rest }).catch(fail); };
  const open = () => openInsightOnMap(insight.id, id);
  return (
    <div className="ins-card" data-testid="insight-card" data-item={id} onClick={editing ? undefined : open}>
      <button className="ins-card-open" aria-label={`Open ${f?.name ?? 'this item'} on the map`} onClick={(e) => { e.stopPropagation(); open(); }} data-testid="card-open">
        <CardShape model={model} id={id} notes={notes.filter((n) => n.targetId === id).length} />
      </button>
      {edge && <p className="ins-card-route">{name(edge.from)} → {name(edge.to)}</p>}
      {(facts.length > 0 || noteIds.length > 0) ? (
        <ul className="card-details" data-testid="card-details">
          {facts.map((x) => (
            <li key={x.key} data-detail={x.key}><span className="cd-label">{x.label}</span><span className="cd-value">{x.value.trim() || 'Not recorded now'}</span>
              {editing && <button className="iconbtn cd-remove" aria-label={`Remove ${x.label} from this card`} onClick={(e) => { e.stopPropagation(); void dropFact(x.key); }}>✕</button>}</li>
          ))}
          {noteIds.map((nid) => { const n = notes.find((x) => x.id === nid); return (
            <li key={nid} className="cd-note" data-detail={`${NOTE}${nid}`}><span className="cd-label">✎ Note{n?.sourceId ? ` · ${sources.find((s) => s.id === n.sourceId)?.anonId ?? ''}` : ''}</span><span className="cd-value">{n ? n.text.slice(0, 200) : 'This note was deleted.'}</span>
              {editing && <button className="iconbtn cd-remove" aria-label="Remove this note from the insight" onClick={(e) => { e.stopPropagation(); void dropNote(nid); }}>✕</button>}</li>
          ); })}
        </ul>
      ) : <p className="micro card-empty">No details picked yet.</p>}
      {editing && canEdit() && <button className="linkbtn danger" onClick={unlink} aria-label={`Unlink ${f?.name ?? 'this item'}`}>Unlink card</button>}
    </div>
  );
}

// ---- editing an insight --------------------------------------------------------------------------------
function Marked({ text, matched }: { text: string; matched: string[] }) {
  const want = new Set(matched);
  return <>{text.split(/([A-Za-z]{4,})/).map((part, i) => ([...terms(part)].some((t) => want.has(t)) ? <mark key={i}>{part}</mark> : part))}</>;
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

function InsightEditor({ insight }: { insight: V<Insight> }) {
  const notes = useStore((s) => s.evidence.notes), links = useStore((s) => s.evidence.links), sources = useStore((s) => s.evidence.sources), opportunities = useStore((s) => s.evidence.opportunities);
  const draft = useStore((s) => s.insightsUi.edits[insight.id]) ?? { title: insight.title, body: insight.body };
  const [busy, setBusy] = useState(false);
  const linked = notesForInsight(insight.id, notes, links), ev = evidenceFor([insight.id], [], notes, links);
  const dirty = draft.title !== insight.title || draft.body !== insight.body;
  // The draft lives in the store, so it survives a visit to the map and back.
  const edit = (patch: Partial<typeof draft>) => setState((s) => ({ insightsUi: { ...s.insightsUi, edits: { ...s.insightsUi.edits, [insight.id]: { ...draft, ...patch } } } }));
  const forget = () => setState((s) => { const edits = { ...s.insightsUi.edits }; delete edits[insight.id]; return { insightsUi: { ...s.insightsUi, edits } }; });
  const close = () => { forget(); editInsightsUi({ editing: null }); };
  const saveText = async (andClose: boolean) => {
    setBusy(true);
    try { await updateDoc('insights', insight.id, { title: draft.title, body: draft.body }); toast('Insight saved'); andClose ? close() : forget(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const toOpportunity = async () => {
    try { const o = await createDoc('opportunities', { title: insightTitle(insight), insightIds: [insight.id], targetIds: insight.modelLinks }); setNav('decide'); setTimeout(() => document.querySelector(`[data-opportunity="${o.id}"]`)?.scrollIntoView({ block: 'start' }), 80); toast('Opportunity created from this insight'); } catch (e) { fail(e); }
  };
  return (
    <div className="insight-editor" data-testid="insight-editor">
      <Field label="The insight, in your words">
        <textarea className="insight-body" rows={4} value={draft.body} placeholder="Write the thought as it is. No source, category or template needed." aria-label="Insight text" data-testid="insight-body" onChange={(e) => edit({ body: e.target.value })} /></Field>
      <Field label="Short title (optional)">
        <input className="insight-title" value={draft.title} placeholder="Title" aria-label="Insight title" onChange={(e) => edit({ title: e.target.value })} /></Field>
      <div className="btnrow">
        {dirty ? <><button className="primary" disabled={busy} onClick={() => saveText(true)} data-testid="insight-save">Save changes</button><button className="linkbtn" onClick={forget}>Discard changes</button></>
          : <button onClick={close} data-testid="insight-done">Done</button>}
      </div>

      <section className="insight-section">
        <h4>Map cards</h4>
        <select value="" aria-label="Link this insight to a map item" className="inline-select" onChange={(e) => e.target.value && updateDoc('insights', insight.id, { modelLinks: [...insight.modelLinks, e.target.value] }).catch(fail)}><option value="">Link another map item…</option>{targetOptions().filter((o) => !insight.modelLinks.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
      </section>

      <section className="insight-section">
        <h4>Evidence</h4>
        {!linked.length && <p className="micro">No notes linked yet.</p>}
        <ul className="evlist">
          {linked.map((l) => (
            <li key={l.linkId} data-relation={l.relation} data-testid="insight-link">
              <select value={l.relation} aria-label="Relation" className={`rel rel-${l.relation}`} onChange={(e) => updateDoc('links', l.linkId, { relation: e.target.value }).catch(fail)}>{RELATIONS.map((r) => <option key={r} value={r}>{RELATION_LABEL[r]}</option>)}</select>
              <button className="linkbtn" onClick={() => jumpTo('note', l.note.id)} data-testid="insight-note-link">{l.note.text.slice(0, 110)}</button>
              <em>{sources.find((s) => s.id === l.note.sourceId)?.anonId ?? 'no source'}{l.note.certainty ? ` · ${l.note.certainty}` : ''}</em>
              <button className="linkbtn danger" aria-label="Detach this note" data-testid="detach" onClick={() => deleteDocById('links', l.linkId).catch(fail)}>Detach</button>
            </li>
          ))}
        </ul>
        {ev.gaps.length > 0 && linked.length > 0 && <ul className="gaplist">{ev.gaps.map((g) => <li key={g}>{g}</li>)}</ul>}
        <button onClick={() => openModal('link', { fromType: 'insight', fromId: insight.id })} data-testid="insight-attach">Attach evidence</button>
      </section>

      <Suggestions insight={insight} text={`${draft.title} ${draft.body}`} />

      {opportunities.filter((o) => o.insightIds.includes(insight.id)).map((o) => <p key={o.id} className="micro">Used in opportunity: <button className="linkbtn" onClick={() => setNav('decide')}>{o.title}</button></p>)}
      <footer className="btnrow insight-actions">
        <button onClick={toOpportunity} data-testid="insight-to-opportunity">Create opportunity</button>
        <button onClick={() => createScenario(`Test: ${insightTitle(insight).slice(0, 60)}`, { fromBranchId: 'baseline', hypothesis: insight.body, origin: { type: 'insight', id: insight.id } }).then(() => toast('Scenario branched from this insight')).catch(fail)} data-testid="insight-to-scenario">Test in a scenario</button>
        <button onClick={() => openModal('deep', { insightId: insight.id })}>Deep research…</button>
        <button className="linkbtn danger" onClick={async () => { if (confirm('Delete this insight? Notes linked to it are kept.')) { await deleteDocById('insights', insight.id).catch(fail); close(); } }}>Delete</button>
      </footer>
    </div>
  );
}

// ---- the Insights page -------------------------------------------------------------------------------
function InsightBox({ insight }: { insight: V<Insight> }) {
  const notes = useStore((s) => s.evidence.notes), links = useStore((s) => s.evidence.links);
  const open = useStore((s) => s.insightsUi.expanded === insight.id), editing = useStore((s) => s.insightsUi.editing === insight.id && canEdit());
  const unsaved = useStore((s) => !!s.insightsUi.edits[insight.id]);
  const ev = evidenceFor([insight.id], [], notes, links), cards = insight.modelLinks.length;
  const words = thought(insight), sub = insight.body.trim() && insight.title.trim() ? insight.title.trim() : '';
  const toggle = () => editInsightsUi({ expanded: open ? null : insight.id, ...(open ? { editing: null } : {}) });
  return (
    <article className={`insight-box${open ? ' open' : ''}`} data-insight={insight.id} data-testid="insight" data-expanded={open}>
      <div className="ib-head">
        <button className="ib-thought" aria-expanded={open} onClick={toggle} data-testid="insight-toggle">
          <span className="ib-text" data-testid="insight-thought">{words}</span>
          {sub && <span className="ib-title">{sub}</span>}
          <span className="ib-meta">{cards ? `${cards} card${cards === 1 ? '' : 's'}` : 'Text only'} · <span className={`ev-${ev.level}`} data-testid="insight-evidence">{EVIDENCE_LEVEL_LABEL[ev.level]}</span>{unsaved && ' · unsaved edit'}</span>
        </button>
        <button className="ib-map" onClick={() => openInsightOnMap(insight.id)} data-testid="show-on-map">✦ Show on map</button>
      </div>
      {open && (
        <div className="ib-body">
          {canEdit() && !editing && <div className="btnrow"><button onClick={() => editInsightsUi({ editing: insight.id })} data-testid="insight-edit">Edit</button></div>}
          {editing && <InsightEditor insight={insight} />}
          <div className="ins-cards" data-testid="insight-model-links">
            {insight.modelLinks.map((id) => <InsightCard key={id} insight={insight} id={id} editing={editing} />)}
          </div>
          {!cards && <p className="micro">No map cards yet. Show on map, select a box or a line, and add the details this thought is about.</p>}
        </div>
      )}
    </article>
  );
}

/** Writing a new insight straight on the page. The text is kept while the researcher looks elsewhere. */
function NewInsight() {
  const text = useStore((s) => s.insightsUi.newText) ?? '';
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Focus a freshly opened writer; a draft coming back into view must not move the page.
  useEffect(() => { if (!getState().insightsUi.newText) ref.current?.focus({ preventScroll: true }); }, []);
  const saveNew = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { const doc = await createDoc('insights', { title: '', body: text.trim(), modelLinks: [] }); editInsightsUi({ newText: null, expanded: doc.id, editing: null }); toast('Insight saved'); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <div className="insight-new" data-testid="insight-new-form">
      <textarea ref={ref} rows={3} value={text} placeholder="Write the thought in your own words. Map cards and evidence can come later." aria-label="New insight" data-testid="insight-new-text"
        onChange={(e) => editInsightsUi({ newText: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveNew(); } if (e.key === 'Escape') editInsightsUi({ newText: null }); }} />
      <div className="btnrow"><button className="primary" disabled={busy || !text.trim()} onClick={saveNew} data-testid="insight-new-save">Save insight</button><button className="linkbtn" onClick={() => editInsightsUi({ newText: null })}>Cancel</button></div>
    </div>
  );
}

export function Insights() {
  const insights = useStore((s) => s.evidence.insights), notes = useStore((s) => s.evidence.notes), links = useStore((s) => s.evidence.links), writing = useStore((s) => s.insightsUi.newText !== null);
  // Back from the map: the page opens where the researcher left it.
  useLayoutEffect(() => { restoreInsightsScroll(); }, []);
  const levels = insights.map((i) => evidenceFor([i.id], [], notes, links).level);
  const count = (l: string) => levels.filter((x) => x === l).length;
  return (
    <div className="page" data-testid="insights">
      <header className="page-head"><div><h1>Insights</h1><p>Your working thoughts, each with the map cards and details it is about.</p></div>
        {canEdit() && <div className="btnrow"><button className="primary" onClick={() => editInsightsUi({ newText: '' })} disabled={writing} data-testid="insight-new">+ New insight</button><button onClick={() => startInsight('insights')} data-testid="insight-start">✦ From the map</button></div>}</header>
      {writing && <NewInsight />}
      {insights.length > 0 && <p className="insight-summary micro">{insights.length} insight{insights.length === 1 ? '' : 's'} · {count('supported')} with several supporting sources · {count('thin')} thin · {count('contested')} contested · {count('none')} without evidence</p>}
      {!insights.length && !writing && <Empty title="No insights yet">Press New insight to write one, or From the map to tap the boxes it is about first.</Empty>}
      <div className="insights">{[...insights].reverse().map((i) => <InsightBox key={i.id} insight={i} />)}</div>
    </div>
  );
}
