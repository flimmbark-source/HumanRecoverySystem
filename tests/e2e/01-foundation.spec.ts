import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { api, boxes, expectCleanLabels, fixture, freshProject, login, open, openEdit, overlaps, saved, selectEdge, sentence } from './helpers';

test.describe('Start and persistence', () => {
  test('empty and synthetic projects persist independently across reload and sign-in', async ({ page }) => {
    await login(page);
    // empty project
    await page.getByTestId('new-project').click();
    await page.getByTestId('np-name').fill('Front desk requests');
    await page.getByTestId('np-start').fill('Visitor');
    await page.getByTestId('np-outcome').fill('Request resolved');
    await page.getByTestId('np-create').click();
    await expect(page.locator('[data-node]')).toHaveCount(2); // two meaningful nodes, quiet canvas
    const emptyUrl = page.url();
    await page.getByTestId('add-menu').click(); await page.getByTestId('add-node').click();
    await page.getByTestId('node-kind').selectOption('system'); await page.getByTestId('node-name').fill('Ticket queue'); await page.getByTestId('node-add').click();
    await expect(page.locator('[data-node]')).toHaveCount(3);
    await saved(page);
    // synthetic project
    await page.goto('/#/');
    await page.getByTestId('new-project').click(); await page.getByTestId('tpl-demo').check(); await page.getByTestId('np-name').fill('My synthetic copy'); await page.getByTestId('np-create').click();
    await expect(page.locator('[data-node]')).toHaveCount(6);
    const demoUrl = page.url();
    await selectEdge(page, 'e2'); await openEdit(page);
    await page.getByTestId('edit-label').fill('Screen application');
    await saved(page);
    // reload, then sign in again
    await page.reload();
    await expect(page.locator('[data-label-for="e2"] .edge-title')).toHaveText('Screen application');
    await expect(page.getByTestId('lens-title')).toHaveText('Screen application'); // selection survives the reload
    await page.goto('/#/'); await page.getByTestId('signout').click();
    await login(page);
    await page.goto(emptyUrl);
    await expect(page.locator('[data-node]')).toHaveCount(3);
    await expect(page.locator('[data-node] .name', { hasText: 'Ticket queue' })).toBeVisible();
    await page.goto(demoUrl);
    await expect(page.locator('[data-node]')).toHaveCount(6);
    await expect(page.locator('[data-label-for="e2"] .edge-title')).toHaveText('Screen application');
  });

  test('an interrupted save keeps a draft that can be recovered', async ({ page }) => {
    await freshProject(page, 'Interrupted save');
    await page.route('**/api/projects/*/branches/*/model', (route) => route.abort('connectionfailed'));
    await selectEdge(page, 'e3'); await openEdit(page);
    await page.getByTestId('edit-label').fill('Match to a placement');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'failed');
    await expect(page.getByTestId('save-failed-banner')).toContainText('kept in this browser');
    await page.unroute('**/api/projects/*/branches/*/model');
    await page.reload();
    await expect(page.locator('[data-label-for="e3"] .edge-title')).toHaveText('Find a placement'); // server never received it
    await expect(page.getByTestId('recovered-banner')).toBeVisible();
    await page.getByTestId('recover-restore').click();
    await expect(page.locator('[data-label-for="e3"] .edge-title')).toHaveText('Match to a placement');
    await saved(page);
    await page.reload();
    await expect(page.locator('[data-label-for="e3"] .edge-title')).toHaveText('Match to a placement');
    await expect(page.getByTestId('recovered-banner')).toHaveCount(0);
  });

  test('conflicting writes from two sessions are surfaced and recoverable', async ({ page, browser }) => {
    const id = await freshProject(page, 'Two sessions', 'owner@weave.test');
    const other = await (await browser.newContext()).newPage();
    await login(other, 'owner@weave.test'); await open(other, id);
    await selectEdge(page, 'e1'); await openEdit(page); await page.getByTestId('edit-label').fill('Send application'); await saved(page);
    await selectEdge(other, 'e4'); await openEdit(other); await other.getByTestId('edit-label').fill('Notify volunteer');
    await expect(other.getByTestId('conflict-banner')).toBeVisible();
    await expect(other.getByTestId('conflict-banner')).toContainText('nothing was overwritten');
    expect((await api(page, `/projects/${id}/branches/baseline`)).revision.model.edges.find((e: any) => e.id === 'e1').label).toBe('Send application');
    // keep mine: saved on top, the other version stays in history
    await other.getByTestId('conflict-keep').click();
    await saved(other);
    const head = (await api(page, `/projects/${id}/branches/baseline`)).revision;
    expect(head.model.edges.find((e: any) => e.id === 'e4').label).toBe('Notify volunteer');
    const history = (await api(page, `/projects/${id}/branches/baseline/revisions`)).revisions;
    expect(history.length).toBe(3);
    // and the alternative path: use theirs
    await page.reload();
    await selectEdge(page, 'e1'); await openEdit(page);
    await other.getByTestId('clear-selection').click();
    await selectEdge(other, 'e2'); await openEdit(other); await other.getByTestId('edit-label').fill('Triage'); await saved(other);
    await page.getByTestId('edit-label').fill('Mine, to be dropped');
    await expect(page.getByTestId('conflict-banner')).toBeVisible();
    await page.getByTestId('conflict-theirs').click();
    await expect(page.locator('[data-label-for="e2"] .edge-title')).toHaveText('Triage');
    await saved(page);
    await other.context().close();
  });
});

test.describe('Import and recovery', () => {
  test('imports the v0.7 fixture with a preview, decisions and the expected totals', async ({ page }, info) => {
    await login(page);
    await page.getByTestId('import-project').click();
    await page.getByTestId('import-file').setInputFiles('reference/handoff/fixtures/synthetic-volunteer-placement-v0.7.json');
    await expect(page.getByTestId('import-summary')).toContainText('6 nodes · 6 connections · 3 notes · 2 note links');
    await expect(page.locator('[data-testid=import-decisions] [data-kind="unattached-timing"][data-record="e6"]')).toBeVisible();
    await expect(page.locator('[data-testid=import-decisions] [data-kind="defaulted-zero"]').first()).toBeVisible();
    await page.getByTestId('import-name').fill('UI import of v0.7');
    await page.getByTestId('import-run').click();
    await page.getByTestId('import-open').click();
    await expect(page.locator('[data-node]')).toHaveCount(6);
    await expect(page.locator('[data-edge]')).toHaveCount(6);
    await expect(page.locator('[data-pin-for]')).toHaveCount(3); // three linked notes pinned on e2, e3, e5
    await expect(page.getByTestId('stat-percase')).toHaveText('63 min');
    await expect(page.getByTestId('stat-monthly')).toHaveText('84 h');
    await expect(page.getByTestId('unverified-note')).toContainText('unverified sample inputs');
    await page.getByTestId('mode-timeline').click();
    await expect(page.getByTestId('route-active')).toHaveText('51');
    await expect(page.getByTestId('route-waiting')).toHaveText('120');
    await expect(page.getByTestId('route-elapsed')).toHaveText('171');
    await expect(page.locator('[data-testid=route-flags] [data-code="side-links"]')).toContainText('Check availability'); // e5 counted in workload, off this route

    // malformed files are rejected whole, with field-level errors
    const bad = fixture(); bad.base.edges[0].to = 'n404'; bad.base.nodes[2].id = 'n1'; bad.base.activities[1].minutes = 'lots';
    const path = info.outputPath('bad.json'); writeFileSync(path, JSON.stringify(bad));
    await page.goto('/#/');
    await expect(page.locator('.projectcard').first()).toBeVisible();
    const before = await page.locator('.projectcard').count();
    await page.getByTestId('import-project').click();
    await page.getByTestId('import-file').setInputFiles(path);
    await expect(page.getByTestId('import-issues')).toContainText('Nothing was changed');
    await expect(page.getByTestId('import-issues')).toContainText('base.nodes.2.id');
    await expect(page.getByTestId('import-issues')).toContainText('destination "n404" does not exist');
    await expect(page.getByTestId('import-issues')).toContainText('not a finite number');
    await expect(page.getByTestId('import-run')).toHaveCount(0);
    const notJson = info.outputPath('broken.json'); writeFileSync(notJson, '{"format": ');
    await page.getByTestId('import-file').setInputFiles(notJson);
    await expect(page.getByTestId('import-error')).toContainText('not valid JSON');
    await page.reload();
    await expect(page.locator('.projectcard').first()).toBeVisible();
    await expect(page.locator('.projectcard')).toHaveCount(before);
  });
});

test.describe('Map and spacing', () => {
  for (const [w, h] of [[1440, 900], [1140, 800], [780, 900], [390, 780], [360, 760]] as const) {
    test(`layout holds at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshProject(page, `Spacing ${w}`);
      await page.getByRole('button', { name: 'Fit the whole map' }).click();
      const { labels, nodes } = await expectCleanLabels(page);
      expect(labels).toHaveLength(6); expect(nodes).toHaveLength(6);
      // external scope is marked locally, with a text label, on exactly the two external nodes
      await expect(page.locator('[data-scope="external"]')).toHaveCount(2);
      await expect(page.locator('[data-node="n1"] .scope-tag text')).toHaveText('EXTERNAL');
      await expect(page.locator('[data-node="n4"] .scope-tag text')).toHaveText('EXTERNAL');
      expect(await page.locator('[data-node="n1"] .base').getAttribute('stroke-dasharray')).toBeTruthy();
      expect(await page.locator('[data-node="n2"] .base').getAttribute('stroke-dasharray')).toBeNull();
      // no oversized dashed frame around the graph
      const graph = (await page.getByTestId('graph').boundingBox())!;
      const dashed = await page.locator('svg.graph rect[stroke-dasharray]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
      for (const dw of dashed) expect(dw).toBeLessThan(graph.width * 0.5);
      // controls are fully inside the viewport and not under the inspector
      const view = page.viewportSize()!;
      for (const sel of ['.canvas-actions', '.canvas-tools', '.canvas-legend', '[data-testid=add-menu]', '[data-testid=branch-select]']) {
        const b = (await page.locator(sel).first().boundingBox())!;
        expect(b.x, sel).toBeGreaterThanOrEqual(0); expect(b.x + b.width, sel).toBeLessThanOrEqual(view.width + 0.5); expect(b.y + b.height, sel).toBeLessThanOrEqual(view.height + 0.5);
      }
      const insp = await page.getByTestId('inspector').boundingBox();
      const actions = (await page.locator('.canvas-actions').boundingBox())!;
      if (w > 990) expect(overlaps(actions, insp!)).toBe(false); else expect(insp!.x >= view.width - 1 || insp!.y >= view.height - 1).toBe(true); // drawer closed: map fully usable
      const legend = page.getByTestId('legend');
      const toggle = legend.getByRole('button');
      if (w <= 720) await toggle.click();
      for (const t of ['flow', 'info', 'dependency', 'authority', 'association']) await expect(page.locator(`[data-legend="${t}"]`)).toBeVisible();
      const expanded = (await legend.boundingBox())!;
      await expect(toggle).toHaveAccessibleName('Collapse legend');
      await toggle.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(legend.getByRole('list')).toHaveCount(0);
      expect((await legend.boundingBox())!.height).toBeLessThan(expanded.height);
      if (w === 1440) {
        await page.reload();
        await expect(toggle).toHaveAccessibleName('Expand legend');
      }
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
  }

  test('connection labels keep their side during a node drag and settle after release', async ({ page }) => {
    await freshProject(page, 'Steady connection labels');
    const node = page.locator('[data-node="n4"]');
    const fixedLabel = page.locator('[data-label-for="e2"]');
    const originalNode = await node.getAttribute('transform');
    const originalLabel = await fixedLabel.getAttribute('transform');
    const offsets = () => page.locator('[data-edge="e5"], [data-edge="e6"]').evaluateAll((edges) => edges.map((edge) => {
      const path = edge.querySelector('.edgepath')!.getAttribute('d')!.split(' ');
      const [, ax, ay, , cx, cy, bx, by] = path.map(Number);
      const label = (edge.querySelector('.edgeLabel') as SVGGElement).transform.baseVal.getItem(0).matrix;
      const dx = label.e - (ax + 2 * cx + bx) / 4;
      const dy = label.f - (ay + 2 * cy + by) / 4;
      const angle = Math.atan2(by - ay, bx - ax);
      return [dx * Math.cos(angle) + dy * Math.sin(angle), -dx * Math.sin(angle) + dy * Math.cos(angle)];
    }));
    const before = await offsets();
    const rect = (await node.locator('.base').boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    const graph = page.getByTestId('graph');
    for (const [x, y] of [[1050, 165], [945, 535], [485, 470]]) {
      const screen = await graph.evaluate((svg, [x, y]) => {
        const point = new DOMPoint(x, y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
        return { x: point.x, y: point.y };
      }, [x, y]);
      await page.mouse.move(screen.x, screen.y, { steps: 4 });
      await expect(node).not.toHaveAttribute('transform', originalNode!);
      const current = await offsets();
      for (let i = 0; i < before.length; i++) {
        expect(current[i][0]).toBeCloseTo(before[i][0], 4);
        expect(current[i][1]).toBeCloseTo(before[i][1], 4);
      }
      await expect(fixedLabel).toHaveAttribute('transform', originalLabel!);
    }
    const labelBox = (await fixedLabel.locator('rect').boundingBox())!;
    await page.mouse.move(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2, { steps: 4 });
    await expect(fixedLabel).toHaveAttribute('transform', originalLabel!);
    await page.mouse.up();
    await expect(fixedLabel).not.toHaveAttribute('transform', originalLabel!);
    await expectCleanLabels(page);
  });

  test('a connection label can be dragged, undone and saved with its branch', async ({ page }) => {
    const id = await freshProject(page, 'Manual label placement');
    const graph = page.getByTestId('graph');
    const label = page.locator('[data-label-for="e2"]');
    const original = await label.getAttribute('transform');
    const revisions = `/projects/${id}/branches/baseline/revisions`;
    const branch = `/projects/${id}/branches/baseline`;
    const before = (await api(page, revisions)).revisions.length;

    const pickUp = await label.evaluate((el) => {
      const p = new DOMPoint().matrixTransform((el as SVGGElement).getScreenCTM()!);
      return { x: p.x, y: p.y };
    });
    const drop = await graph.evaluate((el) => {
      const p = new DOMPoint(545, 560).matrixTransform((el as SVGSVGElement).getScreenCTM()!);
      return { x: p.x, y: p.y };
    });
    await page.mouse.move(pickUp.x, pickUp.y);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 6 });
    await expect(label).not.toHaveAttribute('transform', original!);
    expect((await api(page, branch)).branch.layout.e2).toBeUndefined();
    await page.mouse.up();
    await expect(page.getByTestId('edge-lens')).toHaveCount(0);
    const dropped = await label.evaluate((el) => {
      const p = (el as SVGGElement).transform.baseVal.getItem(0).matrix;
      return { x: p.e, y: p.f };
    });
    expect(Math.abs(dropped.x - 545)).toBeLessThan(3);
    expect(Math.abs(dropped.y - 560)).toBeLessThan(3);
    await expectCleanLabels(page);
    await expect.poll(async () => (await api(page, branch)).branch.layout.e2).toBeDefined();

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(label).toHaveAttribute('transform', original!);
    await expect.poll(async () => (await api(page, branch)).branch.layout.e2).toBeUndefined();
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => (await api(page, branch)).branch.layout.e2).toBeDefined();
    const moved = await label.getAttribute('transform');
    await page.reload();
    await expect(label).toHaveAttribute('transform', moved!);
    await label.click();
    await expect(page.getByTestId('lens-title')).toHaveText('Triage application');
    expect((await api(page, revisions)).revisions.length).toBe(before);
  });

  test('long labels, dense links, dragging near a node, collision fallback and undoing Tidy', async ({ page }) => {
    const id = await freshProject(page, 'Dense map');
    // long label + every relationship type between the same few nodes
    await selectEdge(page, 'e2'); await openEdit(page);
    await page.getByTestId('edit-label').fill('Triage the application and decide whether it can proceed to placement today');
    const connect = async (from: string, to: string, type: string, label: string) => {
      await page.getByTestId('add-menu').click(); await page.getByTestId('add-connection').click();
      await page.getByTestId('connect-from').selectOption({ label: from }); await page.getByTestId('connect-to').selectOption({ label: to });
      await page.getByTestId('connect-type').selectOption(type); await page.getByTestId('connect-label').fill(label); await page.getByTestId('connect-add').click();
    };
    await connect('Coordinator', 'Application form', 'info', 'Ask for missing details');
    await connect('Program lead', 'Coordinator', 'authority', 'Approves exceptions');
    await connect('Coordinator', 'Placement board', 'association', 'Keeps up to date');
    await connect('Program lead', 'Placement board', 'info', 'Posts new capacity');
    await connect('Coordinator', 'Placement confirmed', 'dependency', 'Needs sign-off');
    await saved(page);
    await page.getByRole('button', { name: 'Fit the whole map' }).click();
    await expect(page.locator('[data-edge]')).toHaveCount(11);
    await expectCleanLabels(page);
    // every type is distinguishable without colour: dash pattern, marker and a text sub-label
    const style = async (type: string) => page.locator(`[data-edge][data-type="${type}"] .edgepath`).first().evaluate((el) => [el.getAttribute('stroke-dasharray') ?? '', el.getAttribute('marker-end') ?? '', el.getAttribute('marker-start') ?? ''].join('|'));
    const styles = await Promise.all(['flow', 'info', 'dependency', 'authority', 'association'].map(style));
    expect(new Set(styles).size).toBe(5);
    await expect(page.locator('[data-edge][data-type="authority"] .edge-sub')).toHaveText('responsibility');
    await expect(page.locator('[data-edge][data-type="dependency"] .edge-sub').first()).toHaveText('prerequisite');
    await expect(page.locator('[data-label-for="e2"] title')).toHaveText(/Triage the application and decide/); // full text available, truncated on the canvas

    // drag Program lead right on top of Coordinator: spacing is preserved
    const a = (await page.locator('[data-node="n4"] .base').boundingBox())!, b = (await page.locator('[data-node="n3"] .base').boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 10, b.y + b.height / 2 + 6, { steps: 8 }); await page.mouse.up();
    const nodes = await boxes(page, '.nodeSvg .base');
    for (const n of nodes) for (const o of nodes) if (n.id < o.id) expect(overlaps(n, o), `${n.id} vs ${o.id}`).toBe(false);
    await expectCleanLabels(page);
    await expect.poll(async () => (await api(page, `/projects/${id}/branches/baseline`)).branch.layout.n4).not.toEqual({ x: 854, y: 95 });
    const moved = (await api(page, `/projects/${id}/branches/baseline`)).branch;
    // moving a node is a layout change, never an operational revision
    const revsBefore = (await api(page, `/projects/${id}/branches/baseline/revisions`)).revisions.length;
    await page.getByTestId('tidy').click();
    await expectCleanLabels(page);
    await expect.poll(async () => (await api(page, `/projects/${id}/branches/baseline`)).branch.layout.n4.y).not.toBe(moved.layout.n4.y);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await api(page, `/projects/${id}/branches/baseline`)).branch.layout.n4).toEqual(moved.layout.n4);
    expect((await api(page, `/projects/${id}/branches/baseline/revisions`)).revisions.length).toBe(revsBefore);
  });
});

test.describe('Connection hierarchy', () => {
  test('Triage application reads in layers and the sentence follows the structured fields everywhere', async ({ page }) => {
    const id = await freshProject(page, 'Connection hierarchy');
    await selectEdge(page, 'e2');
    await expect(page.getByTestId('lens-type')).toHaveText('Work flow');
    await expect(page.getByTestId('lens-route')).toContainText('Application form'); await expect(page.getByTestId('lens-route')).toContainText('Coordinator');
    await expect(sentence(page)).toHaveText('The application moves from Application form to Coordinator, who reviews it and changes its state from submitted to ready for placement.');
    await expect(sentence(page).locator('[data-token="actor"]')).toHaveText(['Application form', 'Coordinator']);
    await expect(sentence(page).locator('[data-token="action"]')).toHaveText('reviews');
    await expect(sentence(page).locator('[data-token="state"]')).toHaveText(['submitted', 'ready for placement']);
    await expect(page.getByTestId('iao-performer')).toHaveText('Coordinator');
    await expect(page.getByTestId('iao')).toContainText('the receiver');
    await expect(page.getByTestId('iao-in-state')).toHaveText('submitted'); await expect(page.getByTestId('iao-out-state')).toHaveText('ready for placement');
    // Performance, Evidence and Edit are closed until asked for
    for (const d of ['disc-performance', 'disc-evidence', 'disc-edit']) expect(await page.getByTestId(d).evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    await expect(page.getByTestId('perf-active')).toHaveCount(0); await expect(page.getByTestId('edit-action')).toHaveCount(0);
    await page.getByTestId('disc-performance').locator('summary').click();
    await expect(page.getByTestId('perf-active')).toHaveText('16 min');
    await page.getByTestId('disc-evidence').locator('summary').click();
    await expect(page.getByTestId('disc-evidence').locator('[data-note="t1"]')).toBeVisible();

    await openEdit(page);
    await page.getByTestId('edit-action').selectOption('approve');
    await page.getByTestId('edit-result').fill('Approved application');
    await page.getByTestId('edit-inputState').fill('screened');
    await page.getByTestId('edit-outputState').fill('approved');
    const changed = 'The application moves from Application form to Coordinator, who approves it and changes its state from screened to approved.';
    await expect(sentence(page)).toHaveText(changed);
    await expect(page.getByTestId('preview')).toContainText(changed);
    await saved(page);
    await page.getByTestId('mode-timeline').click(); await page.getByTestId('play-next').click();
    await expect(page.getByTestId('play-step-label')).toHaveText('Triage application');
    await expect(page.getByTestId('play-sentence')).toHaveText(changed);
    await expect(page.getByTestId('play-state')).toHaveText('screened → approved');
    const brief = await api(page, `/projects/${id}/export/brief.json`);
    expect(brief.currentState.handoffs.find((h: any) => h.label === 'Triage application').sentence).toBe(changed);
    const exported = await api(page, `/projects/${id}/export/workspace.json`);
    const model = exported.revisions.find((r: any) => r.id === exported.branches[0].headRevisionId).model;
    expect(model.activities.find((a: any) => a.edgeId === 'e2')).toMatchObject({ actionCode: 'approve', performerId: 'n3' });

    // performer: sender, third party, unknown
    await page.getByTestId('mode-structure').click(); await openEdit(page);
    await page.getByTestId('edit-performer').selectOption('n2');
    await expect(page.getByTestId('iao')).toContainText('the sender');
    await expect(sentence(page)).toHaveText('The application moves from Application form to Coordinator. Application form approves the application and changes its state from screened to approved.');
    await page.getByTestId('edit-performer').selectOption('n4');
    await expect(page.getByTestId('iao')).toContainText('a third party');
    await expect(sentence(page)).toContainText('Program lead approves the application');
    await page.getByTestId('edit-performer').selectOption('');
    await expect(page.getByTestId('iao-performer')).toHaveText('Performer not identified');
    await expect(sentence(page)).toContainText('is not identified');
    await expect(sentence(page).locator('[data-token="unknown"]')).toHaveText('not identified');
    await page.getByTestId('gaps-toggle').click();
    await expect(page.getByTestId('gaps')).toContainText('Activity performer not identified');
    await saved(page);
    await page.reload(); // an unknown performer stays unknown; direction never fills it in
    await expect(page.getByTestId('iao-performer')).toHaveText('Performer not identified');
  });
});
