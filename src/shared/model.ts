// Versioned operational model. This is the content of one immutable revision.
// Layout (node positions) is stored separately so that moving a node is not an operational change.
import { z } from 'zod';

export const MODEL_SCHEMA_VERSION = 3;

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'IDs use letters, digits, _ or - (max 64)');

export const NODE_KINDS = ['person', 'system', 'resource', 'output', 'group'] as const;
export const SCOPES = ['internal', 'external', 'context'] as const;
export const EDGE_TYPES = ['flow', 'info', 'dependency', 'authority', 'association'] as const;
export const ACTION_CODES = ['submit', 'review', 'check', 'approve', 'request', 'match', 'notify', 'record', 'transfer', 'process', 'transform'] as const;
export const BASIS = ['measured', 'reported', 'estimated', 'assumed', 'unverified', 'unknown'] as const;

export type NodeKind = (typeof NODE_KINDS)[number];
export type EdgeType = (typeof EDGE_TYPES)[number];
export type ActionCode = (typeof ACTION_CODES)[number];
export type Basis = (typeof BASIS)[number];

const finite = z.number().refine(Number.isFinite, 'must be a finite number');

// A quantity that may be a point value, a range, or unknown. `null` value means unknown; 0 is a real zero.
export const quantitySchema = z
  .object({
    value: finite.nullable(),
    min: finite.optional(),
    max: finite.optional(),
    unit: z.string().max(40),
    basis: z.enum(BASIS).default('unknown'),
    sourceIds: z.array(z.string().max(200)).max(50).default([]),
    method: z.string().max(1000).optional(),
    sampleSize: finite.optional(),
    asOf: z.string().max(40).optional(),
    note: z.string().max(1000).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.min !== undefined && q.max !== undefined && q.min > q.max) ctx.addIssue({ code: 'custom', message: 'range minimum exceeds maximum' });
    if (q.value !== null && q.value < 0) ctx.addIssue({ code: 'custom', message: 'value cannot be negative' });
  });
export type Quantity = z.infer<typeof quantitySchema>;

export const unknownQty = (unit: string): Quantity => ({ value: null, unit, basis: 'unknown', sourceIds: [] });
export const qty = (value: number | null, unit: string, basis: Basis = 'unverified', extra: Partial<Quantity> = {}): Quantity => ({
  value, unit, basis: value === null && basis !== 'unknown' && extra.min === undefined ? 'unknown' : basis, sourceIds: [], ...extra,
});

export const nodeSchema = z.object({
  id: idSchema,
  kind: z.enum(NODE_KINDS),
  label: z.string().min(1).max(140),
  role: z.string().max(200).default(''),
  description: z.string().max(4000).default(''),
  scope: z.enum(SCOPES).default('internal'),
  parentId: idSchema.nullable().default(null),
});
export type WNode = z.infer<typeof nodeSchema>;

export const edgeSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  type: z.enum(EDGE_TYPES),
  label: z.string().min(1).max(140),
  directed: z.boolean().default(true),
  activityId: idSchema.nullable().default(null),
  workItem: z.string().max(250).default(''),
  result: z.string().max(250).default(''),
  inputState: z.string().max(250).default(''),
  outputState: z.string().max(250).default(''),
  conditions: z.string().max(1000).default(''),
  exceptions: z.string().max(1000).default(''),
  description: z.string().max(4000).default(''),
});
export type WEdge = z.infer<typeof edgeSchema>;

// The activity is the single authoritative record for performer, action and timing.
export const activitySchema = z.object({
  id: idSchema,
  edgeId: idSchema.nullable().default(null), // null = internal activity owned by a node
  ownerNodeId: idSchema.nullable().default(null), // where an internal activity sits
  performerId: idSchema.nullable().default(null), // explicit; never derived from direction
  actionCode: z.enum(ACTION_CODES).nullable().default(null),
  label: z.string().min(1).max(140),
  includedInWorkload: z.boolean().default(true),
  activeMinutes: quantitySchema,
  waitMinutes: quantitySchema,
  occurrencesPerCase: quantitySchema,
});
export type WActivity = z.infer<typeof activitySchema>;

export const routeStepSchema = z.object({
  id: idSchema,
  kind: z.enum(['edge', 'activity']),
  refId: idSchema,
  note: z.string().max(300).optional(),
});
export const routeSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(140),
  startNodeId: idSchema.nullable().default(null),
  endNodeId: idSchema.nullable().default(null),
  steps: z.array(routeStepSchema).max(200),
  caseWeight: finite.nullable().default(null), // share of cases, when known
});
export type WRoute = z.infer<typeof routeSchema>;

export const cashItemSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(200),
  kind: z.enum(['recurring_saving', 'recurring_cost', 'one_time_cost']),
  amount: finite.nullable(),
  currency: z.string().max(8),
  period: z.enum(['month', 'year', 'once']),
  mechanism: z.string().max(1000).default(''), // the documented cost mechanism; required to count as cash
  basis: z.enum(BASIS).default('unknown'),
  sourceIds: z.array(z.string().max(200)).default([]),
});
export type CashItem = z.infer<typeof cashItemSchema>;

export const humanEffectSchema = z.object({
  id: idSchema,
  role: z.string().max(200), // role or workflow level only; never an individual
  nodeId: idSchema.nullable().default(null),
  kind: z.enum(['benefit', 'added_work', 'shifted_work', 'lost_contact', 'accessibility', 'relationship', 'quality', 'risk']),
  direction: z.enum(['positive', 'negative', 'uncertain']),
  description: z.string().max(2000),
  magnitude: quantitySchema.nullable().default(null), // null = qualitative, numeric magnitude unknown
  missingData: z.string().max(1000).default(''),
  validation: z.string().max(1000).default(''),
});
export type HumanEffect = z.infer<typeof humanEffectSchema>;

export const guardrailSchema = z.object({
  id: idSchema,
  metric: z.string().min(1).max(200),
  denominator: z.string().max(200).default(''),
  baselinePeriod: z.string().max(200).default(''),
  baseline: quantitySchema.nullable().default(null),
  target: z.string().max(200).default(''),
  direction: z.enum(['higher_is_better', 'lower_is_better', 'hold']).default('hold'),
  owner: z.string().max(200).default(''),
  method: z.string().max(500).default(''),
  followUp: z.string().max(100).default(''),
  rollbackTrigger: z.string().max(500).default(''),
});
export type Guardrail = z.infer<typeof guardrailSchema>;

export const workingConditionSchema = z.object({
  id: idSchema,
  role: z.string().max(200),
  indicator: z.string().max(200), // e.g. interruptions, after-hours work, unplanned coverage
  baseline: z.string().max(300).default(''),
  expected: z.string().max(300).default(''),
  basis: z.enum(BASIS).default('unknown'),
  note: z.string().max(1000).default(''),
});
export type WorkingCondition = z.infer<typeof workingConditionSchema>;

export const assessmentSchema = z.object({
  currency: z.string().max(8).default(''),
  horizonMonths: finite.nullable().default(null),
  hourlyRate: quantitySchema.nullable().default(null), // capacity valuation only; not cash
  cashItems: z.array(cashItemSchema).max(100).default([]),
  humanEffects: z.array(humanEffectSchema).max(100).default([]),
  guardrails: z.array(guardrailSchema).max(100).default([]),
  workingConditions: z.array(workingConditionSchema).max(100).default([]),
  preserve: z.string().max(4000).default(''), // what already works and is protected
  reversal: z.string().max(4000).default(''), // how the change is undone
  participantFeedback: z.string().max(4000).default(''),
  unknowns: z.string().max(4000).default(''),
  validation: z.string().max(4000).default(''),
});
export type Assessment = z.infer<typeof assessmentSchema>;

export const emptyAssessment = (): Assessment => assessmentSchema.parse({});

export const modelSchema = z.object({
  schemaVersion: z.literal(MODEL_SCHEMA_VERSION),
  name: z.string().max(200).default(''),
  volume: quantitySchema, // cases per month
  startNodeId: idSchema.nullable().default(null),
  nodes: z.array(nodeSchema).max(500),
  edges: z.array(edgeSchema).max(1500),
  activities: z.array(activitySchema).max(2000),
  routes: z.array(routeSchema).max(100).default([]),
  assessment: assessmentSchema.default({}),
});
export type Model = z.infer<typeof modelSchema>;

export interface ValidationIssue { path: string; message: string }

/** Referential integrity on top of the structural schema. Returns field-level issues; empty = valid. */
export function validateModel(input: unknown): { model?: Model; issues: ValidationIssue[] } {
  const parsed = modelSchema.safeParse(input);
  if (!parsed.success) {
    return { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.') || 'model', message: i.message })) };
  }
  const m = parsed.data;
  const issues: ValidationIssue[] = [];
  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => { if (seen.has(id)) issues.push({ path: `${kind}.${i}.id`, message: `duplicate ID "${id}"` }); seen.add(id); });
    return seen;
  };
  const nodeIds = dup('nodes', m.nodes.map((n) => n.id));
  const edgeIds = dup('edges', m.edges.map((e) => e.id));
  const actIds = dup('activities', m.activities.map((a) => a.id));
  dup('routes', m.routes.map((r) => r.id));
  const all = [...m.nodes.map((n) => n.id), ...m.edges.map((e) => e.id), ...m.activities.map((a) => a.id)];
  const seenAll = new Set<string>();
  for (const id of all) { if (seenAll.has(id)) issues.push({ path: 'model', message: `ID "${id}" is used by more than one kind of record` }); seenAll.add(id); }

  m.nodes.forEach((n, i) => {
    if (n.parentId && !nodeIds.has(n.parentId)) issues.push({ path: `nodes.${i}.parentId`, message: `parent "${n.parentId}" does not exist` });
    if (n.parentId === n.id) issues.push({ path: `nodes.${i}.parentId`, message: 'a node cannot contain itself' });
  });
  if (m.startNodeId && !nodeIds.has(m.startNodeId)) issues.push({ path: 'startNodeId', message: `start node "${m.startNodeId}" does not exist` });
  const actByEdge = new Map<string, string>();
  m.activities.forEach((a, i) => {
    if (a.edgeId) {
      if (!edgeIds.has(a.edgeId)) issues.push({ path: `activities.${i}.edgeId`, message: `connection "${a.edgeId}" does not exist` });
      if (actByEdge.has(a.edgeId)) issues.push({ path: `activities.${i}.edgeId`, message: `connection "${a.edgeId}" already has activity "${actByEdge.get(a.edgeId)}"; timing would be double counted` });
      actByEdge.set(a.edgeId, a.id);
    } else if (!a.ownerNodeId) issues.push({ path: `activities.${i}.ownerNodeId`, message: 'an internal activity needs an owning node' });
    if (a.ownerNodeId && !nodeIds.has(a.ownerNodeId)) issues.push({ path: `activities.${i}.ownerNodeId`, message: `node "${a.ownerNodeId}" does not exist` });
    if (a.performerId && !nodeIds.has(a.performerId)) issues.push({ path: `activities.${i}.performerId`, message: `performer "${a.performerId}" does not exist` });
  });
  m.edges.forEach((e, i) => {
    if (!nodeIds.has(e.from)) issues.push({ path: `edges.${i}.from`, message: `source "${e.from}" does not exist` });
    if (!nodeIds.has(e.to)) issues.push({ path: `edges.${i}.to`, message: `destination "${e.to}" does not exist` });
    if (e.from === e.to) issues.push({ path: `edges.${i}.to`, message: 'source and destination are the same node' });
    if (e.activityId) {
      if (!actIds.has(e.activityId)) issues.push({ path: `edges.${i}.activityId`, message: `activity "${e.activityId}" does not exist` });
      else if (actByEdge.get(e.id) !== e.activityId) issues.push({ path: `edges.${i}.activityId`, message: `activity "${e.activityId}" is not attached to this connection` });
    }
  });
  m.routes.forEach((r, i) => {
    dup(`routes.${i}.steps`, r.steps.map((s) => s.id));
    if (r.startNodeId && !nodeIds.has(r.startNodeId)) issues.push({ path: `routes.${i}.startNodeId`, message: `node "${r.startNodeId}" does not exist` });
    if (r.endNodeId && !nodeIds.has(r.endNodeId)) issues.push({ path: `routes.${i}.endNodeId`, message: `node "${r.endNodeId}" does not exist` });
    // Steps may reference removed items inside a scenario; that is reported by route analysis, not rejected here.
  });
  const a = m.assessment;
  dup('assessment.cashItems', a.cashItems.map((c) => c.id));
  dup('assessment.humanEffects', a.humanEffects.map((c) => c.id));
  dup('assessment.guardrails', a.guardrails.map((c) => c.id));
  return issues.length ? { issues } : { model: m, issues: [] };
}

export type Layout = Record<string, { x: number; y: number }>;
export const layoutSchema = z.record(idSchema, z.object({ x: finite, y: finite }));

export const emptyModel = (name = ''): Model => ({
  schemaVersion: MODEL_SCHEMA_VERSION, name, volume: unknownQty('cases/month'), startNodeId: null,
  nodes: [], edges: [], activities: [], routes: [], assessment: emptyAssessment(),
});

export const activityForEdge = (m: Model, edgeId: string): WActivity | null =>
  m.activities.find((a) => a.edgeId === edgeId) ?? null;

export const EDGE_TYPE_LABEL: Record<EdgeType, string> = {
  flow: 'Work flow', info: 'Information', dependency: 'Dependency', authority: 'Authority', association: 'Association',
};
export const EDGE_TYPE_HINT: Record<EdgeType, string> = {
  flow: 'something moves', info: 'communication', dependency: 'prerequisite', authority: 'responsibility', association: 'related',
};
export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  person: 'Person / role', system: 'System', resource: 'Resource', output: 'Output', group: 'Group',
};

let counter = 0;
export function newId(prefix: string, taken?: Iterable<string>): string {
  const used = new Set(taken ?? []);
  for (;;) {
    counter = (counter + 1) % 1679616;
    const id = `${prefix}-${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1296).toString(36)}${counter.toString(36)}`;
    if (!used.has(id)) return id;
  }
}

export function fmtQty(q: Quantity | null | undefined, digits = 1): string {
  if (!q) return 'Unknown';
  const f = (n: number) => (Math.round(n * 10 ** digits) / 10 ** digits).toLocaleString('en-US', { maximumFractionDigits: digits });
  if (q.value !== null) return f(q.value);
  if (q.min !== undefined && q.max !== undefined) return `${f(q.min)}–${f(q.max)}`;
  return 'Unknown';
}
