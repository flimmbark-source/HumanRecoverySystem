// Research candidate bundles. v1 is the bundled skill contract, validated against its JSON Schema verbatim.
// v2 is a versioned extension that adds provenance fields and three review-only proposal types.
import Ajv2020 from 'ajv/dist/2020.js';
import { z } from 'zod';
import schemaV1 from './candidate-schema-v1.json';
import { ACTION_CODES, EDGE_TYPES, NODE_KINDS, idSchema, newId, qty, unknownQty, type ActionCode, type Model, type ValidationIssue } from './model';
import { NOTE_KINDS } from './workspace';

export const CANDIDATE_FORMAT = 'weave-research-candidates';
const AjvCtor = (Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020;
const ajv = new AjvCtor({ allErrors: true, strict: false });
const validateV1 = ajv.compile(schemaV1 as object);

const common = {
  summary: z.string().min(1).max(500), sourceId: z.string().min(1).max(200), basis: z.string().min(1).max(1200),
  certainty: z.enum(['observed', 'reported', 'inferred']), kindHint: z.string().max(100).optional(),
  sourceUrl: z.string().url().max(2000).optional(), retrievedAt: z.string().max(40).optional(), sourceDate: z.string().max(40).optional(),
};
const semantic = {
  workItem: z.string().max(250).optional(), result: z.string().max(250).optional(), inputState: z.string().max(250).optional(), outputState: z.string().max(250).optional(),
  performerId: idSchema.optional(), actionCode: z.enum(ACTION_CODES).optional(),
};
const minutes = z.number().min(0).refine(Number.isFinite).nullable();
export const candidateV2Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note'), ...common, noteType: z.enum(NOTE_KINDS), text: z.string().min(1).max(4000), targetId: idSchema.optional() }).strict(),
  z.object({ kind: z.literal('node'), ...common, nodeType: z.enum(NODE_KINDS), label: z.string().min(1).max(140) }).strict(),
  z.object({ kind: z.literal('relationship'), ...common, ...semantic, fromId: idSchema, toId: idSchema, connectionType: z.enum(EDGE_TYPES), label: z.string().min(1).max(140) }).strict(),
  z.object({ kind: z.literal('activity'), ...common, ownerId: idSchema, label: z.string().min(1).max(140), minutes, measurementBasis: z.string().min(1).max(1000).optional() }).strict(),
  // v2 additions. These never change the model; accepting them creates review material for the researcher.
  z.object({ kind: z.literal('contradiction'), ...common, text: z.string().min(1).max(4000), accounts: z.array(z.object({ sourceId: z.string().min(1).max(200), claim: z.string().min(1).max(1200) })).min(2).max(10), targetId: idSchema.optional(), noteIds: z.array(idSchema).max(10).optional() }).strict(),
  z.object({ kind: z.literal('measurement_target'), ...common, text: z.string().min(1).max(4000), metric: z.string().min(1).max(200), method: z.string().max(1000).optional(), targetId: idSchema.optional() }).strict(),
  z.object({ kind: z.literal('assessment'), ...common, recommendation: z.enum(['investigate', 'test_existing', 'close']), reason: z.string().min(1).max(2000), coverage: z.string().min(1).max(4000), fitGaps: z.string().max(4000).default(''), uncertainty: z.string().max(4000).default(''), optionLabel: z.string().max(300).optional() }).strict(),
]);
export type Candidate = z.infer<typeof candidateV2Schema>;
export const V2_ONLY_KINDS = ['contradiction', 'measurement_target', 'assessment'];

export interface ParsedCandidates { version: 1 | 2; candidates: Candidate[]; issues: ValidationIssue[] }

/** Structural validation of a candidate bundle. Reference checks happen separately against a specific revision. */
export function parseCandidateBundle(input: unknown): ParsedCandidates {
  const fail = (issues: ValidationIssue[]): ParsedCandidates => ({ version: 1, candidates: [], issues });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail([{ path: 'root', message: 'not a JSON object' }]);
  const o = input as Record<string, unknown>;
  if (o.format !== CANDIDATE_FORMAT) return fail([{ path: 'format', message: `expected "${CANDIDATE_FORMAT}"` }]);
  if (o.version === 1) {
    if (!validateV1(input)) {
      return fail((validateV1.errors ?? []).map((e) => ({ path: e.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'root', message: e.message ?? 'invalid' })));
    }
    return { version: 1, candidates: (o.candidates as Candidate[]).map((c) => ({ ...c })), issues: [] };
  }
  if (o.version === 2) {
    const extra = Object.keys(o).filter((k) => !['format', 'version', 'candidates'].includes(k));
    if (extra.length) return fail([{ path: extra[0], message: 'unexpected property' }]);
    const parsed = z.array(candidateV2Schema.superRefine((c, ctx) => {
      if (c.kind === 'activity' && c.minutes !== null && !c.measurementBasis) ctx.addIssue({ code: 'custom', message: 'a numeric duration needs measurementBasis', path: ['measurementBasis'] });
    })).max(100).safeParse(o.candidates);
    if (!parsed.success) return { version: 2, candidates: [], issues: parsed.error.issues.map((i) => ({ path: `candidates.${i.path.join('.')}`, message: i.message })) };
    return { version: 2, candidates: parsed.data, issues: [] };
  }
  return fail([{ path: 'version', message: 'supported versions are 1 and 2' }]);
}

/** Reference integrity of one candidate against one model revision (mirrors the skill's validator script). */
export function checkCandidateRefs(c: Candidate, m: Model): string[] {
  const nodes = new Set(m.nodes.map((n) => n.id));
  const targets = new Set([...nodes, ...m.edges.map((e) => e.id), ...m.activities.map((a) => a.id)]);
  const out: string[] = [];
  if ('targetId' in c && c.targetId && !targets.has(c.targetId)) out.push(`targetId "${c.targetId}" does not exist in this model`);
  if (c.kind === 'activity' && !nodes.has(c.ownerId)) out.push(`ownerId "${c.ownerId}" does not exist in this model`);
  if (c.kind === 'relationship') {
    if (!nodes.has(c.fromId)) out.push(`fromId "${c.fromId}" does not exist in this model`);
    if (!nodes.has(c.toId)) out.push(`toId "${c.toId}" does not exist in this model`);
    if (c.fromId === c.toId) out.push('source and destination are the same');
    if (c.performerId && !nodes.has(c.performerId)) out.push(`performerId "${c.performerId}" does not exist in this model`);
  }
  return out;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
/** A stable fingerprint used to detect duplicates among candidates. */
export function candidateFingerprint(c: Candidate): string {
  switch (c.kind) {
    case 'note': return `note|${c.noteType}|${c.targetId ?? ''}|${norm(c.text)}`;
    case 'node': return `node|${c.nodeType}|${norm(c.label)}`;
    case 'relationship': return `rel|${c.fromId}|${c.toId}|${c.connectionType}|${norm(c.label)}`;
    case 'activity': return `act|${c.ownerId}|${norm(c.label)}`;
    case 'contradiction': return `con|${c.targetId ?? ''}|${norm(c.text)}`;
    case 'measurement_target': return `mt|${c.targetId ?? ''}|${norm(c.metric)}`;
    default: return `as|${c.recommendation}|${norm(c.optionLabel ?? c.summary)}`;
  }
}
/** True when the model already contains what the candidate proposes. */
export function alreadyInModel(c: Candidate, m: Model): boolean {
  if (c.kind === 'node') return m.nodes.some((n) => n.kind === c.nodeType && norm(n.label) === norm(c.label));
  if (c.kind === 'relationship') return m.edges.some((e) => e.from === c.fromId && e.to === c.toId && e.type === c.connectionType && norm(e.label) === norm(c.label));
  if (c.kind === 'activity') return m.activities.some((a) => !a.edgeId && a.ownerNodeId === c.ownerId && norm(a.label) === norm(c.label));
  return false;
}

export interface ModelPatch { model: Model; created: { kind: 'node' | 'edge' | 'activity'; id: string }; position?: { x: number; y: number } }

/** The proposed model diff for node / relationship / activity candidates. Pure: returns a new model. */
export function applyToModel(c: Candidate, m: Model, layout: Record<string, { x: number; y: number }> = {}): ModelPatch | null {
  const next: Model = structuredClone(m);
  const taken = [...m.nodes, ...m.edges, ...m.activities].map((x) => x.id);
  if (c.kind === 'node') {
    const id = newId('n', taken);
    next.nodes.push({ id, kind: c.nodeType, label: c.label, role: '', description: c.summary, scope: 'internal', parentId: null });
    const positions = m.nodes.filter((n) => Object.hasOwn(layout, n.id)).map((n) => layout[n.id]);
    const ys = positions.map((p) => p.y), xs = positions.map((p) => p.x);
    return { model: next, created: { kind: 'node', id }, position: { x: xs.length ? Math.min(...xs) : 200, y: (ys.length ? Math.max(...ys) : 200) + 190 } };
  }
  if (c.kind === 'relationship') {
    const id = newId('e', taken);
    const operational = c.connectionType === 'flow' || c.connectionType === 'info';
    const activityId = operational ? newId('a', [...taken, id]) : null;
    next.edges.push({ id, from: c.fromId, to: c.toId, type: c.connectionType, label: c.label, directed: c.connectionType !== 'association', activityId, workItem: c.workItem ?? '', result: c.result ?? '', inputState: c.inputState ?? '', outputState: c.outputState ?? '', conditions: '', exceptions: '', description: c.summary });
    if (activityId) next.activities.push({ id: activityId, edgeId: id, ownerNodeId: null, performerId: c.performerId ?? null, actionCode: (c.actionCode as ActionCode | undefined) ?? null, label: c.label, includedInWorkload: true, activeMinutes: unknownQty('min'), waitMinutes: unknownQty('min'), occurrencesPerCase: qty(1, 'per case', 'assumed') });
    return { model: next, created: { kind: 'edge', id } };
  }
  if (c.kind === 'activity') {
    const id = newId('a', taken);
    const basis = c.certainty === 'observed' ? 'measured' : c.certainty === 'reported' ? 'reported' : 'estimated';
    next.activities.push({ id, edgeId: null, ownerNodeId: c.ownerId, performerId: c.ownerId, actionCode: null, label: c.label, includedInWorkload: true,
      activeMinutes: c.minutes === null ? unknownQty('min') : qty(c.minutes, 'min', basis, { method: c.measurementBasis, sourceIds: [c.sourceId] }), waitMinutes: unknownQty('min'), occurrencesPerCase: qty(1, 'per case', 'assumed') });
    return { model: next, created: { kind: 'activity', id } };
  }
  return null;
}

export const CANDIDATE_KIND_LABEL: Record<Candidate['kind'], string> = {
  note: 'Note', node: 'New node', relationship: 'New connection', activity: 'New activity', contradiction: 'Source disagreement', measurement_target: 'Measurement gap', assessment: 'Option assessment',
};
