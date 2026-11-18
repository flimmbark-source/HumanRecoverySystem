// The importable/exportable workspace bundle. Everything a project owns, with project-scoped stable IDs.
import { z } from 'zod';
import { idSchema, layoutSchema, validateModel, type Model, type ValidationIssue } from './model';

export const WORKSPACE_FORMAT = 'weave-workspace';
export const WORKSPACE_SCHEMA_VERSION = 3;

export const NOTE_KINDS = ['observation', 'measurement', 'hypothesis', 'question', 'insight', 'recommendation'] as const;
export const SOURCE_TYPES = ['interview', 'observation', 'walkthrough', 'document', 'public', 'working'] as const;
export const RELATIONS = ['supports', 'contradicts', 'related', 'possible_cause'] as const;
export const OPTION_KINDS = ['status_quo', 'process_change', 'existing_tool', 'bespoke_tool'] as const;
export const DECISION_STATES = ['exploring', 'hypothesis', 'recommended', 'deferred', 'closed'] as const;
export const CANDIDATE_STATUSES = ['pending', 'accepted', 'rejected', 'needs_evidence'] as const;
export const RUN_STATUSES = ['queued', 'running', 'ready_for_review', 'failed', 'cancelled'] as const;

export const RELATION_LABEL: Record<(typeof RELATIONS)[number], string> = { supports: 'Supports', contradicts: 'Contradicts', related: 'Related', possible_cause: 'Possible cause' };
export const OPTION_KIND_LABEL: Record<(typeof OPTION_KINDS)[number], string> = { status_quo: 'Keep the current approach', process_change: 'Process or policy change', existing_tool: 'Existing tool', bespoke_tool: 'Bespoke tool' };

const text = (max: number) => z.string().max(max).default('');

export const projectMetaSchema = z.object({
  name: z.string().min(1).max(200),
  researchQuestion: text(2000), orgUnit: text(300), scopeDescription: text(4000), startLabel: text(300),
  intendedOutcome: text(2000), externalInterfaces: text(2000), status: z.enum(['draft', 'active', 'archived']).default('draft'),
});
export type ProjectMeta = z.infer<typeof projectMetaSchema>;

export const sourceSchema = z.object({
  id: idSchema,
  anonId: z.string().min(1).max(200), // anonymous label such as "Interview 04"
  type: z.enum(SOURCE_TYPES).default('interview'),
  participantRole: text(200), // role level only
  date: text(40), collection: text(200),
  agentApproved: z.boolean().default(false), // may be sent to a research provider
  exportApproved: z.boolean().default(false), // anonymous ID may be cited in leadership exports
  publicUrl: text(2000), retrievedAt: text(40),
});
export type Source = z.infer<typeof sourceSchema>;

export const episodeSchema = z.object({
  task: text(1000), intendedOutcome: text(1000), action: text(2000), helped: text(2000), hindered: text(2000),
  outcome: text(2000), hiddenEffort: text(2000), clarification: text(2000),
});
export type Episode = z.infer<typeof episodeSchema>;

export const noteSchema = z.object({
  id: idSchema,
  kind: z.enum(NOTE_KINDS).default('observation'),
  text: z.string().min(1).max(8000),
  rawText: text(8000), // the note as first captured; preserved when the text is reworked
  sourceId: idSchema.nullable().default(null),
  certainty: z.enum(['observed', 'reported', 'inferred']).nullable().default(null),
  group: text(200), color: text(20), category: text(100),
  targetId: idSchema.nullable().default(null), // node, connection or activity ID in the model
  anchorBranchId: idSchema.nullable().default(null),
  anchorRevisionId: idSchema.nullable().default(null),
  episode: episodeSchema.nullable().default(null),
  excerptApproved: z.boolean().default(false), // this text may be sent to a provider and quoted in exports
  createdAt: text(40),
});
export type Note = z.infer<typeof noteSchema>;

export const insightSchema = z.object({
  id: idSchema, title: text(300), body: text(20000),
  modelLinks: z.array(idSchema).max(50).default([]),
  // For a linked map item, the details the insight is about (keys from itemFacts). No entry means the whole item.
  focus: z.record(idSchema, z.array(z.string().max(40)).max(30)).default({}),
  createdAt: text(40), updatedAt: text(40),
});
export type Insight = z.infer<typeof insightSchema>;

export const linkSchema = z.object({
  id: idSchema,
  fromType: z.enum(['note', 'insight']), fromId: idSchema,
  toType: z.enum(['note', 'insight']), toId: idSchema,
  relation: z.enum(RELATIONS), comment: text(1000),
});
export type EvidenceLink = z.infer<typeof linkSchema>;

const score = z.number().int().min(1).max(5).nullable().default(null);
export const opportunitySchema = z.object({
  id: idSchema, title: z.string().min(1).max(300),
  reportTitle: z.string().max(300).optional(),
  insightIds: z.array(idSchema).max(50).default([]),
  noteIds: z.array(idSchema).max(200).default([]),
  targetIds: z.array(idSchema).max(50).default([]),
  interpretation: text(6000), uncertainty: text(6000), preserve: text(6000), stakeholders: text(4000),
  validationPlan: text(6000), decisionState: z.enum(DECISION_STATES).default('exploring'),
  recommendedOptionId: idSchema.nullable().default(null),
  criteria: z.object({ evidenceStrength: score, effort: score, expectedValue: score, humanRisk: score }).default({}),
  rank: z.number().int().nullable().default(null),
  closeReason: text(2000), internalNotes: text(6000),
  citedRevisions: z.record(idSchema, idSchema).default({}), // branchId -> revision the recommendation was written against
});
export type Opportunity = z.infer<typeof opportunitySchema>;

export const optionSchema = z.object({
  id: idSchema, opportunityId: idSchema, kind: z.enum(OPTION_KINDS), title: z.string().min(1).max(300),
  benefits: text(4000), downsides: text(4000), shiftedWork: text(4000), effort: text(2000), costs: text(2000),
  tradeoffs: text(4000), confidence: z.enum(['low', 'medium', 'high', 'unknown']).default('unknown'),
  unknowns: text(4000), test: text(4000), smallestReversible: z.boolean().default(false),
  withinPilotScope: z.boolean().default(true),
  scenarioBranchId: idSchema.nullable().default(null),
});
export type DecisionOption = z.infer<typeof optionSchema>;

export const branchSchema = z.object({
  id: idSchema, kind: z.enum(['baseline', 'scenario']), name: z.string().min(1).max(200), hypothesis: text(4000),
  parentBranchId: idSchema.nullable().default(null),
  baseRevisionId: idSchema.nullable().default(null), // pinned, immutable comparison revision
  headRevisionId: idSchema,
  layout: layoutSchema.default({}),
  origin: z.object({ type: z.enum(['insight', 'opportunity', 'option', 'blank']), id: idSchema.nullable() }).nullable().default(null),
  status: z.enum(['draft', 'in_review', 'reviewed']).default('draft'),
  createdAt: text(40),
});
export type Branch = z.infer<typeof branchSchema>;

export const revisionSchema = z.object({
  id: idSchema, branchId: idSchema, parentRevisionId: idSchema.nullable().default(null),
  seq: z.number().int().min(1), summary: text(500), author: text(200), createdAt: text(40),
  restoredFrom: idSchema.nullable().default(null),
  model: z.unknown(),
});
export type Revision = Omit<z.infer<typeof revisionSchema>, 'model'> & { model: Model };

export const candidateRecordSchema = z.object({
  id: idSchema, runId: idSchema.nullable().default(null), origin: z.enum(['agent', 'import', 'fixture']).default('import'),
  schemaVersion: z.number().int(), payload: z.record(z.unknown()),
  status: z.enum(CANDIDATE_STATUSES).default('pending'),
  baseRevisionId: idSchema.nullable().default(null), duplicateOf: idSchema.nullable().default(null),
  reviewer: text(200), reviewedAt: text(40), reviewNote: text(2000),
  applied: z.record(z.string()).nullable().default(null),
});
export type CandidateRecord = z.infer<typeof candidateRecordSchema>;

export const runRecordSchema = z.object({
  id: idSchema, mode: z.enum(['wide', 'deep']), status: z.enum(RUN_STATUSES), question: text(4000), provider: text(100),
  input: z.record(z.unknown()).default({}), result: z.record(z.unknown()).nullable().default(null), error: text(2000),
  createdAt: text(40), finishedAt: text(40),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

export const bundleSchema = z.object({
  format: z.literal(WORKSPACE_FORMAT),
  schemaVersion: z.literal(WORKSPACE_SCHEMA_VERSION),
  exportedAt: text(40),
  project: projectMetaSchema,
  branches: z.array(branchSchema).min(1).max(200),
  revisions: z.array(revisionSchema).min(1).max(5000),
  sources: z.array(sourceSchema).max(2000).default([]),
  notes: z.array(noteSchema).max(10000).default([]),
  insights: z.array(insightSchema).max(2000).default([]),
  links: z.array(linkSchema).max(20000).default([]),
  opportunities: z.array(opportunitySchema).max(500).default([]),
  options: z.array(optionSchema).max(2000).default([]),
  runs: z.array(runRecordSchema).max(500).default([]),
  candidates: z.array(candidateRecordSchema).max(5000).default([]),
});
export type Bundle = Omit<z.infer<typeof bundleSchema>, 'revisions'> & { revisions: Revision[] };

/** Full validation: structure, duplicate IDs, and every cross reference. No partial acceptance. */
export function validateBundle(input: unknown): { bundle?: Bundle; issues: ValidationIssue[] } {
  const parsed = bundleSchema.safeParse(input);
  if (!parsed.success) return { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.') || 'file', message: i.message })) };
  const b = parsed.data;
  const issues: ValidationIssue[] = [];
  const ids = (kind: string, list: { id: string }[]) => {
    const s = new Set<string>();
    list.forEach((x, i) => { if (s.has(x.id)) issues.push({ path: `${kind}.${i}.id`, message: `duplicate ID "${x.id}"` }); s.add(x.id); });
    return s;
  };
  const branchIds = ids('branches', b.branches), revIds = ids('revisions', b.revisions), sourceIds = ids('sources', b.sources);
  const noteIds = ids('notes', b.notes), insightIds = ids('insights', b.insights), oppIds = ids('opportunities', b.opportunities);
  const optionIds = ids('options', b.options), runIds = ids('runs', b.runs), candIds = ids('candidates', b.candidates);
  ids('links', b.links);
  const need = (set: Set<string>, id: string | null | undefined, path: string, what: string) => { if (id && !set.has(id)) issues.push({ path, message: `${what} "${id}" does not exist` }); };

  if (b.branches.filter((x) => x.kind === 'baseline').length !== 1) issues.push({ path: 'branches', message: 'a workspace needs exactly one baseline' });
  const revisions: Revision[] = [];
  b.revisions.forEach((r, i) => {
    need(branchIds, r.branchId, `revisions.${i}.branchId`, 'branch');
    need(revIds, r.parentRevisionId, `revisions.${i}.parentRevisionId`, 'parent revision');
    const v = validateModel(r.model);
    for (const issue of v.issues) issues.push({ path: `revisions.${i}.model.${issue.path}`, message: issue.message });
    if (v.model) revisions.push({ ...r, model: v.model });
  });
  b.branches.forEach((br, i) => {
    need(revIds, br.headRevisionId, `branches.${i}.headRevisionId`, 'revision');
    need(revIds, br.baseRevisionId, `branches.${i}.baseRevisionId`, 'base revision');
    need(branchIds, br.parentBranchId, `branches.${i}.parentBranchId`, 'parent branch');
    if (br.kind === 'scenario' && !br.baseRevisionId) issues.push({ path: `branches.${i}.baseRevisionId`, message: 'a scenario needs a pinned comparison revision' });
    const head = b.revisions.find((r) => r.id === br.headRevisionId);
    if (head && head.branchId !== br.id) issues.push({ path: `branches.${i}.headRevisionId`, message: 'head revision belongs to another branch' });
  });
  b.notes.forEach((n, i) => {
    need(sourceIds, n.sourceId, `notes.${i}.sourceId`, 'source');
    need(branchIds, n.anchorBranchId, `notes.${i}.anchorBranchId`, 'branch');
    need(revIds, n.anchorRevisionId, `notes.${i}.anchorRevisionId`, 'revision');
    if (n.targetId) {
      // The anchor must exist in the revision it was attached against (or in some revision, for unanchored legacy records).
      const pool = n.anchorRevisionId ? revisions.filter((r) => r.id === n.anchorRevisionId) : revisions;
      const found = pool.some((r) => r.model.nodes.some((x) => x.id === n.targetId) || r.model.edges.some((x) => x.id === n.targetId) || r.model.activities.some((x) => x.id === n.targetId));
      if (!found && revisions.length === b.revisions.length) issues.push({ path: `notes.${i}.targetId`, message: `target "${n.targetId}" does not exist in the model it is anchored to` });
    }
  });
  const end = (type: string, id: string, path: string) => need(type === 'note' ? noteIds : insightIds, id, path, type);
  b.links.forEach((l, i) => {
    end(l.fromType, l.fromId, `links.${i}.fromId`); end(l.toType, l.toId, `links.${i}.toId`);
    if (l.fromType === l.toType && l.fromId === l.toId) issues.push({ path: `links.${i}`, message: 'a record cannot link to itself' });
  });
  b.opportunities.forEach((o, i) => {
    o.insightIds.forEach((id, j) => need(insightIds, id, `opportunities.${i}.insightIds.${j}`, 'insight'));
    o.noteIds.forEach((id, j) => need(noteIds, id, `opportunities.${i}.noteIds.${j}`, 'note'));
    need(optionIds, o.recommendedOptionId, `opportunities.${i}.recommendedOptionId`, 'option');
  });
  b.options.forEach((o, i) => { need(oppIds, o.opportunityId, `options.${i}.opportunityId`, 'opportunity'); need(branchIds, o.scenarioBranchId, `options.${i}.scenarioBranchId`, 'scenario'); });
  b.candidates.forEach((c, i) => { need(runIds, c.runId, `candidates.${i}.runId`, 'research run'); need(candIds, c.duplicateOf, `candidates.${i}.duplicateOf`, 'candidate'); });
  if (issues.length) return { issues };
  return { bundle: { ...b, revisions }, issues: [] };
}
