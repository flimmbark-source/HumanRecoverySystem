import { expect, test, type Page } from '@playwright/test';
import { api, freshProject } from './helpers';

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const NOTES = '- I watched the coordinator phone each applicant before matching.\n- Takes about 20 min per placement.\n- The procedure says matching is done from the form alone.';

/** Imports three notes on the device and places the timing note on "Find a placement" (e3). */
async function importNotes(page: Page) {
  await page.getByTestId('nav-notes').click();
  await page.getByTestId('archive-add').click();
  await page.getByTestId('import-text').fill(NOTES);
  await page.getByTestId('import-name').fill('Observation day');
  await page.getByTestId('split-phone').click();
  await page.locator('.fn-span', { hasText: 'Takes about 20 min' }).click();
  await page.getByTestId('fn-editor').getByTestId('fn-place').selectOption('e3');
  await page.keyboard.press('Escape');
  await page.getByTestId('review-save').click();
  await expect(page.getByTestId('toast')).toContainText('Saved 3 notes');
}

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
  test(`notes become proposed map changes, a draft, and after comparing, the main map (${label})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    page.on('dialog', (d) => void d.accept());
    const id = await freshProject(page, `Map from notes ${label}`);
    await importNotes(page);
    const before = (await api(page, `/projects/${id}/branches/baseline`)).revision.model;

    // what is sent is shown first
    await page.getByTestId('propose-map').click();
    await expect(page.getByRole('dialog', { name: 'Update the map from notes' })).toContainText('Sent: the text of these notes');
    await page.getByTestId('propose-send').click();
    const proposals = page.getByTestId('map-proposals');
    await expect(proposals).toContainText('Proposed by the test provider (no AI) from 3 notes');
    const node = proposals.locator('[data-op="add_node"]'), edge = proposals.locator('[data-op="add_edge"]'), removal = proposals.locator('[data-op="remove"]');
    await expect(node).toContainText('New person / role: Applicant');
    await expect(proposals.locator('[data-op="set_timing"]')).toContainText('20 min active (reported)');
    // removals start unticked; each change shows the notes behind it
    await expect(removal.locator('input')).not.toBeChecked();
    await node.getByText('Based on 1 note').click();
    await expect(node.locator('.chg-notes')).toContainText('I watched the coordinator phone each applicant');
    // unticking a new box holds back the connection that needs it
    await expect(page.getByTestId('make-draft')).toHaveText('Make a draft with 3 changes');
    await node.locator('input').uncheck();
    await expect(edge).toContainText('Needs a new box you unticked');
    await expect(page.getByTestId('make-draft')).toHaveText('Make a draft with 1 change');
    await node.locator('input').check();
    await shot(page, `${label}-m1-proposals`);
    await page.getByTestId('make-draft').click();

    // the draft opens on the map; the main map is untouched
    await expect(page.getByTestId('scenario-banner')).toContainText('changes from your notes');
    await expect(page.getByRole('button', { name: 'person Applicant', exact: true })).toBeVisible();
    expect((await api(page, `/projects/${id}/branches/baseline`)).revision.model).toEqual(before);
    const draft = (await api(page, `/projects/${id}`)).branches.find((b: any) => b.origin?.type === 'archive');
    const draftModel = (await api(page, `/projects/${id}/branches/${draft.id}`)).revision.model;
    const applicant = draftModel.nodes.find((n: any) => n.label === 'Applicant');
    expect(applicant.basis).toHaveLength(1);
    expect(draftModel.activities.find((a: any) => a.edgeId === 'e3').activeMinutes).toMatchObject({ value: 20, basis: 'reported' });
    // 🗒 on the new box: one note behind it, seen; tapping it opens what it rests on
    const pin = page.locator(`[data-pin-for="${applicant.id}"]`);
    await expect(pin).toHaveAttribute('data-count', '1');
    await expect(pin).toHaveAttribute('data-level', 'seen');
    await pin.click();
    await expect(page.getByTestId('node-panel')).toContainText('Applicant');
    const basis = page.getByTestId('node-panel').getByTestId('basis');
    await expect(basis).toContainText('Based on 1 note: 1 seen');
    await basis.getByTestId('basis-toggle').click();
    await expect(basis).toContainText('I watched the coordinator phone each applicant');
    await shot(page, `${label}-m2-draft-basis`);
    // a box with nothing behind it says so
    await expect(page.locator('[data-pin-for="n1"]')).toHaveAttribute('data-level', 'none');

    // adopt: the draft becomes the main map; the old main map is in its history
    if (await page.locator('.right.open').count() && viewport.width <= 990) await page.getByTestId('drawer-close').click();
    await page.getByTestId('scenario-banner').getByTestId('adopt-draft').click();
    await expect(page.getByTestId('toast')).toContainText('This is now the main map');
    await expect(page.getByTestId('scenario-banner')).toHaveCount(0);
    const main = (await api(page, `/projects/${id}/branches/baseline`)).revision;
    expect(main.summary).toContain('Adopted');
    expect(main.model.nodes.some((n: any) => n.label === 'Applicant')).toBe(true);
    const history = (await api(page, `/projects/${id}/branches/baseline/revisions`)).revisions;
    expect(history.some((r: any) => JSON.stringify(r.model ?? {}) === JSON.stringify(before) || r.seq === 1)).toBe(true);
    await expect(page.getByRole('button', { name: 'person Applicant', exact: true })).toBeVisible();
    await shot(page, `${label}-m3-adopted`);
  });
}

test('adopting a draft after the main map changed asks first, and can be declined', async ({ page }) => {
  const id = await freshProject(page, 'Adopt after change');
  await importNotes(page);
  await page.getByTestId('propose-map').click();
  await page.getByTestId('propose-send').click();
  await page.getByTestId('make-draft').click();
  await expect(page.getByTestId('scenario-banner')).toBeVisible();
  // someone changes the main map meanwhile
  const base = (await api(page, `/projects/${id}/branches/baseline`)).revision;
  const changed = { ...base.model, nodes: base.model.nodes.map((n: any) => (n.id === 'n1' ? { ...n, label: 'Renamed meanwhile' } : n)) };
  expect((await page.request.put(`/api/projects/${id}/branches/baseline/model`, { data: { expectedRevisionId: base.id, model: changed, summary: 'Meanwhile' } })).ok()).toBeTruthy();
  const asked: string[] = [];
  page.on('dialog', (d) => { asked.push(d.message()); void (asked.length === 1 ? d.accept() : d.dismiss()); });
  await page.getByTestId('scenario-banner').getByTestId('adopt-draft').click();
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toContain('The main map has changed since this draft was made');
  expect((await api(page, `/projects/${id}/branches/baseline`)).revision.summary).toBe('Meanwhile');
  await expect(page.getByTestId('scenario-banner')).toBeVisible();
});
