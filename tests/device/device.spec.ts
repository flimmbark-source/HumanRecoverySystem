// The page of the Android app in a phone-sized Chromium. The API and its database run in a Web Worker,
// and each test starts with an empty database (a new browser context has empty storage).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function demoProject(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('projects')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('new-project').click();
  await page.getByTestId('tpl-demo').check();
  await page.getByTestId('np-create').click();
  await expect(page.getByTestId('graph')).toBeVisible();
}

test('starts without a sign-in, keeps work across a reload and exports files', async ({ page }) => {
  await demoProject(page);
  await expect(page.getByTestId('signout')).toHaveCount(0);
  await page.getByTestId('fab-note').click();
  await page.locator('.modal textarea').first().fill('Captured on the phone.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);

  await page.reload();
  await page.getByTestId('nav-notes').click();
  await expect(page.getByText('Captured on the phone.').first()).toBeVisible();

  await page.getByTestId('nav-report').click();
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-brief').click()]);
  expect(pdf.suggestedFilename()).toMatch(/-decision-brief\.pdf$/);
  expect(readFileSync(await pdf.path()).subarray(0, 5).toString()).toBe('%PDF-');
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  expect(JSON.parse(readFileSync(await json.path(), 'utf8')).notes.map((n: { text: string }) => n.text)).toContain('Captured on the phone.');
});

test('hands exports and printing to the Android app', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { saved: { name: string; type: string; text: string }[]; printed: number; WeaveAndroid: unknown };
    w.saved = [];
    w.printed = 0;
    w.WeaveAndroid = {
      saveFile: (name: string, type: string, base64: string) => w.saved.push({ name, type, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))) }),
      print: () => { w.printed++; },
    };
  });
  await demoProject(page);
  await page.getByTestId('nav-report').click();
  await page.getByTestId('export-csv').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { saved: unknown[] }).saved.length)).toBe(1);
  const saved = await page.evaluate(() => (window as unknown as { saved: { name: string; type: string; text: string }[] }).saved[0]);
  expect(saved.name).toMatch(/-opportunities\.csv$/);
  expect(saved.type).toBe('text/csv; charset=utf-8');
  expect(saved.text.startsWith('﻿Rank,Opportunity')).toBe(true);
  await page.getByRole('button', { name: 'Print this preview' }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
});

test('imports a v0.7 prototype export from a file', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('projects')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('import-project').click();
  await page.getByTestId('import-file').setInputFiles('reference/handoff/fixtures/synthetic-volunteer-placement-v0.7.json');
  await expect(page.getByTestId('import-summary')).toContainText('6 nodes · 6 connections · 3 notes · 2 note links · 0 scenarios');
  await page.getByTestId('import-name').fill('Imported on the phone');
  await page.getByTestId('import-run').click();
  await page.getByTestId('import-open').click();
  await expect(page.getByTestId('graph')).toBeVisible();
});
