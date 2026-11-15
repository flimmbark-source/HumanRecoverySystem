import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

export const PASSWORD = 'weave-demo-1';
export const fixture = () => JSON.parse(readFileSync('reference/handoff/fixtures/synthetic-volunteer-placement-v0.7.json', 'utf8'));

export async function login(page: Page, email = 'researcher@weave.test') {
  await page.goto('/');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('projects')).toBeVisible();
}
/** Imports the bundled v0.7 fixture into a fresh project through the API and opens it. */
export async function freshProject(page: Page, name: string, email = 'researcher@weave.test'): Promise<string> {
  await login(page, email);
  const r = await page.request.post('/api/import', { data: { data: fixture(), name } });
  expect(r.ok()).toBeTruthy();
  const { id } = await r.json();
  await open(page, id);
  return id;
}
export async function open(page: Page, id: string) {
  await page.goto(`/#/p/${id}`);
  await expect(page.getByTestId('graph')).toBeVisible();
  await expect(page.locator('[data-node]').first()).toBeVisible();
}
export const saved = (page: Page) => expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
export async function selectEdge(page: Page, id: string) {
  await page.locator(`[data-label-for="${id}"]`).click();
  await expect(page.getByTestId('edge-lens')).toBeVisible();
}
export async function openEdit(page: Page) {
  const d = page.getByTestId('disc-edit');
  if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator('summary').click();
  await expect(page.getByTestId('preview')).toBeVisible();
}
export const sentence = (page: Page) => page.getByTestId('sentence');
export const api = async (page: Page, path: string) => (await page.request.get(`/api${path}`)).json();

export interface Box { x: number; y: number; width: number; height: number }
export const overlaps = (a: Box, b: Box, pad = 0) => a.x < b.x + b.width - pad && b.x < a.x + a.width - pad && a.y < b.y + b.height - pad && b.y < a.y + a.height - pad;
export async function boxes(page: Page, selector: string): Promise<(Box & { id: string })[]> {
  return page.locator(selector).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); const host = el.closest('[data-node],[data-label-for],[data-pin-for]') as HTMLElement | null; return { x: r.x, y: r.y, width: r.width, height: r.height, id: host?.dataset.node ?? host?.dataset.labelFor ?? host?.dataset.pinFor ?? '' }; }));
}
/** Asserts that no visible edge label covers a node, another label, or a canvas control. */
export async function expectCleanLabels(page: Page) {
  const labels = await boxes(page, '.edgeLabel rect'), nodes = await boxes(page, '.nodeSvg .base'), tags = await boxes(page, '.scope-tag rect');
  const problems: string[] = [];
  for (const l of labels) {
    for (const n of [...nodes, ...tags]) if (overlaps(l, n)) problems.push(`label ${l.id} covers node ${n.id}`);
    for (const o of labels) if (o.id < l.id && overlaps(l, o)) problems.push(`label ${l.id} covers label ${o.id}`);
  }
  expect(problems).toEqual([]);
  return { labels, nodes };
}
