import { expect, test, type Page } from '@playwright/test';
import { api, freshProject, login, open, openEdit, saved, selectEdge, sentence, chooseBranch } from './helpers';

const row = (page: Page, key: string, col: 'base' | 'scenario' | 'delta') => page.locator(`[data-testid=impact-table] [data-row="${key}"] [data-col="${col}"]`);
async function branch(page: Page, name: string) {
  await page.getByTestId('mode-scenario').click();
  if (await page.getByTestId('clear-selection').count()) await page.getByTestId('clear-selection').click();
  await page.getByTestId('scenario-name').fill(name);
  await page.getByTestId('scenario-create').click();
  await expect(page.getByTestId('scenario-banner')).toContainText(name);
}
async function setActive(page: Page, edge: string, minutes: string) {
  await selectEdge(page, edge); await openEdit(page);
  await page.getByTestId('edit-active').fill(minutes);
  await saved(page);
  await page.getByTestId('clear-selection').click();
}

test.describe('Timeline', () => {
  test('replay, scrub, pause, alternate route, deliberate repeat and flagged routes', async ({ page }) => {
    await freshProject(page, 'Timeline');
    await page.getByTestId('mode-timeline').click();
    await expect(page.getByTestId('play-position')).toHaveText('Step 1 of 4');
    // play end to end
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('play-token')).toBeVisible();
    await expect(page.getByTestId('play-position')).toHaveText('Step 4 of 4', { timeout: 15_000 });
    await expect(page.getByTestId('play-toggle')).toContainText('Play', { timeout: 6000 }); // stops by itself at the end
    // scrub to the Find a placement handoff and pause there
    await page.getByTestId('play-scrub').fill('230');
    await expect(page.getByTestId('play-step-label')).toHaveText('Find a placement');
    await expect(page.getByTestId('play-state')).toHaveText('awaiting placement → placement candidate found');
    await expect(page.getByTestId('play-phase')).toHaveText('Working · 22 min active');
    await expect(page.getByTestId('play-token')).toHaveAttribute('data-phase', 'active');
    await page.getByTestId('play-scrub').fill('285');
    await expect(page.getByTestId('play-phase')).toHaveText('Waiting · 2 h'); // waiting is shown differently from work
    await expect(page.getByTestId('play-token')).toHaveAttribute('data-phase', 'waiting');
    await page.getByTestId('play-step-label').click(); // the active handoff opens in the inspector
    await expect(page.getByTestId('lens-title')).toHaveText('Find a placement');

    // alternate route: add a return link, then a route that deliberately repeats triage
    await page.getByTestId('mode-structure').click();
    await page.getByTestId('add-menu').click(); await page.getByTestId('add-connection').click();
    await page.getByTestId('connect-from').selectOption({ label: 'Coordinator' }); await page.getByTestId('connect-to').selectOption({ label: 'Application form' });
    await page.getByTestId('connect-label').fill('Return for missing details'); await page.getByTestId('connect-add').click();
    await saved(page);
    await page.getByTestId('mode-timeline').click();
    await page.getByTestId('route-new').click();
    await page.getByTestId('route-name').fill('Rework route');
    await page.getByTestId('route-start').selectOption({ label: 'Volunteer' });
    const next = (label: RegExp) => page.locator('[data-testid=route-next] button', { hasText: label }).first().click();
    await next(/Submit details/); await next(/Triage application/);
    await expect(page.getByTestId('route-next')).toContainText('The flow branches here'); // the user chooses; nothing is picked silently
    await next(/Return for missing details/); await next(/Triage application.*repeat 2/); await next(/Find a placement/); await next(/Confirm and notify/);
    await expect(page.locator('[data-testid=route-steps] li')).toHaveCount(6);
    await page.getByTestId('route-save').click();
    await expect(page.getByTestId('route-select')).toHaveValue(/.+/);
    await expect(page.getByTestId('play-position')).toHaveText('Step 1 of 6');
    await expect(page.locator('[data-testid=route-flags] [data-code="repeat"]')).toContainText('occurs 2 times');
    await expect(page.locator('[data-testid=route-flags] [data-code="timing"]')).toContainText('Illustrative'); // the new link has no timing
    await expect(page.getByTestId('route-elapsed')).toHaveText('Incomplete');
    // loop safely: it wraps instead of running on
    await page.getByTestId('play-loop').check();
    await page.getByTestId('play-scrub').fill('590');
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('play-position')).toHaveText('Step 1 of 6', { timeout: 6000 });
    await page.getByTestId('play-toggle').click();
    // both routes stay selectable
    await page.getByTestId('route-select').selectOption({ label: 'Main route' });
    await expect(page.getByTestId('play-position')).toHaveText('Step 1 of 4');
    await expect(page.getByTestId('route-elapsed')).toHaveText('171');

    // a disconnected route is flagged and will not play
    await page.getByTestId('mode-structure').click();
    await selectEdge(page, 'e3'); await openEdit(page); await page.getByTestId('delete-item').click(); await saved(page);
    await page.getByTestId('mode-timeline').click();
    await expect(page.locator('[data-testid=route-flags] [data-level="error"]').first()).toContainText('broken');
    await expect(page.getByTestId('play-position')).toHaveText('Not playable');
    await expect(page.getByTestId('play-toggle')).toBeDisabled();
  });
});

test.describe('Scenario and evidence isolation, with the calculation fixtures', () => {
  test('baseline → A → B: comparisons, historical evidence, downstream flags and a moving baseline', async ({ page }) => {
    const id = await freshProject(page, 'Scenario isolation');
    await branch(page, 'A faster matching');
    await setActive(page, 'e3', '10');
    await page.getByTestId('tab-impact').click();
    // same volume: 51 min/case, 68 h/month, 16 h released, route 159
    await expect(row(page, 'percase', 'base')).toHaveText('63 min'); await expect(row(page, 'percase', 'scenario')).toHaveText('51 min');
    await expect(row(page, 'modeled', 'base')).toHaveText('84 h'); await expect(row(page, 'modeled', 'scenario')).toHaveText('68 h'); await expect(row(page, 'modeled', 'delta')).toHaveText('−16 h');
    await expect(row(page, 'common', 'delta')).toHaveText('−16 h');
    await expect(row(page, 'elapsed', 'base')).toHaveText('171 min'); await expect(row(page, 'elapsed', 'scenario')).toHaveText('159 min');
    await expect(page.getByTestId('cash-net')).toHaveText('Unknown'); // no mechanism entered
    await expect(page.getByTestId('cash-note')).toContainText('capacity, not cash');
    await expect(page.getByTestId('impact-unverified')).toBeVisible();

    // changed volume: 85 h vs 84 h (+1), and −16 h like for like at 80, each with its denominator
    await page.getByTestId('scenario-volume').fill('100'); await saved(page);
    await expect(row(page, 'modeled', 'scenario')).toHaveText('85 h'); await expect(row(page, 'modeled', 'delta')).toHaveText('+1 h');
    await expect(page.locator('[data-row="modeled"] th small')).toHaveText('scenario at 100 cases/month vs baseline at 80 cases/month');
    await expect(row(page, 'common', 'scenario')).toHaveText('68 h'); await expect(row(page, 'common', 'delta')).toHaveText('−16 h');
    await expect(page.locator('[data-row="common"] th small')).toHaveText('both at the baseline volume of 80 cases/month');
    await page.getByTestId('scenario-volume').fill('80'); await saved(page);

    // cash and people: 400 − 80 = 320/month, 960 one-time, 3 month payback
    await page.getByTestId('assess-currency').fill('EUR');
    const cash = async (i: number, label: string, kind: string, amount: string, period: string, mechanism: string) => {
      await page.getByTestId('cash-items-add').click();
      const item = page.locator('[data-testid=cash-items] .listed-item').nth(i);
      await item.locator('[data-field="label"]').fill(label); await item.locator('[data-field="kind"]').selectOption(kind); await item.locator('[data-field="amount"]').fill(amount);
      await item.locator('[data-field="period"]').selectOption(period); await item.locator('[data-field="mechanism"]').fill(mechanism);
    };
    await cash(0, 'Paid overtime', 'recurring_saving', '400', 'month', 'Fewer paid overtime hours on the rota');
    await expect(page.getByTestId('cash-net')).toHaveText('400 EUR/month');
    await cash(1, 'Board subscription', 'recurring_cost', '80', 'month', '');
    await cash(2, 'Set-up', 'one_time_cost', '960', 'once', '');
    await expect(page.getByTestId('cash-net')).toHaveText('320 EUR/month');
    await expect(page.getByTestId('cash-payback')).toHaveText('3 months');
    await expect(page.getByTestId('capacity-value')).toHaveText('Not valued');
    // a currency mismatch is refused, not added
    await page.locator('[data-testid=cash-items] .listed-item').nth(1).locator('[data-field="currency"]').fill('USD');
    await expect(page.getByTestId('cash-net')).toHaveText('Unknown'); await expect(page.getByTestId('cash-issue')).toContainText('more than one currency');
    await page.locator('[data-testid=cash-items] .listed-item').nth(1).locator('[data-field="currency"]').fill('EUR');
    await expect(page.getByTestId('cash-net')).toHaveText('320 EUR/month');
    // a role-level human-contact concern with missing data
    await page.getByTestId('tab-people').click();
    await page.getByTestId('human-effects-add').click();
    const he = page.locator('[data-testid=human-effects] .listed-item').first();
    await he.locator('[data-field="role"]').fill('Volunteers'); await he.locator('[data-field="kind"]').selectOption('lost_contact'); await he.locator('[data-field="direction"]').selectOption('negative');
    await he.locator('[data-field="description"]').fill('Less personal contact while waiting for a placement'); await he.locator('[data-field="missingData"]').fill('No baseline for requests for a human follow-up'); await he.locator('[data-field="validation"]').fill('Count follow-up requests for four weeks');
    await saved(page);
    const aHead = (await api(page, `/projects/${id}`)).branches.find((b: any) => b.name === 'A faster matching');

    // B from A: delete e2
    await page.getByTestId('tab-changes').click();
    await branch(page, 'B skip triage');
    await selectEdge(page, 'e2'); await openEdit(page); await page.getByTestId('delete-item').click(); await saved(page);
    await expect(page.getByTestId('lineage')).toContainText('parent: A faster matching'); await expect(page.getByTestId('lineage')).toContainText('original baseline: Baseline');
    // vs parent: only the removal
    const changes = page.getByTestId('scenario-changes');
    await expect(changes.locator('[data-change="removed"][data-id="e2"]')).toBeVisible();
    await expect(changes.locator('[data-id="e3"]')).toHaveCount(0);
    await expect(page.getByTestId('broken-route')).toContainText('Main route');
    await expect(page.getByTestId('unreachable')).toContainText('Placement confirmed');
    await expect(page.getByTestId('downstream')).toContainText('Find a placement');
    await expect(page.locator('.ghost[data-removed="e2"]')).toBeVisible(); // the removed handoff is drawn as a ghost
    // vs original baseline: the removal and A's duration change
    await page.getByTestId('compare-select').selectOption({ label: 'Original baseline (rev 1)' });
    await expect(changes.locator('[data-change="removed"][data-id="e2"]')).toBeVisible();
    await expect(changes.locator('[data-change="changed"][data-id="e3"]')).toContainText('active time: 22 min → 10 min');
    // evidence: t1 is historical in B, attached in the baseline and in A
    await page.getByTestId('tab-evidence').click();
    await expect(page.locator('[data-testid=scenario-evidence] [data-note="t1"] [data-anchor-state="historical"]')).toContainText('still attached on Baseline');
    await chooseBranch(page, 'Scenario: A faster matching');
    await page.getByTestId('nav-notes').click();
    await expect(page.locator('[data-note="t1"] [data-anchor-state="attached"]')).toContainText('Triage application');
    await chooseBranch(page, 'Baseline');
    await expect(page.locator('[data-note="t1"] [data-anchor-state="attached"]')).toContainText('Triage application');
    expect((await api(page, `/projects/${id}/evidence`)).notes.find((n: any) => n.id === 't1').targetId).toBe('e2');

    // update the live baseline; both branches keep their original comparison revisions
    await page.getByTestId('nav-map').click(); await page.getByTestId('mode-structure').click();
    await setActive(page, 'e1', '9');
    const after = (await api(page, `/projects/${id}`)).branches;
    expect(after.find((b: any) => b.name === 'A faster matching').baseRevisionId).toBe('rev-base-1');
    expect(after.find((b: any) => b.name === 'B skip triage').baseRevisionId).toBe(aHead.headRevisionId);
    await chooseBranch(page, 'Scenario: A faster matching');
    await page.getByTestId('mode-scenario').click(); await page.getByTestId('tab-impact').click();
    await expect(row(page, 'percase', 'base')).toHaveText('63 min'); // still the pinned baseline, not the edited one
    await expect(row(page, 'modeled', 'delta')).toHaveText('−16 h');

    // the concern and its validation plan reach the report; no customer-loss number is invented
    await page.getByTestId('nav-decide').click();
    await page.getByTestId('opp-new').fill('Faster matching'); await page.getByTestId('opp-add').click();
    await page.locator('[data-add-option="process_change"]').click();
    await expect(page.locator('[data-option][data-kind="process_change"]')).toBeVisible();
    const opt = (await api(page, `/projects/${id}/evidence`)).options[0];
    await page.request.patch(`/api/projects/${id}/c/options/${opt.id}`, { data: { scenarioBranchId: aHead.id } });
    await page.reload(); await page.getByTestId('nav-decide').click();
    await page.getByTestId('opt-recommend').click();
    await page.getByTestId('nav-report').click();
    await expect(page.getByTestId('rec-comparison')).toContainText('Net recurring cash effect: 320 EUR per month');
    await expect(page.getByTestId('rec-comparison')).toContainText('Simple payback: 3 months');
    await expect(page.getByTestId('rec-human')).toContainText('Less personal contact while waiting for a placement');
    await expect(page.getByTestId('rec-human')).toContainText('Not quantified — missing: No baseline for requests for a human follow-up');
    await expect(page.getByTestId('rec-human')).toContainText('Count follow-up requests for four weeks');
    // editing the scenario afterwards marks the recommendation stale
    await page.getByTestId('nav-map').click();
    await chooseBranch(page, 'Scenario: A faster matching');
    await setActive(page, 'e3', '12');
    await page.getByTestId('nav-decide').click();
    await expect(page.getByTestId('stale-banner')).toBeVisible();
  });

  test('unknown inputs stay unknown; a sourced zero is a value', async ({ page }) => {
    await freshProject(page, 'Unknown inputs');
    await selectEdge(page, 'e3'); await openEdit(page);
    await page.getByTestId('edit-active').fill(''); await saved(page);
    await expect(page.locator('[data-label-for="e3"] .edge-sub')).toContainText('? active');
    await page.getByTestId('clear-selection').click();
    await expect(page.getByTestId('stat-percase')).toHaveText('Incomplete · 41 min known');
    await expect(page.getByTestId('stat-monthly')).toHaveText('Incomplete');
    await expect(page.getByTestId('quiet-panel')).toContainText('1 included input is missing: Find a placement');
    await page.getByTestId('mode-timeline').click();
    await expect(page.getByTestId('route-elapsed')).toHaveText('Incomplete');
    // in a scenario that fills the gap, the headline change still reads incomplete
    await branch(page, 'Measured matching');
    await setActive(page, 'e3', '10');
    await page.getByTestId('tab-impact').click();
    await expect(row(page, 'percase', 'base')).toHaveText('Incomplete (41 min known)');
    await expect(row(page, 'common', 'delta')).toHaveText('Incomplete');
    await expect(row(page, 'elapsed', 'delta')).toHaveText('Incomplete');
    await expect(page.getByTestId('impact-incomplete')).toContainText('no headline change is stated');
    await expect(page.getByTestId('impact-missing')).toContainText('baseline: Find a placement');
    // sourced zero on the baseline
    await chooseBranch(page, 'Baseline');
    await page.getByTestId('mode-structure').click();
    await selectEdge(page, 'e3'); await openEdit(page);
    await page.getByTestId('edit-active').fill('0');
    await page.getByLabel('Active time basis').selectOption('measured'); await saved(page);
    await page.getByTestId('clear-selection').click();
    await expect(page.getByTestId('stat-percase')).toHaveText('41 min');
    await expect(page.getByTestId('stat-monthly')).toHaveText('54.7 h');
  });
});

test.describe('Strengthening the existing workflow', () => {
  test('protected conversation time: preserve, workload by role, reversible trial, indicators, transferred burden', async ({ page }) => {
    const id = await freshProject(page, 'Strengthen the workflow');
    await branch(page, 'Protected matching hour');
    // easier routine capacity checks: the coordinator's check gets shorter; program leads take on a weekly update
    await selectEdge(page, 'e5'); await openEdit(page); await page.getByTestId('edit-active').fill('4'); await saved(page);
    await page.locator('[data-node="n4"]').click();
    await page.getByRole('button', { name: '+ Internal activity' }).click();
    await expect(page.getByTestId('activity-panel')).toBeVisible();
    await page.getByTestId('activity-panel').getByLabel('Label').fill('Update shared capacity board');
    await page.getByTestId('edit-active').fill('3'); await saved(page);
    await page.getByTestId('clear-selection').click();
    await page.getByTestId('tab-people').click();
    const roles = page.getByTestId('role-table');
    await expect(roles.locator('tr', { hasText: 'Coordinator' })).toContainText('−10.7 h');
    await expect(roles.locator('tr', { hasText: 'Program lead' })).toContainText('absorbs work'); // the transferred burden is visible
    await page.getByTestId('assess-preserve').fill('The personal matching conversation between coordinator and volunteer.');
    await page.getByTestId('working-conditions-add').click();
    const wc = page.locator('[data-testid=working-conditions] .listed-item').first();
    await wc.locator('[data-field="role"]').fill('Coordinator'); await wc.locator('[data-field="indicator"]').fill('After-hours work'); await wc.locator('[data-field="baseline"]').fill('Reported most weeks'); await wc.locator('[data-field="expected"]').fill('Unknown until the trial');
    await page.getByTestId('guardrails-add').click();
    const g = page.locator('[data-testid=guardrails] .listed-item').first();
    await g.locator('[data-field="metric"]').fill('Placement quality'); await g.locator('[data-field="denominator"]').fill('placements still active after 8 weeks'); await g.locator('[data-field="owner"]').fill('Coordinator'); await g.locator('[data-field="rollbackTrigger"]').fill('retention drops below the baseline period');
    await page.getByTestId('assess-reversal').fill('Stop blocking the hour; no tooling to remove.');
    await page.getByTestId('assess-unknowns').fill('Whether program leads keep the board current.');
    await saved(page);
    const sc = (await api(page, `/projects/${id}`)).branches.find((b: any) => b.kind === 'scenario');
    const post = async (c: string, data: object) => (await (await page.request.post(`/api/projects/${id}/c/${c}`, { data })).json()).doc;
    const opp = await post('opportunities', { title: 'Protect matching conversations', preserve: 'The personal matching conversation.', stakeholders: 'Coordinators gain focus time; program leads take on a short weekly update.', validationPlan: 'Two-week trial with two programs; review with the people affected.' });
    const opt = await post('options', { opportunityId: opp.id, kind: 'process_change', title: 'Protected matching hour and a shared capacity board', smallestReversible: true, scenarioBranchId: sc.id, shiftedWork: 'Program leads update the board weekly.', unknowns: 'Board upkeep.' });
    await page.request.patch(`/api/projects/${id}/c/opportunities/${opp.id}`, { data: { recommendedOptionId: opt.id } });
    await page.getByTestId('nav-report').click();
    const brief = page.getByTestId('brief-preview');
    await expect(brief).toContainText('Smallest reversible change: Protected matching hour and a shared capacity board');
    await expect(brief).toContainText('Protect. The personal matching conversation.');
    await expect(brief).toContainText('Coordinator · After-hours work: Reported most weeks → Unknown until the trial');
    await expect(page.getByTestId('rec-guardrails')).toContainText('Placement quality');
    await expect(page.getByTestId('rec-guardrails')).toContainText('roll back if retention drops below the baseline period');
    await expect(brief).toContainText('To reverse. Stop blocking the hour');
    await expect(page.getByTestId('rec-heading')).toContainText('Hypothesis to test'); // no linked observations yet
    const data = await api(page, `/projects/${id}/export/brief.json`);
    expect(JSON.stringify(data)).not.toMatch(/participantRole|Applicant"|Illustrative interview 0\d/); // role-level only; unapproved source IDs withheld
    expect(data.recommendations[0].comparison.byRole.map((r: any) => r.role)).toEqual(expect.arrayContaining(['Coordinator', 'Program lead']));
  });
});

test.describe('Wide and deep research', () => {
  test('jobs, failure modes, manual import and accept-once', async ({ page }) => {
    const id = await freshProject(page, 'Research jobs');
    await page.getByTestId('nav-research').click();
    await expect(page.getByTestId('provider-status')).toContainText('synthetic output'); // fixture provider is labelled
    // wide
    await page.getByTestId('new-wide').click();
    await page.getByTestId('run-question').fill('How do small volunteer programmes confirm placement capacity?');
    await page.getByTestId('run-submit').click();
    const wide = page.getByTestId('run').first();
    await expect(wide.getByTestId('run-status')).toHaveText('Ready for review', { timeout: 15_000 });
    await expect(wide.getByTestId('run-synthetic')).toBeVisible();
    await expect(wide.locator('[data-testid=run-citations] li')).toHaveCount(2);
    await expect(wide.locator('[data-testid=run-citations] a').first()).toHaveAttribute('href', /^https:\/\//);
    await expect(wide.getByTestId('run-coverage')).toContainText('capacity check');
    await expect(wide.locator('[data-testid=run-followups] li').first()).toContainText('How often does a placement wait');
    await expect(page.locator('[data-candidate][data-kind="assessment"]')).toContainText('Awaiting review');
    // deep: needs approved excerpts
    await page.getByTestId('new-deep').click();
    await expect(page.getByTestId('run-notes')).toContainText('No note is approved yet');
    await page.keyboard.press('Escape');
    for (const n of ['t1', 't2']) await page.request.patch(`/api/projects/${id}/c/notes/${n}`, { data: { excerptApproved: true } });
    await page.reload(); await page.getByTestId('nav-research').click();
    await page.getByTestId('new-deep').click();
    await expect(page.locator('[data-note-pick]')).toHaveCount(2); // t3 is not approved and cannot be chosen
    await page.locator('[data-note-pick="t1"]').check(); await page.locator('[data-note-pick="t2"]').check();
    await page.getByTestId('run-question').fill('Why do placements wait, and what would show we are wrong?');
    await page.getByTestId('run-submit').click();
    await expect(page.getByTestId('run').first().getByTestId('run-status')).toHaveText('Ready for review', { timeout: 15_000 });
    await expect(page.locator('[data-candidate][data-kind="contradiction"]')).toContainText('Sources disagree');
    await expect(page.locator('[data-candidate][data-kind="measurement_target"]')).toContainText('Measurement gap');
    await expect(page.locator('[data-candidate][data-kind="activity"]')).toContainText('duration unknown');
    const before = await api(page, `/projects/${id}/branches/baseline`);
    expect(before.revision.model.activities).toHaveLength(5); // drafts wait; nothing was applied

    // invalid output and timeout fail visibly; cancellation works; retry recovers
    const start = async (q: string) => { await page.getByTestId('new-wide').click(); await page.getByTestId('run-question').fill(q); await page.getByTestId('run-submit').click(); };
    await start('Scan practice [invalid]');
    await expect(page.getByTestId('run').first().getByTestId('run-status')).toHaveText('Failed', { timeout: 15_000 });
    await expect(page.getByTestId('run').first().getByTestId('run-error')).toContainText('Nothing was added to review');
    await start('Scan practice [slow]');
    const slow = page.getByTestId('run').first();
    await expect(slow.getByTestId('run-status')).toHaveText('Running', { timeout: 10_000 });
    await slow.getByTestId('run-cancel').click();
    await expect(slow.getByTestId('run-status')).toHaveText('Cancelled', { timeout: 10_000 });
    await page.reload(); await page.getByTestId('nav-research').click(); // results and dispositions survive a refresh
    await expect(page.getByTestId('run')).toHaveCount(4);
    await expect(page.getByTestId('run').first().getByTestId('run-status')).toHaveText('Cancelled');

    // manual import of the bundled skill example
    await page.getByTestId('cand-import').click();
    await page.getByTestId('cand-file').setInputFiles('reference/handoff/reference/weave_research_skill/examples/semantic-relationship.json');
    await page.getByTestId('cand-import-run').click();
    const rel = page.locator('[data-candidate][data-kind="relationship"]');
    await expect(rel.getByTestId('cand-sentence')).toHaveText('The application moves from Application form to Coordinator, who reviews it and changes its state from submitted to ready for placement.');
    await expect(rel.getByTestId('cand-basis')).toContainText('hypothetical workflow walkthrough');
    // an invalid bundle is refused whole
    await page.getByTestId('cand-import').click();
    await page.getByTestId('cand-json').fill('{"format":"weave-research-candidates","version":1,"candidates":[{"kind":"note","summary":"x"}]}');
    await page.getByTestId('cand-import-run').click();
    await expect(page.getByTestId('cand-import-error')).toContainText('Nothing was imported');
    await page.keyboard.press('Escape');

    // accept once, then retry the same action (double click + direct replays)
    const relId = await rel.getAttribute('data-candidate');
    await rel.getByTestId('cand-accept').dblclick();
    await page.getByTestId('inbox-accepted').click();
    await expect(page.locator(`[data-candidate="${relId}"]`).getByTestId('cand-status')).toHaveText('accepted');
    const replay = await Promise.all([1, 2, 3].map(() => page.request.post(`/api/projects/${id}/candidates/${relId}/accept`)));
    for (const r of replay) expect((await r.json()).alreadyAccepted).toBe(true);
    const after = await api(page, `/projects/${id}/branches/baseline`);
    expect(after.revision.model.edges.filter((e: any) => e.label === 'Review application')).toHaveLength(1);
    expect(after.revision.model.edges).toHaveLength(7);
    const audit = (await api(page, `/projects/${id}/audit`)).entries.filter((e: any) => e.action === 'candidate.accept' && e.entityId === relId);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe('Rae Researcher');
    // the accepted connection is on the map, with its basis attached as evidence
    await page.getByTestId('nav-map').click();
    await expect(page.locator('[data-edge]')).toHaveCount(7);
    // needs evidence and reject keep their disposition
    await page.getByTestId('nav-research').click(); await page.getByTestId('inbox-pending').click();
    await page.locator('[data-candidate][data-kind="activity"]').getByTestId('cand-needs').click();
    await page.locator('[data-candidate][data-kind="measurement_target"]').getByTestId('cand-reject').click();
    await page.reload(); await page.getByTestId('nav-research').click();
    await page.getByTestId('inbox-needs_evidence').click(); await expect(page.locator('[data-candidate][data-kind="activity"]')).toHaveCount(1);
    await page.getByTestId('inbox-rejected').click(); await expect(page.locator('[data-candidate][data-kind="measurement_target"]')).toHaveCount(1);
  });
});

test.describe('Privacy and operation', () => {
  test('a reader cannot change anything and an outsider cannot open the project', async ({ page, browser }) => {
    const demo = (await (async () => { await login(page, 'reader@weave.test'); return (await api(page, '/projects')).projects[0]; })());
    expect(demo.role).toBe('reader');
    await open(page, demo.id);
    await expect(page.getByTestId('save-status')).toHaveText('Read only');
    await expect(page.getByTestId('add-menu')).toHaveCount(0); await expect(page.getByTestId('tidy')).toHaveCount(0); await expect(page.locator('.port')).toHaveCount(0);
    await selectEdge(page, 'e2'); await openEdit(page);
    await expect(page.getByTestId('edit-label')).toBeDisabled(); await expect(page.getByTestId('edit-performer')).toBeDisabled(); await expect(page.getByTestId('delete-item')).toHaveCount(0);
    await page.getByTestId('disc-evidence').locator('summary').click();
    await expect(page.getByTestId('quick-capture')).toHaveCount(0);
    await page.getByTestId('nav-research').click(); await expect(page.getByTestId('new-wide')).toHaveCount(0);
    await page.getByTestId('nav-report').click(); await expect(page.getByTestId('brief-preview')).toBeVisible(); // reading and exporting are allowed
    const denied = await page.request.put(`/api/projects/${demo.id}/branches/baseline/layout`, { data: { layout: {} } });
    expect(denied.status()).toBe(403);

    const out = await (await browser.newContext()).newPage();
    await login(out, 'outsider@weave.test');
    await out.goto(`/#/p/${demo.id}`);
    await expect(out.getByTestId('load-error')).toHaveText('Project not found.');
    for (const p of ['/evidence', '/research', '/export/workspace.json', '/export/brief.pdf', '/branches/baseline']) expect((await out.request.get(`/api/projects/${demo.id}${p}`)).status()).toBe(404);
    await out.context().close();
  });
});

test.describe('Keyboard and mobile', () => {
  test('add and connect nodes from the keyboard, with visible focus and focus restored on drawer close', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 }); // drawer layout
    await freshProject(page, 'Keyboard');
    // add two nodes and a connection without touching the pointer
    const viaMenu = async (item: string) => { await page.getByTestId('add-menu').focus(); await page.keyboard.press('Enter'); await page.getByTestId(item).focus(); await page.keyboard.press('Enter'); };
    await viaMenu('add-node');
    await page.keyboard.type('Front desk'); await page.keyboard.press('Enter');
    await expect(page.locator('[data-node] .name', { hasText: 'Front desk' })).toBeVisible();
    await page.keyboard.press('Escape');
    await viaMenu('add-connection');
    await page.getByTestId('connect-from').selectOption({ label: 'Front desk' }); await page.getByTestId('connect-to').selectOption({ label: 'Coordinator' });
    await page.getByTestId('connect-type').selectOption('info'); await page.getByTestId('connect-label').focus(); await page.keyboard.type('Pass on a walk-in enquiry'); await page.keyboard.press('Enter');
    await expect(page.locator('[data-edge]')).toHaveCount(7);
    await expect(page.getByTestId('lens-type')).toHaveText('Information'); // type name in text, not only colour
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('inspector')).not.toHaveClass(/open/);
    // tab to a connection on the canvas: visible focus, Enter opens, close returns focus
    const edge = page.locator('[data-edge="e2"]');
    await edge.focus();
    await expect(edge).toBeFocused();
    const strokeFocused = await edge.locator('.edgepath').evaluate((el) => getComputedStyle(el).strokeWidth);
    expect(parseFloat(strokeFocused)).toBeGreaterThanOrEqual(4); // focus is drawn on the line itself
    await expect(edge).toHaveAttribute('aria-label', /Work flow connection: Triage application, from Application form to Coordinator/);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('inspector')).toHaveClass(/open/);
    await expect(sentence(page)).toContainText('who reviews it');
    await page.getByTestId('drawer-close').click();
    await expect(page.getByTestId('inspector')).not.toHaveClass(/open/);
    await expect(edge).toBeFocused(); // focus goes back to where the drawer was opened from
    // the port can start a connection from the keyboard too
    await page.locator('[data-node="n6"] .port').focus(); await page.keyboard.press('Enter');
    await page.locator('[data-node="n1"]').focus(); await page.keyboard.press('Enter');
    await expect(page.locator('[data-edge]')).toHaveCount(8);
    // every node and connection is reachable as text in the outline
    await page.keyboard.press('Escape'); await page.getByTestId('open-details').click(); await page.getByTestId('clear-selection').click();
    await page.getByTestId('open-details').click();
    await expect(page.getByTestId('outline')).toContainText('Triage application'); await expect(page.getByTestId('outline')).toContainText('Work flow');
    await expect(page.getByTestId('outline')).toContainText('Pass on a walk-in enquiry'); await expect(page.getByTestId('outline')).toContainText('Information');
  });

});

test.describe('Mobile', () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });
  test('at 390 px: capture a note, inspect the linked edge, and return to the same map', async ({ page }) => {
    await freshProject(page, 'Mobile');
    await page.getByRole('button', { name: 'Fit the whole map' }).click();
    const viewBefore = await page.getByTestId('graph').getAttribute('viewBox');
    await page.locator('[data-label-for="e3"]').tap();
    await expect(page.getByTestId('inspector')).toHaveClass(/open/);
    await expect(page.getByTestId('lens-title')).toHaveText('Find a placement');
    await page.getByTestId('disc-evidence').locator('summary').tap();
    await page.getByTestId('disc-evidence').getByTestId('capture-text').fill('Checks the board on a phone between visits.');
    await page.getByTestId('disc-evidence').getByTestId('capture-save').tap();
    await expect(page.getByTestId('disc-evidence').locator('.sticky', { hasText: 'Checks the board on a phone' })).toBeVisible();
    // the sheet stays within the screen and nothing scrolls sideways
    const sheet = (await page.getByTestId('inspector').boundingBox())!;
    expect(sheet.x).toBeGreaterThanOrEqual(0); expect(sheet.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByTestId('drawer-close').tap();
    await expect(page.getByTestId('inspector')).not.toHaveClass(/open/);
    // same map, same view, same selection; the map is usable again
    expect(await page.getByTestId('graph').getAttribute('viewBox')).toBe(viewBefore);
    await expect(page.locator('[data-edge="e3"]')).toHaveClass(/selected/);
    await expect(page.locator('[data-pin-for="e3"]')).toHaveAttribute('data-count', '2');
    await page.locator('[data-label-for="e4"]').tap();
    await expect(page.getByTestId('lens-title')).toHaveText('Confirm and notify');
    await page.getByTestId('drawer-close').tap();
    await page.getByTestId('fab-note').tap();
    await expect(page.getByTestId('capture-target')).toHaveValue('e4'); // the quick note defaults to the selected item
  });

  test('at 390 px: the menu at the top left switches map version and returns to all projects', async ({ page }) => {
    await freshProject(page, 'Phone menu');
    await page.getByTestId('branch-select').tap();
    const menu = page.getByTestId('project-menu');
    await expect(menu.getByRole('menuitemradio', { name: 'Baseline' })).toHaveAttribute('aria-checked', 'true');
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.getByTestId('graph').tap({ position: { x: 200, y: 400 } }); // tapping elsewhere closes it
    await expect(menu).toHaveCount(0);
    await page.getByTestId('branch-select').tap();
    await page.getByTestId('menu-projects').tap();
    await expect(page.getByTestId('projects')).toBeVisible();
    await expect(page.locator('[data-project="Phone menu"]')).toBeVisible();
  });
});
