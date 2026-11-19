// Synthetic demonstration workspace, built from the bundled v0.7 fixture. Everything in it is invented.
import fixture from '../../reference/handoff/fixtures/synthetic-volunteer-placement-v0.7.json';
import { convertLegacy } from '../shared/legacy';
import { MODEL_SCHEMA_VERSION, emptyAssessment, unknownQty, type Model } from '../shared/model';
import { WORKSPACE_FORMAT, WORKSPACE_SCHEMA_VERSION, type Bundle } from '../shared/workspace';

export function demoBundle(): Bundle {
  const r = convertLegacy(fixture);
  if (!r.bundle) throw new Error('Bundled fixture failed to convert: ' + JSON.stringify(r.issues));
  const b = structuredClone(r.bundle);
  b.project = {
    name: 'Volunteer placement (synthetic demo)', status: 'active', aiFiles: 'off', orgUnit: 'Synthetic volunteer programme',
    researchQuestion: 'Where does a volunteer placement wait, and what small change would shorten the wait without adding work for coordinators?',
    scopeDescription: 'From a volunteer submitting an application to a confirmed placement. Program leads are outside the reviewed scope but interface directly with it.',
    startLabel: 'Volunteer submits an application', intendedOutcome: 'Current-state map, prioritized opportunity sheet and a leadership brief.', externalInterfaces: 'Volunteers (applicants); program leads who confirm capacity.',
  };
  for (const s of b.sources) if (s.type === 'interview') { s.agentApproved = true; s.exportApproved = true; s.participantRole = s.anonId.endsWith('01') ? 'Applicant' : 'Coordinator'; }
  for (const n of b.notes) if (n.kind === 'observation') { n.excerptApproved = true; n.certainty = 'reported'; }
  return b;
}

export function blankBundle(meta: Bundle['project'], startLabel: string, outcomeLabel: string): Bundle {
  const now = new Date().toISOString();
  const model: Model = {
    schemaVersion: MODEL_SCHEMA_VERSION, name: meta.name, volume: unknownQty('cases/month'), startNodeId: 'n1', routes: [], assessment: emptyAssessment(), edges: [], activities: [],
    nodes: [
      { id: 'n1', kind: 'person', label: startLabel.trim().slice(0, 140) || 'Where the work starts', role: 'Start', description: '', scope: 'internal', parentId: null },
      { id: 'n2', kind: 'output', label: outcomeLabel.trim().slice(0, 140) || 'Outcome', role: 'Outcome', description: '', scope: 'internal', parentId: null },
    ],
  };
  return {
    format: WORKSPACE_FORMAT, schemaVersion: WORKSPACE_SCHEMA_VERSION, exportedAt: now, project: meta,
    branches: [{ id: 'baseline', kind: 'baseline', name: 'Baseline', hypothesis: '', parentBranchId: null, baseRevisionId: null, headRevisionId: 'rev-1', layout: { n1: { x: 300, y: 350 }, n2: { x: 760, y: 350 } }, origin: null, status: 'draft', createdAt: now }],
    revisions: [{ id: 'rev-1', branchId: 'baseline', parentRevisionId: null, seq: 1, summary: 'Project created', author: '', createdAt: now, restoredFrom: null, model }],
    sources: [], notes: [], insights: [], links: [], opportunities: [], options: [], runs: [], candidates: [], imports: [],
  };
}
