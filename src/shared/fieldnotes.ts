// Field notes import: a block of notes (pasted, .txt or .docx) becomes proposed notes, one claim each, placed on
// the map where they belong. Proposals are only suggestions: the researcher reviews them in the original text.
// This file has the parts that need no AI: names, segmenting, a cautious classifier and word-match placement.
import { EDGE_TYPE_LABEL, NODE_KIND_LABEL, type Model } from './model';
import { terms } from './evidence';

export const IMPORT_KINDS = ['observation', 'measurement', 'question', 'hypothesis'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export type Certainty = 'observed' | 'reported' | 'documented' | 'inferred' | null;
export const IMPORT_KIND_LABEL: Record<ImportKind, string> = { observation: 'Observation', measurement: 'Measurement', question: 'Question', hypothesis: 'Interpretation' };

export interface Proposal {
  key: string;
  /** Where the note sits in the (name-replaced) document; -1 when it could not be found there. */
  start: number; end: number;
  /** The note as it will be saved. Starts as the excerpt; the researcher can edit it. */
  text: string;
  excerpt: string;
  /** A readable rewording of shorthand, offered by Claude. Never used unless the researcher chooses it. */
  readable: string;
  kind: ImportKind; certainty: Certainty;
  targetId: string | null; confidence: 'high' | 'low';
  /** Set when the note describes a step, role or system the map does not have. */
  notOnMap: string;
  speaker: string; sourceId: string | null;
  include: boolean;
  duplicateOf: string | null;
  why: string;
}

/** What makes a proposal worth a second look before it is saved. */
export function lookReasons(p: Proposal): string[] {
  const out: string[] = [];
  if (p.start < 0) out.push('Not found word for word in your notes');
  if (p.kind === 'hypothesis') out.push('Reads as your interpretation, not something seen or heard');
  if (p.notOnMap) out.push('Describes something not on the map');
  else if (p.targetId && p.confidence === 'low') out.push('Unsure where on the map');
  return out;
}

// ---- names ----------------------------------------------------------------------------------------------
const NOT_NAMES = new Set(('I Im Ive Id A An The This That These Those It Its They Them Their We Our You Your He She His Her Him ' +
  'Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December ' +
  'Mon Tue Wed Thu Fri Sat Sun Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec Today Yesterday Tomorrow Morning Afternoon Evening ' +
  'And But Or So If When While Then Also Because After Before During Maybe Perhaps Probably Seems Note Notes Q A Re Ok OK Yes No Not ' +
  'Interview Observation Session Date Time Location Present Follow Next Some Most Every Each One Two Three First Second Third Mr Mrs Ms Dr ' +
  'Email Excel Word Teams Zoom Slack Outlook Google Microsoft').split(' '));

/**
 * Words that look like people's names: capitalised, not at the start of a sentence, not common words and not on
 * the map. Speaker labels count too. It is a prompt for the researcher, who decides what to replace.
 */
export function findNames(doc: string, model?: Model | null): { name: string; count: number }[] {
  const mapWords = new Set((model ? [...model.nodes.map((n) => `${n.label} ${n.role}`), ...model.edges.map((e) => e.label)] : []).join(' ').split(/[^A-Za-z']+/).filter(Boolean).map((w) => w.toLowerCase()));
  const counts = new Map<string, number>();
  const add = (w: string) => { if (w.length < 3 || NOT_NAMES.has(w) || NOT_NAMES.has(w.replace(/s$/, '')) || mapWords.has(w.toLowerCase()) || /^[A-Z]{2,}$/.test(w)) return; counts.set(w, (counts.get(w) ?? 0) + 1); };
  for (const m of doc.matchAll(/^[ \t]*([A-Z][a-z]+)(?: [A-Z][a-z]+)?\s*:/gm)) add(m[1]);
  for (const m of doc.matchAll(/(?<=[a-z,;)'’"”]\s+|\(|with |and )([A-Z][a-z]+)\b/g)) add(m[1]);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Replaces each name, as a whole word, with what the researcher chose (a role such as "Coordinator"). */
export function replaceNames(doc: string, pairs: { name: string; with: string }[]): string {
  let out = doc;
  for (const p of pairs) if (p.name.trim() && p.with.trim()) {
    const role = p.with.trim(), cap = role[0].toUpperCase() + role.slice(1);
    out = out.replace(new RegExp(`\\b${escapeRe(p.name.trim())}(?:'s|’s)?\\b`, 'g'), (m, at: number, all: string) => {
      // At the start of a line or sentence the role starts with a capital, so "Sam:" stays a speaker label.
      const startsLine = at === 0 || /(?:^|\n)[ \t]*(?:[-*•–·]|\d{1,2}[.)])?[ \t]*$|[.!?]\s+$/.test(all.slice(Math.max(0, at - 40), at));
      return (startsLine ? cap : role) + (/['’]s$/.test(m) ? m.slice(-2) : '');
    });
  }
  return out;
}

// ---- segmenting -----------------------------------------------------------------------------------------
export interface Segment { start: number; end: number; speaker: string; para?: number }
const BULLET = /^[ \t]*(?:[-*•–·▪◦]|\d{1,2}[.)]|\(?[a-z][.)])[ \t]+/;
const TIME = /^[ \t]*\[?\d{1,2}[:.]\d{2}(?:\s?[ap]m)?\]?[ \t]*[-–:]?[ \t]*/i;
// "Sam: ...", "The program lead: ..." (a role put in place of a name), "PL: ...".
const SPEAKER = /^[ \t]*([A-Z][A-Za-z.'’-]{0,20}(?: [A-Za-z][A-Za-z.'’-]{0,20}){0,2}|[A-Z]{1,3}\d?)[ \t]*:[ \t]+(?=\S)/;
const NOT_SPEAKERS = new Set(['Note', 'Notes', 'NB', 'Date', 'Time', 'Location', 'Re', 'Todo', 'TODO', 'Action', 'Actions', 'Follow up', 'Q', 'Question']);
const HEADER = /^[ \t]*(?:#{1,6}[ \t].*|[^.!?\n]{1,70}:[ \t]*|(?:date|time|location|place|interview|session|participant|participants|observer|present|attendees|duration)\b[^.!?\n]{0,80})$/i;
const ABBR = new Set(['e.g', 'i.e', 'etc', 'approx', 'min', 'mins', 'hr', 'hrs', 'vs', 'dr', 'mr', 'mrs', 'ms', 'no', 'st', 'prob', 'esp', 'incl', 'dept', 'avg', 'est', 'cf', 'al']);

/**
 * Splits a document into note-sized pieces with their offsets: bullets, numbered and timed lines start a new
 * piece, blank lines end one, a "Name:" label sets the speaker, and longer prose is cut into sentences.
 * Headings and metadata lines (dates, places, "Interview with ...") are left as context, not notes.
 */
export function segment(doc: string): Segment[] {
  const items: Segment[] = [];
  let cur: Segment | null = null, speaker = '';
  const close = () => { if (cur && cur.end > cur.start) items.push(cur); cur = null; };
  let pos = 0, first = true;
  for (const line of doc.split('\n')) {
    const lineStart = pos, lineEnd = pos + line.length;
    pos = lineEnd + 1;
    if (!line.trim()) { close(); speaker = ''; continue; }
    // The document's first line, when short and unpunctuated, is its title.
    const title = first && line.trim().length <= 70 && !/[.!?:;]["”')]?\s*$/.test(line) && !BULLET.test(line) && !SPEAKER.test(line);
    first = false;
    if (title || (HEADER.test(line) && !BULLET.test(line))) { close(); continue; }
    let start = lineStart, isNew = false;
    const strip = (re: RegExp) => { const m = re.exec(doc.slice(start, lineEnd)); if (m) { start += m[0].length; return m; } return null; };
    if (strip(BULLET) || strip(TIME)) isNew = true;
    const sp = SPEAKER.exec(doc.slice(start, lineEnd));
    if (sp && !NOT_SPEAKERS.has(sp[1])) { speaker = sp[1]; start += sp[0].length; isNew = true; }
    const end = lineEnd - (line.length - line.trimEnd().length);
    if (isNew || !cur) { close(); cur = { start, end, speaker, para: items.length }; } else cur.end = end;
  }
  close();
  return items.flatMap((it) => sentences(doc, it));
}

/** Shorter than this, a fragment ("Annoyed.", "~20 min.") cannot stand alone as a note. */
const MIN_NOTE = 18;
/** Cuts a piece into sentences. Fragments too short to stand alone stay with the sentence before them. */
function sentences(doc: string, it: Segment): Segment[] {
  const text = doc.slice(it.start, it.end);
  const cuts: number[] = [0];
  for (const m of text.matchAll(/[.!?]["”')\]]?\s+(?=["“(]?[A-Z0-9~])/g)) {
    const before = text.slice(0, m.index! + 1), word = /([A-Za-z.]+)\.$/.exec(before)?.[1]?.toLowerCase().replace(/\.$/, '') ?? '';
    if (ABBR.has(word) || /\b[A-Z]\.$/.test(before)) continue;
    cuts.push(m.index! + m[0].length);
  }
  const parts = cuts.map((c, i) => ({ start: it.start + c, end: it.start + (i + 1 < cuts.length ? cuts[i + 1] : text.length), speaker: it.speaker, para: it.para }))
    .map((p) => ({ ...p, end: p.start + doc.slice(p.start, p.end).trimEnd().length }));
  const out: Segment[] = [];
  for (const p of parts) {
    const short = p.end - p.start < MIN_NOTE;
    if (short && out.length) out[out.length - 1].end = p.end;
    else out.push({ ...p });
  }
  // A short first fragment joins the next one.
  if (out.length > 1 && out[0].end - out[0].start < MIN_NOTE) { out[1].start = out[0].start; out.shift(); }
  return out;
}

// ---- classifying and placing ----------------------------------------------------------------------------
const HEDGE = /\b(maybe|perhaps|probably|prob\.?|likely|seems?|seemed|appears?|i think|i suspect|i guess|suspect|might|could be|possibly|feels like|my sense|my guess|wonder|presumably|guess)\b/i;
const TO_ASK = /^\s*(?:q:|ask\b|follow[ -]?up\b|todo\b|check (?:whether|if)\b|find out\b|need to (?:ask|check)\b)/i;
const NUMBER = /(?:~|≈|about |around |approx\.? )?\d+(?:[.,]\d+)?\s*(?:-|–|to)?\s*\d*\s*(?:min(?:ute)?s?|m\b|h(?:ou)?rs?|h\b|days?|weeks?|%|percent|times|x\b|per\b|cases?|calls?|emails?)/i;
const REPORTED = /\b(said|says|told|tells|reported|reports|mentioned|explained|according to|claims?|complained|described|describes|recalled)\b|["“][^"”]{6,}["”]/i;
const OBSERVED = /\b(i saw|i watched|i observed|i noticed|observed|watched|we saw|(?:\(|\[)obs(?:\)|\]))/i;

export type DocType = 'notes' | 'document';
export function classify(text: string, speaker: string, docType: DocType = 'notes'): { kind: ImportKind; certainty: Certainty } {
  if (TO_ASK.test(text)) return { kind: 'question', certainty: null };
  if (HEDGE.test(text)) return { kind: 'hypothesis', certainty: 'inferred' };
  if (/\?\s*["”)]?\s*$/.test(text)) return { kind: 'question', certainty: null };
  const kind: ImportKind = NUMBER.test(text) ? 'measurement' : 'observation';
  // A report, procedure or email says how work is meant to run; it is documented, not seen or told.
  if (docType === 'document') return { kind, certainty: 'documented' };
  // Cautious: observed only when the notes say so; spoken accounts are reported; otherwise left for the researcher.
  const certainty: Certainty = OBSERVED.test(text) ? 'observed' : speaker || REPORTED.test(text) ? 'reported' : null;
  return { kind, certainty };
}

export interface MapItem { id: string; type: 'node' | 'edge' | 'activity'; label: string; detail: string }
/** The map as the splitter sees it: what each item is called and what it involves. */
export function mapItems(m: Model): MapItem[] {
  const name = (id: string | null) => m.nodes.find((n) => n.id === id)?.label ?? '?';
  return [
    ...m.nodes.map((n) => ({ id: n.id, type: 'node' as const, label: n.label, detail: [NODE_KIND_LABEL[n.kind], n.role, n.description].filter(Boolean).join('; ') })),
    ...m.edges.map((e) => ({ id: e.id, type: 'edge' as const, label: e.label, detail: [`${EDGE_TYPE_LABEL[e.type]} from ${name(e.from)} to ${name(e.to)}`, e.workItem, e.result, e.description, e.conditions].filter(Boolean).join('; ') })),
    ...m.activities.filter((a) => !a.edgeId).map((a) => ({ id: a.id, type: 'activity' as const, label: a.label, detail: `internal activity at ${name(a.ownerNodeId)}` })),
  ];
}

/** Best map item for a piece of text by shared words, with how sure the match is. */
export function place(text: string, m: Model): { targetId: string | null; confidence: 'high' | 'low' } {
  const want = terms(text), lower = text.toLowerCase();
  const mentions = (label: string) => label.length > 2 && lower.includes(label.toLowerCase());
  const scored = mapItems(m).map((it) => {
    const label = terms(it.label), detail = terms(it.detail);
    let s = 0;
    for (const t of want) { if (label.has(t)) s += 2; else if (detail.has(t)) s += 1; }
    if (mentions(it.label)) s += 3;
    if (it.type === 'edge') { const e = m.edges.find((x) => x.id === it.id)!; const a = m.nodes.find((n) => n.id === e.from), b = m.nodes.find((n) => n.id === e.to); if (a && b && mentions(a.label) && mentions(b.label)) s += 3; }
    return { id: it.id, s };
  }).sort((a, b) => b.s - a.s);
  const [best, next] = scored;
  if (!best || best.s < 2) return { targetId: null, confidence: 'low' };
  return { targetId: best.id, confidence: best.s >= 4 && best.s >= (next?.s ?? 0) * 1.5 ? 'high' : 'low' };
}

let seq = 0;
export const proposalKey = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

export function makeProposal(doc: string, s: { start: number; end: number; speaker?: string }, m: Model | null, extra: Partial<Proposal> = {}, docType: DocType = 'notes'): Proposal {
  const excerpt = doc.slice(s.start, s.end).trim();
  const c = classify(excerpt, s.speaker ?? '', docType);
  const p = m ? place(excerpt, m) : { targetId: null, confidence: 'low' as const };
  return { key: proposalKey(), start: s.start, end: s.end, text: excerpt, excerpt, readable: '', ...c, ...p, notOnMap: '', speaker: s.speaker ?? '', sourceId: null, include: true, duplicateOf: null, why: '', ...extra };
}

/** The splitter that runs on the phone without a network: structure, sentences and word matching. */
export function splitOffline(doc: string, m: Model | null, docType: DocType = 'notes'): Proposal[] {
  // "Watched her triage two applications. She read each one..." - what follows in the same paragraph was seen too.
  let seenPara = -1;
  return segment(doc).map((s) => {
    const p = makeProposal(doc, s, m, {}, docType);
    if (p.certainty === 'observed') seenPara = s.para ?? -1;
    else if (s.para === seenPara && p.certainty === null && p.kind !== 'question') p.certainty = 'observed';
    return p;
  });
}

/** A new proposal for the sentence around a position the researcher tapped in text no note covers. */
export function proposalAt(doc: string, offset: number, taken: Proposal[], m: Model | null, docType: DocType = 'notes'): Proposal | null {
  const free = (s: Segment) => !taken.some((p) => p.start >= 0 && p.start < s.end && s.start < p.end);
  const hit = segment(doc).find((s) => s.start <= offset && offset <= s.end && free(s));
  if (hit) return makeProposal(doc, hit, m, {}, docType);
  // Inside a heading or metadata line: offer that line.
  const ls = doc.lastIndexOf('\n', offset - 1) + 1, le = doc.indexOf('\n', offset) < 0 ? doc.length : doc.indexOf('\n', offset);
  const line = { start: ls + (doc.slice(ls, le).length - doc.slice(ls, le).trimStart().length), end: le - (doc.slice(ls, le).length - doc.slice(ls, le).trimEnd().length), speaker: '' };
  return line.end > line.start && free(line) ? makeProposal(doc, line, m, {}, docType) : null;
}

// ---- review edits ---------------------------------------------------------------------------------------
const edited = (p: Proposal) => p.text !== p.excerpt;
/** Joins two proposals into one note covering both, keeping the first one's settings. */
export function merge(doc: string, a: Proposal, b: Proposal): Proposal {
  const [x, y] = a.start <= b.start ? [a, b] : [b, a];
  // Joining is a deliberate choice, so the joined note is included even if a part had been left out.
  if (x.start < 0 || y.start < 0) return { ...x, text: `${x.text} ${y.text}`, excerpt: `${x.excerpt} ${y.excerpt}`, key: proposalKey(), include: true, duplicateOf: null };
  const excerpt = doc.slice(x.start, y.end).trim();
  return { ...x, key: proposalKey(), end: y.end, excerpt, text: edited(x) || edited(y) ? `${x.text} ${y.text}` : excerpt, readable: '', targetId: x.targetId ?? y.targetId, notOnMap: x.notOnMap || y.notOnMap, include: true, duplicateOf: null };
}
/** Splits an unedited proposal at a position in its text. */
export function splitAt(doc: string, p: Proposal, at: number, m: Model | null): [Proposal, Proposal] | null {
  if (p.start < 0 || edited(p)) return null;
  const lead = doc.slice(p.start, p.end).length - doc.slice(p.start, p.end).trimStart().length;
  const cut = p.start + lead + at;
  if (cut <= p.start + 2 || cut >= p.end - 2) return null;
  const a = makeProposal(doc, { start: p.start, end: cut, speaker: p.speaker }, m), b = makeProposal(doc, { start: cut, end: p.end, speaker: p.speaker }, m);
  return [{ ...a, sourceId: p.sourceId }, { ...b, sourceId: p.sourceId }];
}

// ---- finding excerpts and repeats -----------------------------------------------------------------------
/** Where an excerpt sits in the document, searching from a position first, then anywhere, then ignoring spacing. */
export function locate(doc: string, excerpt: string, from = 0): { start: number; end: number } | null {
  const ex = excerpt.trim();
  if (!ex) return null;
  let i = doc.indexOf(ex, from);
  if (i < 0) i = doc.indexOf(ex);
  if (i >= 0) return { start: i, end: i + ex.length };
  // Same words, different spacing or line breaks.
  const map: number[] = [];
  let flat = '';
  for (let k = 0; k < doc.length; k++) { if (/\s/.test(doc[k])) { if (flat.endsWith(' ')) continue; flat += ' '; } else flat += doc[k]; map.push(k); }
  const want = ex.replace(/\s+/g, ' ');
  let j = flat.indexOf(want, Math.max(0, map.findIndex((k) => k >= from)));
  if (j < 0) j = flat.indexOf(want);
  return j < 0 ? null : { start: map[j], end: map[j + want.length - 1] + 1 };
}

export const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Marks proposals that repeat a note already in the project (for example, a running document imported again). */
export function markRepeats(ps: Proposal[], notes: { id: string; text: string; rawText?: string }[]): Proposal[] {
  const seen = new Map<string, string>();
  for (const n of notes) for (const t of [n.text, n.rawText ?? '']) if (t) seen.set(normalise(t), n.id);
  return ps.map((p) => { const id = seen.get(normalise(p.excerpt)) ?? seen.get(normalise(p.text)) ?? null; return id ? { ...p, duplicateOf: id, include: false } : p; });
}
