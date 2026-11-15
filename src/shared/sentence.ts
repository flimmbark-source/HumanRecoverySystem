// Deterministic connection sentences. The sentence is derived from structured fields and is never stored.
// It is reused by the inspector, edit preview, timeline, report and research candidate preview.
import { ACTION_CODES, type ActionCode, type Model, type WEdge, type WActivity, activityForEdge } from './model';

export type SegmentType = 'plain' | 'actor' | 'action' | 'item' | 'state' | 'unknown';
export interface Segment { text: string; type: SegmentType }

export const ACTION_VERBS: Record<ActionCode, string> = {
  submit: 'submits', review: 'reviews', check: 'checks', approve: 'approves', request: 'requests', match: 'matches',
  notify: 'notifies about', record: 'records', transfer: 'transfers', process: 'processes', transform: 'transforms',
};
export const ACTION_LABEL: Record<ActionCode, string> = Object.fromEntries(
  ACTION_CODES.map((c) => [c, c.charAt(0).toUpperCase() + c.slice(1)]),
) as Record<ActionCode, string>;

export type PerformerRelation = 'sender' | 'receiver' | 'third_party' | 'unknown' | 'missing';

export interface ConnectionDescription {
  segments: Segment[];
  sentence: string;
  unknowns: string[];
  from: string;
  to: string;
  performer: string | null;
  performerRelation: PerformerRelation;
  verb: string | null;
  item: string;
  input: { item: string; state: string };
  output: { result: string; state: string };
}

/** Fields the sentence needs. Performer and action come from the activity, or from explicit overrides (candidate previews). */
export interface SentenceInput {
  edge: Pick<WEdge, 'from' | 'to' | 'type' | 'label' | 'workItem' | 'result' | 'inputState' | 'outputState' | 'description'>;
  performerId: string | null;
  actionCode: ActionCode | null;
  nodes: { id: string; label: string; kind: string }[];
}

const p = (text: string): Segment => ({ text, type: 'plain' });
const actor = (text: string): Segment => ({ text, type: 'actor' });
const act = (text: string): Segment => ({ text, type: 'action' });
const item = (text: string): Segment => ({ text, type: 'item' });
const state = (text: string): Segment => ({ text, type: 'state' });
const unk = (text: string): Segment => ({ text, type: 'unknown' });

function nounParts(raw: string, capital: boolean): Segment[] {
  const s = raw.trim();
  if (!s) return [unk(capital ? 'An unspecified item' : 'an unspecified item')];
  if (/^(the|a|an|this|these|those|some|my|our)\s/i.test(s)) return [item(capital ? s.charAt(0).toUpperCase() + s.slice(1) : s)];
  return [p(capital ? 'The ' : 'the '), item(s.charAt(0).toLowerCase() + s.slice(1))];
}

export function describe(input: SentenceInput): ConnectionDescription {
  const { edge, performerId, actionCode } = input;
  const node = (id: string | null) => (id ? input.nodes.find((n) => n.id === id) ?? null : null);
  const src = node(edge.from), dest = node(edge.to), worker = node(performerId);
  const from = src?.label ?? 'Unknown source', to = dest?.label ?? 'unknown destination';
  const work = edge.workItem.trim(), result = edge.result.trim();
  const inS = edge.inputState.trim(), outS = edge.outputState.trim();
  const verb = actionCode ? ACTION_VERBS[actionCode] : null;
  const operational = edge.type === 'flow' || edge.type === 'info';
  const unknowns: string[] = [];
  if (!src || !dest) unknowns.push('A connection endpoint is missing');
  if (operational && !work) unknowns.push('Transferred item not identified');
  if (operational && !performerId) unknowns.push('Activity performer not identified');
  if (performerId && !worker) unknowns.push('Assigned performer does not exist in this model');
  if (operational && !verb) unknowns.push('Action not classified');
  if (operational && !result) unknowns.push('Result not described');
  if (operational && (!inS || !outS)) unknowns.push('Full before/after state not defined');

  const relation: PerformerRelation = !performerId ? 'unknown' : !worker ? 'missing'
    : worker.id === edge.from ? 'sender' : worker.id === edge.to ? 'receiver' : 'third_party';

  const fromSeg = src ? actor(from) : unk(from), toSeg = dest ? actor(to) : unk(to);
  let route: Segment[];
  if (edge.type === 'flow') route = [...nounParts(work, true), p(' moves from '), fromSeg, p(' to '), toSeg];
  else if (edge.type === 'info') route = [...nounParts(work, true), p(' is communicated from '), fromSeg, p(' to '), toSeg];
  else if (edge.type === 'dependency') route = [toSeg, p(' requires '), ...(work ? nounParts(work, false) : [unk('an unspecified input')]), p(' from '), fromSeg];
  else if (edge.type === 'authority') route = [fromSeg, p(' has an authority relationship with '), toSeg];
  else route = [fromSeg, p(' is associated with '), toSeg];

  const stateClause = (gerund: boolean): Segment[] =>
    inS && outS ? [p(`${gerund ? 'changing' : 'changes'} its state from `), state(inS), p(' to '), state(outS)]
      : outS ? [p(`${gerund ? 'setting' : 'sets'} its state to `), state(outS)] : [];
  const tail = (): Segment[] => {
    const sc = stateClause(false);
    if (sc.length) return [p(' and '), ...sc];
    if (result) return [p(', producing '), ...nounParts(result, false)];
    return [];
  };

  let segs: Segment[];
  if (!operational) {
    segs = [...route, p('.')];
    if (edge.description.trim()) segs.push(p(' ' + edge.description.trim()));
  } else if (worker && verb && relation === 'sender' && actionCode === 'submit') {
    segs = [actor(worker.label), p(' '), act('submits'), p(' '), ...nounParts(work, false), p(' to '), toSeg];
    const sc = stateClause(true);
    if (sc.length) segs.push(p(', '), ...sc);
    segs.push(p('.'));
  } else if (worker && verb && relation === 'sender' && actionCode === 'request' && edge.type === 'info') {
    segs = [actor(worker.label), p(' '), act('sends'), p(' '), ...nounParts(work, false), p(' to '), toSeg, p('.')];
  } else if (worker && verb && relation === 'receiver') {
    segs = [...route, p(worker.kind === 'person' ? ', who ' : ', which '), act(verb), p(' it'), ...tail(), p('.')];
  } else {
    segs = [...route, p('. ')];
    if (worker && verb) segs.push(actor(worker.label), p(' '), act(verb), p(' '), ...nounParts(work, false), ...tail(), p('.'));
    else if (worker) segs.push(actor(worker.label), p(' is associated with this activity, but the '), unk('action has not been classified'), p('.'));
    else if (relation === 'missing') segs.push(p('The assigned performer '), unk('no longer exists in this model'), p('.'));
    else segs.push(p(`The performer of “${edge.label || 'this activity'}” is `), unk('not identified'), p('.'));
  }
  // merge adjacent plain segments for stable output
  const merged: Segment[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.type === 'plain' && s.type === 'plain') last.text += s.text; else merged.push({ ...s });
  }
  return {
    segments: merged, sentence: merged.map((s) => s.text).join(''), unknowns, from, to,
    performer: worker?.label ?? null, performerRelation: relation, verb, item: work,
    input: { item: work, state: inS }, output: { result, state: outS },
  };
}

export function describeEdge(m: Model, edge: WEdge, activity?: WActivity | null): ConnectionDescription {
  const a = activity === undefined ? activityForEdge(m, edge.id) : activity;
  return describe({ edge, performerId: a?.performerId ?? null, actionCode: a?.actionCode ?? null, nodes: m.nodes });
}

export const PERFORMER_RELATION_LABEL: Record<PerformerRelation, string> = {
  sender: 'the sender', receiver: 'the receiver', third_party: 'a third party', unknown: 'not identified', missing: 'missing from this model',
};
