// A worked example: one whole study of a referral workflow, from the first interviews to a recommendation.
// Everything in it is invented. It gives each part of Weave something to show: the map and its routes,
// sources, notes, the archive, insights, decisions, a scenario, a draft from notes and findings to review.
import type { z } from 'zod';
import { MODEL_SCHEMA_VERSION, modelSchema, qty, unknownQty, type Basis, type Layout, type Model, type Quantity } from '../shared/model';
import {
  WORKSPACE_FORMAT, WORKSPACE_SCHEMA_VERSION, validateBundle, type Bundle,
  type candidateRecordSchema, type importSchema, type insightSchema, type linkSchema, type noteSchema, type opportunitySchema, type optionSchema, type runRecordSchema, type sourceSchema,
} from '../shared/workspace';

const EXAMPLE_NAME = 'Referral to first session (worked example)';

type NoteIn = z.input<typeof noteSchema>;
type ImportIn = z.input<typeof importSchema>;

const min = (value: number | null, basis: Basis, extra: Partial<Quantity> = {}) => qty(value, 'min', basis, extra);
const perCase = (value: number, basis: Basis, extra: Partial<Quantity> = {}) => qty(value, 'per case', basis, extra);

// ---- the map ----------------------------------------------------------------------------------------------
function baselineModel(): Model {
  return modelSchema.parse({
    schemaVersion: MODEL_SCHEMA_VERSION, name: 'Referral to first session', startNodeId: 'n-person',
    volume: qty(46, 'cases/month', 'measured', { sourceIds: ['src-d02'], method: 'New referrals in the case record, average of September and October', asOf: '2026-10-30' }),
    nodes: [
      { id: 'n-person', kind: 'person', label: 'Person referred', role: 'Service user', description: 'Someone asking for support, by the online form or through a partner agency.', scope: 'external' },
      { id: 'n-partner', kind: 'person', label: 'Partner agency', role: 'Referrer', description: 'GP surgeries and housing officers who refer people by email.', scope: 'external' },
      { id: 'n-inbox', kind: 'system', label: 'Referrals inbox', role: 'Shared email inbox', description: 'Receives online referral forms and emails from partner agencies.' },
      { id: 'n-duty', kind: 'person', label: 'Duty worker', role: 'Staff role on a daily rota', description: 'Screens referrals, makes the intake call and covers the phone line.', parentId: 'n-team' },
      { id: 'n-crm', kind: 'system', label: 'Case record system', role: 'Case management database', description: 'Holds the intake record. The funder’s reports come from it.' },
      { id: 'n-sheet', kind: 'resource', label: 'Allocation spreadsheet', role: 'Working waiting list', description: 'Shared spreadsheet of cases that wait for allocation.' },
      { id: 'n-lead', kind: 'person', label: 'Team lead', role: 'Chairs the allocation meeting', description: 'Allocates cases with the team every Tuesday.', parentId: 'n-team' },
      { id: 'n-support', kind: 'person', label: 'Support worker', role: 'Staff role', description: 'Books and holds first sessions.', parentId: 'n-team' },
      { id: 'n-first', kind: 'output', label: 'First session held', role: 'Outcome', description: 'The person has met their support worker for the first time.' },
      { id: 'n-policy', kind: 'resource', label: 'Referral procedure', role: 'Written procedure, version 3', description: 'Says that referrals are screened on the day they arrive and that people are contacted within two working days.', scope: 'context' },
      { id: 'n-team', kind: 'group', label: 'Support team', role: 'Staff team', description: 'Duty workers, support workers, the volunteer coordinator and the team lead.' },
      { id: 'n-volco', kind: 'person', label: 'Volunteer coordinator', role: 'Staff role', description: 'Keeps track of peer mentors and when they are free.', parentId: 'n-team' },
      { id: 'n-mentor', kind: 'person', label: 'Peer mentor', role: 'Volunteer', description: 'Volunteers with lived experience who join some support sessions.', scope: 'external' },
    ],
    edges: [
      { id: 'e-submit', from: 'n-person', to: 'n-inbox', type: 'flow', label: 'Submit referral form', activityId: 'a-submit', workItem: 'Referral form', inputState: 'filled in', outputState: 'in the inbox', result: 'New referral', description: 'The online form sends each self-referral to the shared inbox.' },
      { id: 'e-partner', from: 'n-partner', to: 'n-inbox', type: 'flow', label: 'Email a referral', activityId: 'a-partner', workItem: 'Referral email', inputState: 'written', outputState: 'in the inbox', result: 'New referral', conditions: 'Partner agencies use their own letter or the referral form.', exceptions: 'About one in four arrive without a phone number or consent.' },
      { id: 'e-screen', from: 'n-inbox', to: 'n-duty', type: 'flow', label: 'Screen referral', activityId: 'a-screen', workItem: 'Referral', inputState: 'in the inbox', outputState: 'screened', result: 'Screened referral', conditions: 'One duty worker a day, on a rota.', exceptions: 'Screening stops until missing details come back.' },
      { id: 'e-record', from: 'n-duty', to: 'n-crm', type: 'flow', label: 'Record intake', activityId: 'a-record', workItem: 'Intake note', inputState: 'on paper', outputState: 'on the case record', result: 'Case record' },
      { id: 'e-copy', from: 'n-crm', to: 'n-sheet', type: 'flow', label: 'Copy to waiting list', activityId: 'a-copy', workItem: 'Case summary', inputState: 'on the case record', outputState: 'on the waiting list', result: 'Waiting list row', description: 'The same summary is typed again, because the allocation meeting works from the spreadsheet.' },
      { id: 'e-allocate', from: 'n-sheet', to: 'n-lead', type: 'flow', label: 'Allocate at meeting', activityId: 'a-allocate', workItem: 'Waiting case', inputState: 'on the waiting list', outputState: 'allocated', result: 'Allocated case', conditions: 'Every Tuesday, with the whole support team.', description: 'Five staff attend a 90-minute meeting. The active time counts staff minutes for each case.' },
      { id: 'e-assign', from: 'n-lead', to: 'n-support', type: 'flow', label: 'Hand case to worker', activityId: 'a-assign', workItem: 'Allocated case', inputState: 'allocated', outputState: 'with a worker', result: 'Case on a worker’s list' },
      { id: 'e-session', from: 'n-support', to: 'n-first', type: 'flow', label: 'Hold first session', activityId: 'a-session', workItem: 'Case', inputState: 'session booked', outputState: 'first session held', result: 'Support plan started' },
      { id: 'e-avail', from: 'n-volco', to: 'n-sheet', type: 'info', label: 'Update availability', activityId: 'a-avail', workItem: 'Mentor availability', inputState: 'texted in', outputState: 'in the spreadsheet', result: 'Availability list', conditions: 'On Fridays.' },
      { id: 'e-mentor', from: 'n-mentor', to: 'n-volco', type: 'info', label: 'Text availability', activityId: 'a-mentor', workItem: 'Availability', outputState: 'sent', result: 'Text message' },
      { id: 'e-dep', from: 'n-volco', to: 'n-lead', type: 'dependency', label: 'Mentor availability', workItem: 'current mentor availability', description: 'Cases that need a mentor wait when availability is out of date.' },
      { id: 'e-leads', from: 'n-lead', to: 'n-team', type: 'authority', label: 'Leads the team', description: 'Line manages the duty workers, the support workers and the volunteer coordinator.' },
      { id: 'e-procedure', from: 'n-policy', to: 'n-duty', type: 'association', directed: false, label: 'Contact standard', description: 'The procedure sets screening on the day of arrival and contact within two working days.' },
    ],
    activities: [
      // People outside the team spend this time, so it is shown on the routes but not counted as staff workload.
      { id: 'a-submit', edgeId: 'e-submit', performerId: 'n-person', actionCode: 'submit', label: 'Submit referral form', includedInWorkload: false, activeMinutes: min(12, 'reported', { sourceIds: ['src-i03'] }), waitMinutes: min(0, 'reported'), occurrencesPerCase: perCase(1, 'reported') },
      { id: 'a-partner', edgeId: 'e-partner', performerId: 'n-partner', actionCode: 'submit', label: 'Email a referral', includedInWorkload: false, activeMinutes: min(10, 'reported', { sourceIds: ['src-i01'] }), waitMinutes: min(0, 'reported'), occurrencesPerCase: perCase(1, 'reported') },
      { id: 'a-screen', edgeId: 'e-screen', performerId: 'n-duty', actionCode: 'review', label: 'Screen referral', activeMinutes: min(15, 'measured', { sourceIds: ['src-o01'], method: 'Timed while shadowing the duty desk', sampleSize: 9, asOf: '2026-10-01' }), waitMinutes: min(1560, 'measured', { sourceIds: ['src-d02'], method: 'Median time from arrival to screening, from case record dates', sampleSize: 30, asOf: '2026-10-30' }), occurrencesPerCase: perCase(1, 'reported') },
      { id: 'a-callback', ownerNodeId: 'n-duty', performerId: 'n-duty', actionCode: 'request', label: 'Call attempts', activeMinutes: min(4, 'measured', { sourceIds: ['src-o01'], method: 'Duty call log' }), waitMinutes: min(1440, 'reported', { sourceIds: ['src-i01'], note: 'About a day between attempts.' }), occurrencesPerCase: perCase(2.5, 'measured', { sourceIds: ['src-o01'], method: 'Duty call log, 14 referrals', sampleSize: 14 }) },
      { id: 'a-intake', ownerNodeId: 'n-duty', performerId: 'n-duty', actionCode: 'check', label: 'Intake conversation', activeMinutes: min(25, 'measured', { sourceIds: ['src-o01'], sampleSize: 5 }), waitMinutes: min(0, 'measured'), occurrencesPerCase: perCase(1, 'reported') },
      { id: 'a-chase', ownerNodeId: 'n-duty', performerId: 'n-duty', actionCode: 'request', label: 'Chase missing details', activeMinutes: min(8, 'reported', { sourceIds: ['src-i01'] }), waitMinutes: min(2880, 'reported', { sourceIds: ['src-i01'] }), occurrencesPerCase: perCase(0.25, 'measured', { sourceIds: ['src-d02'], method: 'Referrals without a phone number or consent, September and October', sampleSize: 30 }) },
      { id: 'a-record', edgeId: 'e-record', performerId: 'n-duty', actionCode: 'record', label: 'Record intake', activeMinutes: min(12, 'measured', { sourceIds: ['src-o01'], sampleSize: 4 }), waitMinutes: min(0, 'measured'), occurrencesPerCase: perCase(1, 'reported') },
      { id: 'a-copy', edgeId: 'e-copy', performerId: 'n-duty', actionCode: 'transfer', label: 'Copy to waiting list', activeMinutes: min(6, 'measured', { sourceIds: ['src-o01'], sampleSize: 4 }), waitMinutes: min(0, 'measured'), occurrencesPerCase: perCase(1, 'reported') },
      { id: 'a-allocate', edgeId: 'e-allocate', performerId: 'n-lead', actionCode: 'match', label: 'Allocate at meeting', activeMinutes: min(41, 'estimated', { sourceIds: ['src-o02'], method: '90-minute meeting × 5 staff ÷ 11 cases', asOf: '2026-10-06' }), waitMinutes: min(5040, 'measured', { sourceIds: ['src-d02'], method: 'Median time from intake to allocation, from case record dates', sampleSize: 30, asOf: '2026-10-30' }), occurrencesPerCase: perCase(1, 'reported') },
      { id: 'a-assign', edgeId: 'e-assign', performerId: 'n-lead', actionCode: 'transfer', label: 'Hand case to worker', activeMinutes: min(3, 'reported', { sourceIds: ['src-i02'] }), waitMinutes: min(1440, 'reported', { sourceIds: ['src-i02'], note: 'Workers see a new case the day after the meeting.' }), occurrencesPerCase: perCase(1, 'reported') },
      { id: 'a-book', ownerNodeId: 'n-support', performerId: 'n-support', actionCode: 'notify', label: 'Book the first session', activeMinutes: min(10, 'reported', { sourceIds: ['src-i02'] }), waitMinutes: min(2880, 'reported', { sourceIds: ['src-i02'] }), occurrencesPerCase: perCase(1, 'reported') },
      { id: 'a-session', edgeId: 'e-session', performerId: 'n-support', actionCode: 'process', label: 'Hold first session', activeMinutes: min(60, 'reported', { sourceIds: ['src-i02'] }), waitMinutes: min(7200, 'measured', { sourceIds: ['src-d02'], method: 'Median time from booking to the first session, from case record dates', sampleSize: 30 }), occurrencesPerCase: perCase(1, 'reported') },
      { id: 'a-avail', edgeId: 'e-avail', performerId: 'n-volco', actionCode: 'record', label: 'Update availability', activeMinutes: min(2, 'estimated', { sourceIds: ['src-i04'], method: 'About 20 minutes on Fridays ÷ about 10 new cases a week' }), waitMinutes: unknownQty('min'), occurrencesPerCase: perCase(1, 'estimated') },
      { id: 'a-mentor', edgeId: 'e-mentor', performerId: 'n-mentor', actionCode: 'notify', label: 'Text availability', includedInWorkload: false, activeMinutes: unknownQty('min'), waitMinutes: unknownQty('min'), occurrencesPerCase: unknownQty('per case') },
    ],
    // Each route lists the call attempt twice: Timeline needs a repeat as explicit steps.
    routes: [
      { id: 'r-self', name: 'Self-referral', startNodeId: 'n-person', endNodeId: 'n-first', caseWeight: 0.6, steps: steps(['e-submit', 'e-screen', 'a-callback', 'a-callback', 'a-intake', 'e-record', 'e-copy', 'e-allocate', 'e-assign', 'a-book', 'e-session']) },
      { id: 'r-partner', name: 'Partner referral, details missing', startNodeId: 'n-partner', endNodeId: 'n-first', caseWeight: 0.4, steps: steps(['e-partner', 'e-screen', 'a-chase', 'a-callback', 'a-callback', 'a-intake', 'e-record', 'e-copy', 'e-allocate', 'e-assign', 'a-book', 'e-session']) },
    ],
  });
}
function steps(refIds: string[]) {
  return refIds.map((refId, i) => ({ id: `s${i + 1}`, kind: refId.startsWith('a-') ? 'activity' as const : 'edge' as const, refId }));
}

const LAYOUT: Layout = {
  'n-partner': { x: 440, y: 120 }, 'n-policy': { x: 730, y: 120 },
  'n-person': { x: 150, y: 350 }, 'n-inbox': { x: 440, y: 350 }, 'n-duty': { x: 730, y: 350 }, 'n-crm': { x: 1020, y: 350 },
  'n-first': { x: 150, y: 640 }, 'n-support': { x: 440, y: 640 }, 'n-lead': { x: 730, y: 640 }, 'n-sheet': { x: 1020, y: 640 },
  'n-team': { x: 730, y: 890 }, 'n-volco': { x: 1020, y: 890 }, 'n-mentor': { x: 1310, y: 890 },
};

/** The first sketch of the map, before anything was timed. */
function sketch(m: Model): Model {
  const s = structuredClone(m);
  s.volume = unknownQty('cases/month');
  for (const a of s.activities) { a.activeMinutes = unknownQty('min'); a.waitMinutes = unknownQty('min'); a.occurrencesPerCase = perCase(1, 'assumed'); }
  return s;
}

/** The option "daily huddle", tested as a scenario: straightforward cases are allocated the next working day. */
function huddle(m: Model): Model {
  const s = structuredClone(m);
  const edge = s.edges.find((e) => e.id === 'e-allocate')!, act = s.activities.find((a) => a.id === 'a-allocate')!;
  edge.label = 'Allocate at huddle';
  edge.conditions = 'Straightforward cases at a 10-minute huddle each morning. Complex cases at the Tuesday meeting.';
  act.label = 'Allocate at huddle';
  act.activeMinutes = min(25, 'estimated', { method: 'About 60% of cases at a huddle of 3 staff (about 15 staff minutes a case), 40% at the Tuesday meeting (41)' });
  act.waitMinutes = min(2880, 'estimated', { method: '60% allocated the next working day (1 day), 40% wait for Tuesday (3.5 days)' });
  s.activities.push({ id: 'a-review', edgeId: null, ownerNodeId: 'n-lead', performerId: 'n-lead', actionCode: 'review', label: 'Review huddle allocations', includedInWorkload: true,
    activeMinutes: min(1, 'estimated', { method: 'Friday review of the huddle’s allocations, averaged over all cases' }), waitMinutes: min(0, 'estimated'), occurrencesPerCase: perCase(1, 'estimated') });
  s.assessment = {
    currency: 'GBP', horizonMonths: 12,
    hourlyRate: qty(18, 'GBP/hour', 'assumed', { note: 'An illustrative staff cost rate. It values released time as capacity, not cash.' }),
    cashItems: [{ id: 'c-board', label: 'Whiteboard and printed huddle sheets', kind: 'one_time_cost', amount: 60, currency: 'GBP', period: 'once', mechanism: 'Bought from the team budget', basis: 'estimated', sourceIds: [] }],
    humanEffects: [
      { id: 'he-wait', role: 'Person referred', nodeId: 'n-person', kind: 'benefit', direction: 'positive', description: 'Straightforward cases are allocated the next working day instead of waiting for Tuesday.', magnitude: qty(1.5, 'days sooner on average', 'estimated'), missingData: '', validation: 'Days from referral to first session, compared with September and October.' },
      { id: 'he-duty', role: 'Duty worker', nodeId: 'n-duty', kind: 'added_work', direction: 'negative', description: 'A 10-minute huddle each morning, on top of the duty rota.', magnitude: qty(50, 'min a week', 'estimated'), missingData: '', validation: 'Ask the duty workers after two weeks and after six weeks.' },
      { id: 'he-lead', role: 'Team lead', nodeId: 'n-lead', kind: 'shifted_work', direction: 'uncertain', description: 'Some cases are allocated without the lead in the room. The lead reviews them on Fridays.', magnitude: null, missingData: 'How many cases count as straightforward each week.', validation: 'Count the huddle allocations that the lead changes on review.' },
      { id: 'he-quality', role: 'Support team', nodeId: 'n-team', kind: 'quality', direction: 'uncertain', description: 'Less shared discussion of risk for cases that look straightforward but are not.', magnitude: null, missingData: 'The re-allocation rate after the huddle starts.', validation: 'Guardrail: re-allocated cases.' },
    ],
    guardrails: [
      { id: 'g-days', metric: 'Days from referral to first session', denominator: 'referrals with a first session', baselinePeriod: 'September and October 2026', baseline: qty(15, 'days (median)', 'measured', { sourceIds: ['src-d02'], sampleSize: 30 }), target: 'Median of 13 days or fewer', direction: 'lower_is_better', owner: 'Team lead', method: 'Case record dates', followUp: 'After 6 weeks', rollbackTrigger: 'No change after 6 weeks' },
      { id: 'g-realloc', metric: 'Re-allocated cases', denominator: 'allocated cases', baselinePeriod: 'September and October 2026', baseline: qty(2, 'cases a month', 'reported', { sourceIds: ['src-i02'] }), target: 'No more than now', direction: 'lower_is_better', owner: 'Team lead', method: 'Notes in the allocation spreadsheet', followUp: 'Every 2 weeks', rollbackTrigger: 'More than 4 in a month' },
      { id: 'g-extra', metric: 'Unpaid extra time on duty days', denominator: 'duty days', baselinePeriod: 'September and October 2026', baseline: null, target: 'No more than now', direction: 'hold', owner: 'Team lead', method: 'A short weekly check-in with the duty workers', followUp: 'Weekly', rollbackTrigger: 'A duty worker stays late because of the huddle' },
    ],
    workingConditions: [
      { id: 'wc-interrupt', role: 'Duty worker', indicator: 'Interruptions while screening', baseline: 'The phone rang 6 times in one 40-minute screening session', expected: 'No change: the huddle does not touch the phone line', basis: 'measured', note: '' },
      { id: 'wc-meeting', role: 'Team lead', indicator: 'Time in allocation meetings', baseline: '90 minutes every Tuesday', expected: 'About 50 minutes on Tuesday, plus 10 minutes each morning', basis: 'estimated', note: '' },
    ],
    preserve: 'Complex cases still go to the Tuesday meeting, so the team keeps sharing its judgement about risk.',
    reversal: 'Stop the huddle and allocate every case on Tuesday again. Nothing in the case record system changes.',
    participantFeedback: 'Two duty workers and the team lead said they would try it if the huddle stays under 10 minutes.',
    unknowns: 'The share of straightforward cases each week (7 of 11 at one meeting). Whether next-day allocation holds in holiday weeks.',
    validation: 'A six-week trial that starts on a Monday. Compare the median days to a first session and the re-allocated cases with September and October.',
  };
  return s;
}

/** A draft made from archive notes (Notes > Archive > Update the map from notes), ready to compare and adopt. */
function draftFromNotes(m: Model): Model {
  const s = structuredClone(m);
  s.edges.push({ id: 'e-phone', from: 'n-partner', to: 'n-duty', type: 'flow', label: 'Phone in a referral', directed: true, activityId: 'a-phone', workItem: 'Referral by phone', result: 'Referral typed into the form', inputState: '', outputState: '', conditions: '', exceptions: '', description: 'GP surgeries sometimes phone the duty line instead of emailing.', basis: ['t25', 't30'] });
  s.activities.push({ id: 'a-phone', edgeId: 'e-phone', ownerNodeId: null, performerId: 'n-duty', actionCode: 'record', label: 'Phone in a referral', includedInWorkload: true,
    activeMinutes: unknownQty('min'), waitMinutes: unknownQty('min'), occurrencesPerCase: perCase(0.2, 'estimated', { method: '2 of 11 cases at one allocation meeting' }), basis: ['t25', 't30'] });
  const sheet = s.nodes.find((n) => n.id === 'n-sheet')!;
  sheet.description = 'The team’s working waiting list. Mentor availability is kept here too, updated on Fridays.';
  sheet.basis = ['t21', 't29'];
  return s;
}

// ---- sources and notes ------------------------------------------------------------------------------------
const source = (id: string, anonId: string, type: z.input<typeof sourceSchema>['type'], participantRole: string, date: string, collection: string, agentApproved: boolean, exportApproved: boolean): z.input<typeof sourceSchema> =>
  ({ id, anonId, type, participantRole, date, collection, agentApproved, exportApproved });

const SOURCES = [
  source('src-i01', 'Interview 01', 'interview', 'Duty worker', '2026-09-15', 'Staff interviews', true, true),
  source('src-i02', 'Interview 02', 'interview', 'Team lead', '2026-09-16', 'Staff interviews', true, true),
  source('src-i03', 'Interview 03', 'interview', 'Person referred', '2026-09-22', 'Interviews with people referred', false, true),
  source('src-i04', 'Interview 04', 'interview', 'Volunteer coordinator', '2026-09-23', 'Staff interviews', true, true),
  // A small group: its ID is not cited in the brief, and its excerpts stay in the workspace.
  source('src-i05', 'Interview 05', 'interview', 'Person referred', '2026-09-29', 'Interviews with people referred', false, false),
  source('src-o01', 'Observation 01', 'observation', 'Duty worker', '2026-10-01', 'Duty desk shadowing', true, true),
  source('src-o02', 'Observation 02', 'observation', 'Support team', '2026-10-06', 'Allocation meeting', true, true),
  source('src-w01', 'Walkthrough 01', 'walkthrough', 'Duty worker', '2026-10-08', 'System walkthroughs', true, true),
  source('src-d01', 'Referral procedure v3', 'document', '', '2026-03-01', 'Documents', true, true),
  source('src-d02', 'Case record extract, September and October', 'document', '', '2026-10-30', 'Documents', true, true),
  source('src-wk', 'Working notes', 'working', 'Researcher', '2026-11-02', 'Synthesis', false, false),
];

type Kind = NonNullable<NoteIn['kind']>;
type Certainty = NoteIn['certainty'];
type Item = [id: string, kind: Kind, certainty: Certainty, text: string, targetId: string | null, extra?: Partial<NoteIn>];

// Notes made before the timings were added are anchored to the first sketch of the map.
const anchor = (targetId: string | null, createdAt: string) =>
  targetId ? { anchorBranchId: 'baseline', anchorRevisionId: createdAt < REV2_AT ? 'rev-1' : 'rev-2' } : { anchorBranchId: null, anchorRevisionId: null };

function captured(sourceId: string, group: string, createdAt: string, items: Item[]): NoteIn[] {
  return items.map(([id, kind, certainty, text, targetId, extra]) => ({ id, kind, certainty, text, rawText: text, sourceId, group, targetId, ...anchor(targetId, createdAt), excerptApproved: true, createdAt, ...extra }));
}

/** An archive entry and the notes saved from it. Each note keeps its exact words and where they sit in the text. */
function archived(im: Omit<ImportIn, 'noteCount'> & { sourceId: string; createdAt: string }, items: Item[]): { imp: ImportIn; notes: NoteIn[] } {
  const notes = items.map(([id, kind, certainty, text, targetId, extra]) => {
    const start = im.text.indexOf(text);
    if (start < 0 || im.text.lastIndexOf(text) !== start) throw new Error(`The worked example note ${id} must occur once in “${im.name}”.`);
    return { id, kind, certainty, text, rawText: text, sourceId: im.sourceId, group: im.name, targetId, ...anchor(targetId, im.createdAt), excerptApproved: true, origin: { importId: im.id, start, end: start + text.length }, createdAt: im.createdAt, ...extra };
  });
  return { imp: { ...im, noteCount: notes.length }, notes };
}

const REV1_AT = '2026-09-14T15:00:00.000Z', REV2_AT = '2026-10-30T16:30:00.000Z';

const SHADOWING = archived({
  id: 'im-shadow', name: 'Duty desk shadowing, 1 Oct', docType: 'notes', method: 'phone', sourceId: 'src-o01', createdAt: '2026-10-01T16:10:00.000Z',
  text: `Duty desk shadowing
Thu 1 Oct, 09:00 to 12:30, with the duty worker. Names replaced with roles.

- Timed 9 screenings: median 15 minutes, range 9 to 24.
- Saw the phone ring six times during one 40-minute screening session.
- Call log for 14 referrals: 2.5 call attempts on average before reaching the person.
- Watched the duty worker retype the intake summary from the case system into the spreadsheet, about 6 minutes per case.
- Typed-up intakes took about 12 minutes each (4 timed).
- Intake calls I listened to took 25 minutes on average (5 calls).
- Two of the morning's referrals had no phone number, so screening stopped until the details came back.
- A GP receptionist phoned the duty line with a referral, and the duty worker typed it into the online form during the call.
`,
}, [
  ['t18', 'measurement', 'observed', 'Timed 9 screenings: median 15 minutes, range 9 to 24.', 'e-screen'],
  ['t19', 'observation', 'observed', 'Saw the phone ring six times during one 40-minute screening session.', 'n-duty', {
    category: 'Working conditions',
    episode: {
      task: 'Screen two new referrals before the 11:00 call slot', intendedOutcome: 'Both referrals screened and on the call list',
      action: 'Read each form, checked the case system for earlier contact and started the call list', helped: 'A partner referral that already recorded consent',
      hindered: 'Six phone calls in 40 minutes, and one form with no phone number', outcome: 'One referral screened, one waiting for details',
      hiddenEffort: 'Searched old emails for the missing phone number', clarification: 'Afterwards the duty worker said that this is a typical duty day.',
    },
  }],
  ['t20', 'measurement', 'observed', 'Call log for 14 referrals: 2.5 call attempts on average before reaching the person.', 'a-callback'],
  ['t21', 'measurement', 'observed', 'Watched the duty worker retype the intake summary from the case system into the spreadsheet, about 6 minutes per case.', 'e-copy'],
  ['t22', 'measurement', 'observed', 'Typed-up intakes took about 12 minutes each (4 timed).', 'e-record'],
  ['t23', 'measurement', 'observed', 'Intake calls I listened to took 25 minutes on average (5 calls).', 'a-intake'],
  ['t24', 'observation', 'observed', "Two of the morning's referrals had no phone number, so screening stopped until the details came back.", 'a-chase'],
  // Not on the map yet: the draft from notes adds it.
  ['t25', 'observation', 'observed', 'A GP receptionist phoned the duty line with a referral, and the duty worker typed it into the online form during the call.', null],
]);

const MEETING = archived({
  id: 'im-meeting', name: 'Allocation meeting, 6 Oct', docType: 'notes', method: 'phone', sourceId: 'src-o02', createdAt: '2026-10-06T13:00:00.000Z',
  text: `Allocation meeting
Tue 6 Oct. Team lead, two duty workers, a support worker and the volunteer coordinator.

The meeting took 90 minutes for 11 cases. Seven of the 11 cases were agreed in under two minutes with no discussion. Three complex cases took most of the time: risk, housing and a safeguarding question.

The lead asked twice whether mentor availability was current. Nobody was sure.

Two of the 11 cases came in by phone from GP surgeries.
`,
}, [
  ['t26', 'measurement', 'observed', 'The meeting took 90 minutes for 11 cases.', 'e-allocate'],
  ['t27', 'observation', 'observed', 'Seven of the 11 cases were agreed in under two minutes with no discussion.', 'e-allocate'],
  ['t28', 'observation', 'observed', 'Three complex cases took most of the time: risk, housing and a safeguarding question.', 'e-allocate', { category: 'Protect', color: 'green' }],
  ['t29', 'observation', 'observed', 'The lead asked twice whether mentor availability was current. Nobody was sure.', 'e-dep'],
  ['t30', 'observation', 'observed', 'Two of the 11 cases came in by phone from GP surgeries.', null],
]);

const PROCEDURE = archived({
  id: 'im-procedure', name: 'Referral procedure v3', docType: 'document', method: 'phone', sourceId: 'src-d01', createdAt: '2026-10-09T09:00:00.000Z',
  // The original is not kept in the app. Only its name and the text read from it are.
  file: { name: 'Referral procedure v3.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 31744, ref: '', link: '' },
  text: `Referral procedure (version 3, March 2026)

1. Referrals are screened on the day they arrive.
2. Every person referred is contacted within two working days.
3. Allocation takes place at the weekly team meeting.
4. The case record is the single record of each referral.
`,
}, [
  ['t33', 'observation', 'documented', 'Referrals are screened on the day they arrive.', 'e-screen'],
  ['t34', 'observation', 'documented', 'Every person referred is contacted within two working days.', 'a-callback'],
  ['t35', 'observation', 'documented', 'Allocation takes place at the weekly team meeting.', 'e-allocate'],
  ['t36', 'observation', 'documented', 'The case record is the single record of each referral.', 'n-crm'],
]);

const NOTES: NoteIn[] = [
  ...captured('src-i01', 'Duty desk', '2026-09-15T10:30:00.000Z', [
    ['t01', 'observation', 'reported', 'Screening is quick when the form is complete. It is the chasing that eats the morning.', 'e-screen'],
    ['t02', 'observation', 'reported', "Most people don't pick up a withheld number, so I try three or four times over two days.", 'a-callback'],
    ['t03', 'observation', 'reported', 'Everything goes into the case system and then again into the spreadsheet, because the meeting only looks at the spreadsheet.', 'e-copy'],
    ['t04', 'observation', 'reported', 'On duty days I also cover the phone line, so screening gets interrupted all the time.', 'n-duty', { category: 'Working conditions' }],
    ['t05', 'observation', 'reported', 'Partner referrals often come without a phone number or consent, and nothing can move until we have them.', 'a-chase'],
  ]),
  ...captured('src-i02', 'Allocation', '2026-09-16T14:00:00.000Z', [
    ['t06', 'observation', 'reported', 'We allocate every case at the Tuesday meeting so the whole team shares the judgement about risk.', 'e-allocate', { category: 'Protect', color: 'green' }],
    ['t07', 'observation', 'reported', 'A case that finishes intake on a Wednesday waits almost a week for the next meeting.', 'e-allocate'],
    ['t08', 'recommendation', 'reported', 'Straightforward cases could be allocated the same day without the full meeting.', 'e-allocate'],
    ['t09', 'observation', 'reported', "The spreadsheet is the real waiting list. The case system is for the funder's reports.", 'n-sheet'],
    ['t10', 'observation', 'reported', 'Workers usually see a new case on their list the day after the meeting.', 'e-assign'],
  ]),
  ...captured('src-i03', 'Getting in touch', '2026-09-22T11:00:00.000Z', [
    ['t11', 'observation', 'reported', "I didn't answer because it was a private number. I thought it was a sales call.", 'a-callback'],
    ['t12', 'observation', 'reported', 'Once I had a date it was fine. It was not knowing for two weeks that was hard.', 'e-session'],
    ['t13', 'observation', 'reported', 'The first phone call was the first time someone actually listened.', 'a-intake', { category: 'Protect', color: 'green' }],
  ]),
  ...captured('src-i04', 'Allocation', '2026-09-23T15:30:00.000Z', [
    ['t14', 'observation', 'reported', 'Mentors text me their availability and I update the spreadsheet on Fridays, so by Tuesday it can be out of date.', 'e-avail'],
    ['t15', 'question', null, 'Could mentors update their own availability, or would that put people off volunteering?', 'n-mentor'],
  ]),
  ...captured('src-i05', 'Getting in touch', '2026-09-29T10:00:00.000Z', [
    ['t16', 'observation', 'reported', 'A text first, saying who was calling, would have helped. I would have picked up.', 'a-callback', { excerptApproved: false }],
    ['t17', 'observation', 'reported', 'I wanted to talk to a person, not fill in another form.', 'a-intake', { category: 'Protect', color: 'green', excerptApproved: false }],
  ]),
  ...SHADOWING.notes, ...MEETING.notes,
  ...captured('src-w01', 'Systems', '2026-10-08T10:00:00.000Z', [
    ['t31', 'observation', 'observed', 'The case system has a waiting list view that nobody uses. It was switched off after an update last year.', 'n-crm'],
    ['t32', 'observation', 'reported', 'Intake notes are written on paper during the call and typed up afterwards.', 'e-record'],
  ]),
  ...PROCEDURE.notes,
  // Counted by the researcher from the case record dates: measured, so recorded as seen.
  ...captured('src-d02', 'Timing', '2026-10-30T15:00:00.000Z', [
    ['t37', 'measurement', 'observed', 'Across 30 referrals in September and October, the median time from referral to first session was 15 days. Four took more than three weeks.', 'n-first'],
    ['t38', 'measurement', 'observed', 'Median 26 hours from a referral arriving to it being screened.', 'e-screen'],
    ['t39', 'measurement', 'observed', 'Cases waited a median of 3.5 days between intake and allocation.', 'e-allocate'],
    ['t40', 'measurement', 'observed', 'Median 5 days from booking to the first session.', 'e-session'],
    ['t41', 'measurement', 'observed', '8 of the 30 referrals had no phone number or no consent recorded.', 'a-chase'],
    ['t42', 'measurement', 'observed', '46 new referrals a month on average. 6 in 10 were self-referrals.', 'n-inbox'],
  ]),
  ...captured('src-wk', 'Synthesis', '2026-11-02T09:30:00.000Z', [
    ['t43', 'hypothesis', 'inferred', 'The weekly rhythm, not the workload, sets the allocation wait: a case can sit for up to six days even in a quiet week.', 'e-allocate', { excerptApproved: false }],
    ['t44', 'hypothesis', 'inferred', 'Double entry survives because the meeting trusts the spreadsheet more than the case system.', 'e-copy', { excerptApproved: false }],
    ['t45', 'question', null, "How many referrals would count as straightforward? Ask the team to sort last month's cases.", null, { excerptApproved: false }],
  ]),
];

// ---- synthesis and decisions ------------------------------------------------------------------------------
const INSIGHTS: z.input<typeof insightSchema>[] = [
  { id: 'in-1', title: 'The weekly meeting sets the pace of allocation', modelLinks: ['e-allocate', 'n-lead'], focus: { 'e-allocate': ['waiting', 'conditions'] }, createdAt: '2026-10-07T09:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
    body: 'A case that finishes intake just after Tuesday waits almost a week, whatever the workload. Seven of the eleven cases at the meeting I watched needed no discussion. Straightforward cases could move faster without losing the shared judgement on complex ones.' },
  { id: 'in-2', title: 'The spreadsheet is the real waiting list', modelLinks: ['n-sheet', 'e-copy'], focus: { 'e-copy': ['active'] }, createdAt: '2026-10-08T15:00:00.000Z', updatedAt: '2026-10-09T09:30:00.000Z',
    body: 'Decisions are made from the spreadsheet, so every case is typed twice: once into the case system for the funder, and once into the spreadsheet for the meeting. Mentor availability is only in the spreadsheet.' },
  { id: 'in-3', title: 'Phone tag, not screening, delays the first contact', modelLinks: ['a-callback'], createdAt: '2026-10-02T09:00:00.000Z', updatedAt: '2026-10-02T09:00:00.000Z',
    body: 'Screening takes about 15 minutes. To reach the person takes two or three attempts over two days, because the calls come from a withheld number that people do not answer.' },
  { id: 'in-4', title: 'The first conversation is what people value', modelLinks: ['a-intake'], createdAt: '2026-09-30T09:00:00.000Z', updatedAt: '2026-09-30T09:00:00.000Z',
    body: 'People referred describe the first call as the moment that someone listened. A change to intake must keep a conversation with a person.' },
  // An early thought: no evidence and no place on the map yet.
  { id: 'in-5', title: '', modelLinks: [], createdAt: '2026-11-03T16:00:00.000Z', updatedAt: '2026-11-03T16:00:00.000Z',
    body: 'Could peer mentors hold some first sessions?\nNot explored yet. Ask the volunteer coordinator what mentors would want.' },
];

type Relation = z.input<typeof linkSchema>['relation'];
const toInsight = (insightId: string, list: [noteId: string, relation: Relation][]): z.input<typeof linkSchema>[] =>
  list.map(([noteId, relation]) => ({ id: `l-${noteId}-${insightId}`, fromType: 'note', fromId: noteId, toType: 'insight', toId: insightId, relation }));

const LINKS: z.input<typeof linkSchema>[] = [
  ...toInsight('in-1', [['t07', 'supports'], ['t27', 'supports'], ['t39', 'supports'], ['t26', 'related'], ['t06', 'related'], ['t35', 'related'], ['t43', 'related']]),
  // The procedure says the case record is the only record: a documented claim against what happens.
  ...toInsight('in-2', [['t03', 'supports'], ['t09', 'supports'], ['t21', 'supports'], ['t36', 'contradicts'], ['t31', 'related'], ['t44', 'related']]),
  ...toInsight('in-3', [['t02', 'supports'], ['t11', 'supports'], ['t16', 'supports'], ['t20', 'supports'], ['t01', 'related'], ['t34', 'related']]),
  ...toInsight('in-4', [['t13', 'supports'], ['t17', 'supports']]),
  { id: 'l-t38-t33', fromType: 'note', fromId: 't38', toType: 'note', toId: 't33', relation: 'contradicts', comment: 'The procedure says the same day. The case record dates say about a day.' },
  { id: 'l-t14-t29', fromType: 'note', fromId: 't14', toType: 'note', toId: 't29', relation: 'possible_cause', comment: 'Availability is updated on Fridays, four days before the meeting.' },
  { id: 'l-t19-t38', fromType: 'note', fromId: 't19', toType: 'note', toId: 't38', relation: 'possible_cause', comment: 'Interruptions can explain part of the wait before screening.' },
  { id: 'l-t25-t30', fromType: 'note', fromId: 't25', toType: 'note', toId: 't30', relation: 'related', comment: 'Phone referrals from GP surgeries are not on the map yet.' },
];

const OPPORTUNITIES: z.input<typeof opportunitySchema>[] = [
  { id: 'op-1', title: 'Allocate straightforward cases between meetings', reportTitle: 'Allocate straightforward cases the next working day', insightIds: ['in-1'], targetIds: ['e-allocate'],
    interpretation: 'The weekly rhythm, not the amount of work, sets the wait for allocation. A short daily huddle could allocate the cases that need no discussion, and the Tuesday meeting could keep the complex ones.',
    uncertainty: 'The share of straightforward cases comes from one meeting (7 of 11).',
    preserve: 'Shared judgement about risk at the Tuesday meeting, and the peer support that it gives the team.',
    stakeholders: 'Duty workers (a daily 10-minute huddle), the team lead (a Friday review of huddle allocations) and people referred (a shorter wait).',
    validationPlan: 'A six-week trial. Compare the median days from referral to first session and the number of re-allocated cases with September and October.',
    decisionState: 'recommended', recommendedOptionId: 'o-huddle', criteria: { evidenceStrength: 4, effort: 2, expectedValue: 4, humanRisk: 2 }, rank: 1,
    internalNotes: 'Check the duty rota before we propose a start date.', citedRevisions: { 'sc-huddle': 'rev-sc-huddle-2' } },
  { id: 'op-2', title: 'Stop typing every case twice', reportTitle: 'Use the case system’s waiting list instead of the spreadsheet', insightIds: ['in-2'], targetIds: ['e-copy', 'n-sheet'],
    interpretation: 'The case system already has a waiting list view. If the team switches it back on, cases are typed once and there is one record.',
    uncertainty: 'Nobody has used the view since the update. It may not show mentor availability.',
    preserve: 'The meeting’s habit of looking at the whole list together.',
    stakeholders: 'Duty workers (no more retyping), the volunteer coordinator (availability needs a new place) and the team lead.',
    validationPlan: 'Walk through the view with the team, then run one meeting from it next to the spreadsheet.',
    decisionState: 'hypothesis', recommendedOptionId: 'o-view', criteria: { evidenceStrength: 3, effort: 2, expectedValue: 3, humanRisk: 1 }, rank: 2 },
  { id: 'op-3', title: 'Fewer call attempts before the first conversation', reportTitle: 'Reach people at the first or second call', insightIds: ['in-3'], targetIds: ['a-callback'],
    interpretation: 'People do not answer withheld numbers. A text before the call, or a call-back time chosen on the form, could cut the number of attempts.',
    uncertainty: 'Whether the phone system can show a number, and what people referred would prefer.',
    stakeholders: 'Duty workers and people referred.',
    decisionState: 'exploring', criteria: { evidenceStrength: 3, effort: 1, expectedValue: 3 }, rank: 3 },
  { id: 'op-4', title: 'Replace the intake call with an online form', reportTitle: 'An online intake form instead of the call', insightIds: ['in-4'], targetIds: ['a-intake'],
    preserve: 'The intake conversation.', decisionState: 'closed',
    closeReason: 'People referred value the first conversation. An online form instead of the call would remove what works.' },
];

const OPTIONS: z.input<typeof optionSchema>[] = [
  { id: 'o-weekly', opportunityId: 'op-1', kind: 'status_quo', title: 'Keep the Tuesday meeting for every case', confidence: 'high',
    benefits: 'The whole team judges every case. Nobody’s week changes.', downsides: 'Cases that finish intake after Tuesday wait up to six days.', effort: 'None.', costs: 'None.' },
  { id: 'o-huddle', opportunityId: 'op-1', kind: 'process_change', title: 'Daily 10-minute huddle for straightforward cases', confidence: 'medium', smallestReversible: true, scenarioBranchId: 'sc-huddle',
    benefits: 'Straightforward cases are allocated the next working day: about 1.5 days sooner on average.', downsides: 'Less discussion of cases that look simple but are not.',
    shiftedWork: 'Duty workers: about 50 minutes a week in huddles. Team lead: a Friday review of the huddle’s allocations.', effort: 'Agree what counts as straightforward. A whiteboard. Two weeks to settle.',
    costs: 'About 60 GBP for a whiteboard and printed sheets.', tradeoffs: 'A faster start for most people against a little less shared discussion.',
    unknowns: 'How many cases are straightforward each week. Cover in holiday weeks.', test: 'A six-week trial with the guardrails in the scenario.' },
  { id: 'o-app', opportunityId: 'op-1', kind: 'bespoke_tool', title: 'Build an allocation app', confidence: 'low', withinPilotScope: false,
    benefits: 'It could match cases to workers and mentors automatically.', downsides: 'Months of work. It takes the decision away from the team.', shiftedWork: 'Someone must maintain it.',
    effort: 'High.', costs: 'Unknown until a supplier quotes.', unknowns: 'Whether the case system can export the data that the app needs.' },
  { id: 'o-view', opportunityId: 'op-2', kind: 'existing_tool', title: 'Switch the case system’s waiting list view back on', confidence: 'medium', smallestReversible: true,
    benefits: 'Cases are typed once. The record the funder sees is the one the team uses.', downsides: 'The meeting must learn a new screen.', shiftedWork: 'The volunteer coordinator needs a new place for mentor availability.',
    effort: 'Ask the supplier to switch the view on. One practice meeting.', costs: 'None expected under the current licence.', unknowns: 'Whether the view can show mentor availability.', test: 'Run one meeting from the view next to the spreadsheet.' },
  { id: 'o-sheet', opportunityId: 'op-2', kind: 'status_quo', title: 'Keep the spreadsheet', confidence: 'high', benefits: 'Familiar and flexible.', downsides: 'About 6 minutes of retyping for each case, and two records that can disagree.' },
  { id: 'o-text', opportunityId: 'op-3', kind: 'process_change', title: 'Text before calling, saying who is calling', confidence: 'unknown', smallestReversible: true,
    benefits: 'People know who is calling and can pick up.', downsides: 'Needs a phone that can send texts.', test: 'Two weeks of texts before calls. Count the attempts on the call log.' },
  { id: 'o-slot', opportunityId: 'op-3', kind: 'process_change', title: 'Ask for a good time to call on the referral form', confidence: 'unknown',
    benefits: 'Calls come at a time the person chose.', downsides: 'Partner referrals do not use the form.', unknowns: 'Whether people fill it in.' },
];

// ---- research findings waiting for review -----------------------------------------------------------------
const RUNS: z.input<typeof runRecordSchema>[] = [{
  id: 'run-1', mode: 'deep', status: 'ready_for_review', question: 'Where do the accounts disagree, and what should be measured next?', provider: 'Synthetic example (no AI)',
  input: { branchId: 'baseline', revisionId: 'rev-2', noteIds: ['t02', 't14', 't20', 't33', 't38'] },
  result: {
    summary: 'The procedure and the case record dates disagree about screening. Call attempts are measured for 14 referrals only. The volunteer coordinator may do work that is not on the map.',
    followUpQuestions: ['How many call attempts does a referral need over four weeks?', 'Who chases mentors when their availability is out of date?'],
    gapsToCheckWithParticipants: ['Whether the duty worker sees the same-day screening rule as realistic.'],
    synthetic: true, providerLabel: 'Synthetic example data: written for this worked example, not produced by an AI.', candidateCount: 3,
  },
  createdAt: '2026-11-03T14:00:00.000Z', finishedAt: '2026-11-03T14:01:00.000Z',
}];

const pending = (id: string, payload: Record<string, unknown>): z.input<typeof candidateRecordSchema> =>
  ({ id, runId: 'run-1', origin: 'fixture', schemaVersion: 2, payload, status: 'pending', baseRevisionId: 'rev-2' });
const CANDIDATES = [
  pending('cand-1', { kind: 'contradiction', summary: 'The procedure and the case record dates disagree about screening', sourceId: 'Referral procedure v3', certainty: 'inferred',
    basis: 'The procedure says that referrals are screened on the day they arrive. The case record extract gives a median of 26 hours.',
    text: 'Screening happens about a day after a referral arrives, not on the same day as the procedure says.',
    accounts: [{ sourceId: 'Referral procedure v3', claim: 'Referrals are screened on the day they arrive.' }, { sourceId: 'Case record extract, September and October', claim: 'Median 26 hours from arrival to screening.' }],
    targetId: 'e-screen', noteIds: ['t33', 't38'] }),
  pending('cand-2', { kind: 'measurement_target', summary: 'Count call attempts for four weeks', sourceId: 'Observation 01', certainty: 'inferred',
    basis: 'The call log covers 14 referrals. The interviews report three or four attempts.',
    text: 'Measure the call attempts for each referral over four weeks, and how many people answer after a text.', metric: 'Call attempts per referral', method: 'A tally on the duty call log', targetId: 'a-callback' }),
  pending('cand-3', { kind: 'activity', summary: 'A possible task: chasing mentors for their availability', sourceId: 'Interview 04', certainty: 'inferred',
    basis: 'The volunteer coordinator described texting mentors whose availability is out of date.', ownerId: 'n-volco', label: 'Chase mentors for availability', minutes: null }),
];

// ---- the bundle -------------------------------------------------------------------------------------------
export function exampleBundle(): Bundle {
  const base = baselineModel();
  const raw = {
    format: WORKSPACE_FORMAT, schemaVersion: WORKSPACE_SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    project: {
      name: EXAMPLE_NAME, status: 'active', aiFiles: 'off', orgUnit: 'Synthetic community support service',
      researchQuestion: 'Why do people wait about two weeks for a first support session, and what small change would shorten the wait without more work for the support team?',
      scopeDescription: 'From a referral that arrives (by the online form or as an email from a partner agency) to the person’s first support session. Partner agencies and peer mentors are outside the reviewed scope, but hand work in and out of it.',
      startLabel: 'A referral arrives', intendedOutcome: 'Current-state map, prioritized opportunity sheet and a leadership brief.',
      externalInterfaces: 'People referred (service users); partner agencies (GP surgeries, housing officers); peer mentors (volunteers).',
    },
    branches: [
      { id: 'baseline', kind: 'baseline', name: 'Baseline', headRevisionId: 'rev-2', layout: LAYOUT, createdAt: REV1_AT },
      { id: 'sc-huddle', kind: 'scenario', name: 'Daily huddle for straightforward cases', baseRevisionId: 'rev-2', headRevisionId: 'rev-sc-huddle-2', layout: LAYOUT, origin: { type: 'option', id: 'o-huddle' }, status: 'in_review', createdAt: '2026-11-04T10:00:00.000Z',
        hypothesis: 'A short daily huddle for straightforward cases shortens the wait for a first session and adds little work.' },
      { id: 'sc-notes', kind: 'scenario', name: 'Draft from notes, 5 Nov', baseRevisionId: 'rev-2', headRevisionId: 'rev-sc-notes-2', layout: LAYOUT, origin: { type: 'archive', id: null }, createdAt: '2026-11-05T11:00:00.000Z',
        hypothesis: '2 changes proposed from 17 notes in the archive.' },
    ],
    revisions: [
      { id: 'rev-1', branchId: 'baseline', seq: 1, summary: 'First sketch of the map at the scoping workshop', author: 'Example researcher', createdAt: REV1_AT, model: sketch(base) },
      { id: 'rev-2', branchId: 'baseline', parentRevisionId: 'rev-1', seq: 2, summary: 'Timings from the shadowing, the allocation meeting and the case record extract', author: 'Example researcher', createdAt: REV2_AT, model: base },
      { id: 'rev-sc-huddle-1', branchId: 'sc-huddle', parentRevisionId: 'rev-2', seq: 1, summary: 'Branched from Baseline (revision 2)', author: 'Example researcher', createdAt: '2026-11-04T10:00:00.000Z', model: base },
      { id: 'rev-sc-huddle-2', branchId: 'sc-huddle', parentRevisionId: 'rev-sc-huddle-1', seq: 2, summary: 'Huddle for straightforward cases, with people and guardrails', author: 'Example researcher', createdAt: '2026-11-04T11:30:00.000Z', model: huddle(base) },
      { id: 'rev-sc-notes-1', branchId: 'sc-notes', parentRevisionId: 'rev-2', seq: 1, summary: 'Branched from Baseline (revision 2)', author: 'Example researcher', createdAt: '2026-11-05T11:00:00.000Z', model: base },
      { id: 'rev-sc-notes-2', branchId: 'sc-notes', parentRevisionId: 'rev-sc-notes-1', seq: 2, summary: 'Changes from notes (2)', author: 'Example researcher', createdAt: '2026-11-05T11:02:00.000Z', model: draftFromNotes(base) },
    ],
    sources: SOURCES, notes: NOTES, insights: INSIGHTS, links: LINKS, opportunities: OPPORTUNITIES, options: OPTIONS, runs: RUNS, candidates: CANDIDATES,
    imports: [SHADOWING.imp, MEETING.imp, PROCEDURE.imp],
  };
  const v = validateBundle(raw);
  if (!v.bundle) throw new Error('The worked example is not a valid workspace: ' + JSON.stringify(v.issues.slice(0, 5)));
  return v.bundle;
}
