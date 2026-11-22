import { expect, test, type Page } from '@playwright/test';
import { api, freshProject } from './helpers';

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const evidence = (page: Page, id: string) => api(page, `/projects/${id}/evidence`);
const box = (page: Page, text: string) => page.getByTestId('insight').filter({ hasText: text });
const fab = (page: Page) => page.getByTestId('insight-fab');
/** A detail highlighted where the details panel shows it, and its ✦ mark. */
const pickable = (page: Page, key: string) => page.locator(`.right [data-pick="${key}"]`).first();
const mark = (page: Page, key: string) => page.locator(`.right [data-pick="${key}"] > [data-testid=pick-mark]`).first();
/** Records made through the API reach the page on a reload. */
async function reload(page: Page) { await page.reload(); await expect(page.locator('[data-node]').first()).toBeVisible(); }

/** Taps a map item. On a phone the details sheet is closed first, and the map fitted if the item is off screen. */
async function tapOnMap(page: Page, selector: string) {
  if (page.viewportSize()!.width <= 990 && (await page.locator('.right.open').count())) await page.getByTestId('drawer-close').click();
  if (!(await page.locator(selector).isVisible()) || !(await inViewport(page, selector))) await page.getByRole('button', { name: 'Fit the whole map' }).click();
  await page.locator(selector).click();
}
const inViewport = (page: Page, selector: string) => page.locator(selector).evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; });

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }], ['small phone', { width: 360, height: 740 }]] as const) {
  test.describe(`insights at ${label} width`, () => {
    test.use({ viewport });

    test('write, link from the map, add details from the details panel, return, and keep them after reload', async ({ page }) => {
      const id = await freshProject(page, `Insights ${label}`);
      const note = (await (await page.request.post(`/api/projects/${id}/c/notes`, { data: { text: 'The coordinator waits for a callback before matching.', targetId: 'e3', certainty: 'observed' } })).json()).doc;
      await reload(page);

      // 1. a text-only insight written straight on the page
      await page.getByTestId('nav-insights').click();
      await page.getByTestId('insight-new').click();
      await page.getByTestId('insight-new-text').fill('Matching quality depends on the conversation, not the form.');
      await page.getByTestId('insight-new-save').click();
      const textOnly = box(page, 'Matching quality depends');
      await expect(textOnly).toHaveAttribute('data-expanded', 'true');
      await expect(textOnly.getByTestId('insight-card')).toHaveCount(0);
      await expect(textOnly.getByTestId('insight-edit')).toBeVisible();
      await shot(page, `${label}-1-text-only`);
      let ev = await evidence(page, id);
      expect(ev.insights[0]).toMatchObject({ body: 'Matching quality depends on the conversation, not the form.', modelLinks: [] });

      // 2. one from the map: tap the boxes, write the thought; it comes back here, open
      await page.getByTestId('insight-start').click();
      await expect(page.getByTestId('insight-bar')).toBeVisible();
      await tapOnMap(page, '[data-node="n3"]');
      await tapOnMap(page, '[data-label-for="e3"]');
      await page.getByTestId('insight-text').fill('Waiting for capacity answers stalls placements.');
      await page.getByTestId('insight-text').press('Enter');
      await expect(page.getByTestId('insights')).toBeVisible();
      const fromMap = box(page, 'Waiting for capacity');
      await expect(fromMap).toHaveAttribute('data-expanded', 'true');
      await expect(fromMap.getByTestId('insight-card')).toHaveCount(2);
      // the cards are the map's own shapes: a node box and a connection label
      await expect(fromMap.locator('[data-item="n3"] .nodeSvg rect.base')).toHaveCount(1);
      await expect(fromMap.locator('[data-item="e3"] .edgeLabel .edge-title')).toHaveText('Find a placement');
      await shot(page, `${label}-2-from-map`);

      // collapsing and expanding: the collapsed box shows the thought and Show on map only
      await fromMap.getByTestId('insight-toggle').click();
      await expect(fromMap).toHaveAttribute('data-expanded', 'false');
      await expect(fromMap.getByTestId('insight-card')).toHaveCount(0);
      await expect(fromMap.getByTestId('show-on-map')).toBeVisible();
      await shot(page, `${label}-3-collapsed`);
      await fromMap.getByTestId('insight-toggle').click();
      await expect(fromMap.getByTestId('insight-card')).toHaveCount(2);

      // 3. a card opens its item on the map with the usual details panel, in the insight's mode
      await fromMap.locator('[data-item="e3"]').getByTestId('card-open').click();
      await expect(page.getByTestId('edge-lens')).toBeVisible();
      await expect(page.locator('.canvas-wrap.insight-ctx')).toHaveCount(1);
      await expect(page.locator('[data-edge="e3"].picked')).toHaveCount(1);
      await expect(page.locator('[data-node="n3"].picked')).toHaveCount(1);
      await expect(page.getByTestId('insight-thread')).toHaveCount(1);
      await expect(fab(page)).toHaveAttribute('data-state', 'back');
      await expect(fab(page)).toHaveText('← Back to insight');
      await expect(page.getByTestId('ctx-picker')).toContainText('Waiting for capacity');

      // 4. pick a recorded field and a note where the panel shows them; the button becomes Add to insight
      const picker = page.getByTestId('ctx-picker');
      await expect(page.locator('.right .pickable')).not.toHaveCount(0);
      await shot(page, `${label}-3b-in-context`);
      await mark(page, 'waiting').click();
      await expect(pickable(page, 'waiting')).toHaveClass(/picked/);
      // a note is picked by tapping the note itself
      await page.locator(`.right [data-pick="note:${note.id}"] .sticky-text`).click();
      await expect(pickable(page, `note:${note.id}`)).toHaveClass(/picked/);
      // the selection is listed at the top of the panel
      await expect(picker.getByTestId('ctx-selected')).toHaveCount(2);
      await expect(picker.locator('[data-testid=ctx-selected][data-key="waiting"]')).toContainText('Waiting time');
      await expect(fab(page)).toHaveAttribute('data-state', 'add');
      await expect(fab(page)).toHaveText('✦ Add to insight (2)');
      await expect(fab(page)).toBeInViewport();
      await shot(page, `${label}-4-picked`);
      // unpicking works from the summary and in place, and picking again
      await picker.locator('[data-testid=ctx-selected][data-key="waiting"] button').click();
      await expect(fab(page)).toHaveText('✦ Add to insight (1)');
      await expect(pickable(page, 'waiting')).not.toHaveClass(/picked/);
      await mark(page, 'waiting').click();
      await fab(page).click();
      await expect(page.getByTestId('toast')).toContainText('Added 2 details');
      // it stays on the map, and the button goes back to Back to insight
      await expect(page.getByTestId('graph')).toBeVisible();
      await expect(fab(page)).toHaveAttribute('data-state', 'back');
      await expect(mark(page, 'waiting')).toBeDisabled();
      await expect(pickable(page, 'waiting')).toHaveClass(/added/);
      await expect(picker.getByTestId('ctx-selected')).toHaveCount(0);
      await expect(picker).toContainText('On the card: ');
      await expect.poll(async () => (await evidence(page, id)).insights.find((i: any) => i.body.startsWith('Waiting')).focus).toEqual({ e3: [`note:${note.id}`, 'waiting'] });
      ev = await evidence(page, id);
      const linked = ev.insights.find((i: any) => i.body.startsWith('Waiting'));
      expect(ev.links.filter((l: any) => l.fromId === linked.id && l.toId === note.id && l.relation === 'supports')).toHaveLength(1);

      // moving to another item keeps the insight active; a detail there is added to that card
      await tapOnMap(page, '[data-node="n3"]');
      await expect(page.getByTestId('node-panel')).toBeVisible();
      await expect(page.locator('.canvas-wrap.insight-ctx')).toHaveCount(1);
      await mark(page, 'role').click();
      await fab(page).click();
      await expect(fab(page)).toHaveAttribute('data-state', 'back');

      // 5. Back to insight: the same insight, open, with the details on their cards
      await fab(page).click();
      await expect(page.getByTestId('insights')).toBeVisible();
      await expect(fromMap).toHaveAttribute('data-expanded', 'true');
      const e3 = fromMap.locator('[data-item="e3"]');
      await expect(e3.locator('[data-detail="waiting"]')).toContainText('Waiting time');
      await expect(e3.locator(`[data-detail="note:${note.id}"]`)).toContainText('waits for a callback');
      await expect(fromMap.locator('[data-item="n3"] [data-detail="role"]')).toContainText('Role');
      await shot(page, `${label}-5-back-with-details`);

      // 6. after a reload the details are still on the right cards
      await page.reload();
      await expect(page.getByTestId('insights')).toBeVisible();
      await box(page, 'Waiting for capacity').getByTestId('insight-toggle').click();
      await expect(box(page, 'Waiting for capacity').locator('[data-item="e3"] [data-detail="waiting"]')).toBeVisible();
      await expect(box(page, 'Waiting for capacity').locator(`[data-item="e3"] [data-detail="note:${note.id}"]`)).toBeVisible();
      await expect(box(page, 'Waiting for capacity').locator('[data-item="n3"] [data-detail="role"]')).toBeVisible();
      await expect(box(page, 'Waiting for capacity').locator('[data-item="n3"] [data-detail="waiting"]')).toHaveCount(0);
    });

    test('Show on map frames the group; pending picks are dropped on exit; Escape, Back and drafts', async ({ page }) => {
      const id = await freshProject(page, `Show on map ${label}`);
      for (let i = 0; i < 7; i++) await page.request.post(`/api/projects/${id}/c/insights`, { data: { title: '', body: `Filler thought number ${i}, long enough to take some room on the page so that the list scrolls.` } });
      await page.request.post(`/api/projects/${id}/c/insights`, { data: { title: '', body: 'The oldest thought, about the coordinator and the placement.', modelLinks: ['n3', 'e3'] } });
      await reload(page);
      await page.getByTestId('nav-insights').click();
      const target = box(page, 'The oldest thought');
      await target.getByTestId('insight-toggle').click();
      // a draft edit and a new-insight draft, both left unsaved
      await target.getByTestId('insight-edit').click();
      await target.getByTestId('insight-body').fill('The oldest thought, revised but not saved yet.');
      await page.getByTestId('insight-new').click();
      await page.getByTestId('insight-new-text').fill('A half-written new thought');
      await target.scrollIntoViewIfNeeded();
      const before = await page.locator('.main').evaluate((el) => el.scrollTop);
      expect(before).toBeGreaterThan(100);

      // Show on map: the whole linked group framed, outlined, threaded; nothing selected
      await target.getByTestId('show-on-map').click();
      await expect(page.locator('.canvas-wrap.insight-ctx')).toHaveCount(1);
      await expect(page.locator('.picked')).toHaveCount(2);
      await expect(page.getByTestId('insight-thread')).toHaveCount(1);
      await expect(fab(page)).toHaveText('← Back to insight');
      const inView = async (sel: string) => { const g = (await page.getByTestId('graph').boundingBox())!, b = (await page.locator(sel).first().boundingBox())!; return b.x >= g.x - 1 && b.y >= g.y - 1 && b.x + b.width <= g.x + g.width + 1 && b.y + b.height <= g.y + g.height + 1; };
      expect(await inView('[data-node="n3"] rect.base')).toBe(true);
      expect(await inView('[data-label-for="e3"] rect')).toBe(true);
      // the connections' arrows are drawn above the thread
      const order = await page.getByTestId('graph').evaluate((svg) => { const kids = [...svg.children]; return { thread: kids.findIndex((k) => k.matches('[data-testid=insight-thread]')), edges: kids.findIndex((k) => !!k.querySelector('[data-edge]')) }; });
      expect(order.thread).toBeLessThan(order.edges);
      await shot(page, `${label}-6-show-on-map`);

      // a pending pick is dropped by Escape, which returns to the same open insight, drafts and scroll intact
      await tapOnMap(page, '[data-label-for="e3"]');
      await mark(page, 'active').click();
      await expect(fab(page)).toHaveAttribute('data-state', 'add');
      if (label !== 'desktop') { await page.keyboard.press('Escape'); await expect(page.locator('.right.open')).toHaveCount(0); await expect(page.locator('.canvas-wrap.insight-ctx')).toHaveCount(1); }
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('insights')).toBeVisible();
      await expect(target).toHaveAttribute('data-expanded', 'true');
      await expect(target.getByTestId('insight-body')).toHaveValue('The oldest thought, revised but not saved yet.');
      await expect(page.getByTestId('insight-new-text')).toHaveValue('A half-written new thought');
      await expect.poll(() => page.locator('.main').evaluate((el) => el.scrollTop)).toBeGreaterThan(before - 5);
      expect(Math.abs((await page.locator('.main').evaluate((el) => el.scrollTop)) - before)).toBeLessThan(5);
      expect((await evidence(page, id)).insights.find((i: any) => i.body.startsWith('The oldest')).focus).toEqual({});

      // re-entering starts with nothing pending
      await target.getByTestId('show-on-map').click();
      await tapOnMap(page, '[data-label-for="e3"]');
      await expect(page.locator('.right .pickable.picked')).toHaveCount(0);
      await expect(page.getByTestId('ctx-selected')).toHaveCount(0);
      await expect(fab(page)).toHaveAttribute('data-state', 'back');
      // the browser Back button also returns to the insight
      await page.goBack();
      await expect(page.getByTestId('insights')).toBeVisible();
      await expect(target).toHaveAttribute('data-expanded', 'true');
      await expect(page.getByTestId('graph')).toHaveCount(0);
      // and another section ends the mode without losing the open insight
      await target.getByTestId('show-on-map').click();
      await page.getByTestId('nav-notes').click();
      await page.getByTestId('nav-map').click();
      await expect(page.locator('.canvas-wrap.insight-ctx')).toHaveCount(0);
      await expect(fab(page)).toHaveCount(0);
      await page.getByTestId('nav-insights').click();
      await expect(target).toHaveAttribute('data-expanded', 'true');
      await expect(target.getByTestId('insight-body')).toHaveValue('The oldest thought, revised but not saved yet.');
      // a text-only insight can be shown on the map too, and gains its first card there
      const plain = box(page, 'Filler thought number 0');
      await plain.getByTestId('show-on-map').click();
      await expect(page.locator('.picked')).toHaveCount(0);
      await tapOnMap(page, '[data-node="n3"]');
      await mark(page, 'role').click();
      await fab(page).click();
      await expect(fab(page)).toHaveAttribute('data-state', 'back');
      await expect(page.locator('[data-node="n3"].picked')).toHaveCount(1);
      await fab(page).click();
      await expect(plain.locator('[data-item="n3"] [data-detail="role"]')).toBeVisible();
    });
  });
}
