import { readFileSync } from 'node:fs';
import { convertLegacy } from '../../src/shared/legacy';
import type { Model } from '../../src/shared/model';

export const FIXTURE_PATH = 'reference/handoff/fixtures/synthetic-volunteer-placement-v0.7.json';
export const loadFixture = () => JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
export function fixtureModel(): Model {
  const r = convertLegacy(loadFixture());
  if (!r.bundle) throw new Error('fixture failed: ' + JSON.stringify(r.issues));
  return structuredClone(r.bundle.revisions.find((x) => x.id === r.bundle!.branches[0].headRevisionId)!.model);
}
export const act = (m: Model, edgeId: string) => m.activities.find((a) => a.edgeId === edgeId)!;
