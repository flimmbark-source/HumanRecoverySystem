import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { api, freshProject } from './helpers';

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };
const NOTES = readFileSync('tests/fixtures/fieldnotes-mixed.txt', 'utf8');
const evidence = (page: Page, id: string) => api(page, `/projects/${id}/evidence`);

async function docx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  const body = paragraphs.map((p) => (p.startsWith('- ') ? `<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${p.slice(2)}</w:t></w:r></w:p>` : `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, '&amp;')}</w:t></w:r></w:p>`)).join('');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
  test.describe(`archive at ${label} width`, () => {
    test.use({ viewport });

    test('pasted field notes: names replaced, split on the device, reviewed in the text, saved with their source and place', async ({ page }) => {
      const id = await freshProject(page, `Archive ${label}`);
      await page.getByTestId('nav-notes').click();
      await page.getByTestId('archive-add').click();
      await page.getByTestId('import-text').fill(NOTES);
      await page.getByTestId('import-name').fill('Coordinator interview');
      await page.getByTestId('import-source').selectOption('new:main');
      await page.getByTestId('import-new-source').fill('Interview 07');
      // the names found are offered for replacement
      const names = page.getByTestId('names-panel');
      await expect(names.locator('[data-name="Dana"]')).toBeVisible();
      await names.locator('[data-name="Dana"] [data-testid=name-with]').fill('the coordinator');
      await names.locator('[data-name="Sam"] [data-testid=name-with]').fill('the program lead');
      await shot(page, `${label}-a1-input`);
      await page.getByTestId('split-phone').click();

      // review: proposals marked in the text, with places
      await expect(page.getByTestId('import-review')).toBeVisible();
      await expect(page.getByTestId('fn-doc')).not.toContainText('Dana');
      await expect(page.getByTestId('fn-doc')).toContainText('The coordinator checks three places');
      const spans = page.getByTestId('fn-span');
      const n = await spans.count();
      expect(n).toBeGreaterThan(8);
      await shot(page, `${label}-a2-review`);
      // an interpretation is flagged for checking
      await expect(page.locator('.fn-span.k-hypothesis.look').first()).toBeVisible();
      // open one, place it, leave another out
      await page.locator('.fn-span', { hasText: 'checks three places' }).click();
      const editor = page.getByTestId('fn-editor');
      await expect(editor).toBeVisible();
      await editor.getByTestId('fn-place').selectOption({ label: 'Coordinator' });
      await expect(page.locator('.fn-span', { hasText: 'checks three places' }).locator('.fn-place')).toHaveText('→ Coordinator');
      await shot(page, `${label}-a3-editor`);
      await editor.getByTestId('fn-next').click();
      await expect(editor).toContainText('Note 2 of');
      // on a phone the sheet covers the lower part of the text: close it to tap another passage
      await page.keyboard.press('Escape');
      await page.locator('.fn-span', { hasText: 'The second call went to voicemail' }).click();
      await editor.getByTestId('fn-include').click();
      await expect(page.locator('.fn-span.out', { hasText: 'voicemail' })).toBeVisible();
      // join two sentences into one note
      await page.keyboard.press('Escape');
      await page.locator('.fn-span', { hasText: 'She parked it and moved on' }).click();
      await editor.getByRole('button', { name: 'Join with previous' }).click();
      await expect(page.locator('.fn-span', { hasText: 'She parked it' })).toContainText('voicemail');
      await page.keyboard.press('Escape');
      await expect(editor).toHaveCount(0);
      // the review survives a reload
      await page.reload();
      await page.getByTestId('nav-notes').click();
      await expect(page.getByTestId('import-review')).toBeVisible();
      const included = Number((await page.getByTestId('review-count').locator('b').textContent())!);
      await page.getByTestId('review-save').click();
      await expect(page.getByTestId('toast')).toContainText(`Saved ${included} note`);

      const ev = await evidence(page, id);
      const imp = ev.imports.find((x: any) => x.name === 'Coordinator interview');
      expect(imp).toMatchObject({ docType: 'notes', method: 'phone', noteCount: included });
      expect(imp.text).not.toContain('Dana');
      const mine = ev.notes.filter((x: any) => x.origin?.importId === imp.id);
      expect(mine).toHaveLength(included);
      const src = ev.sources.find((s: any) => s.anonId === 'Interview 07');
      expect(mine.every((x: any) => x.sourceId === src.id && x.group === 'Coordinator interview')).toBe(true);
      const placed = mine.find((x: any) => x.text.includes('checks three places'));
      expect(placed).toMatchObject({ targetId: 'n3', certainty: null, kind: 'observation' });
      expect(imp.text.slice(placed.origin.start, placed.origin.end)).toBe(placed.text);
      expect(mine.find((x: any) => x.text.startsWith('I think'))).toMatchObject({ kind: 'hypothesis', certainty: 'inferred' });
      expect(mine.some((x: any) => x.text.includes('voicemail') && x.text.includes('parked'))).toBe(true);

      // the archive lists it, and a note shows the passage it came from
      await expect(page.getByTestId('archive-item').filter({ hasText: 'Coordinator interview' })).toBeVisible();
      const card = page.locator(`[data-note="${placed.id}"]`);
      await card.getByTestId('note-context-toggle').click();
      await expect(card.getByTestId('note-context')).toContainText('From Coordinator interview');
      await expect(card.getByTestId('note-context').locator('mark')).toHaveText(placed.text);
      await shot(page, `${label}-a4-saved`);

      // importing the same notes again marks what is already saved
      await page.getByTestId('archive-add').click();
      await page.getByTestId('import-text').fill(NOTES);
      await page.getByTestId('split-phone').click();
      await expect(page.locator('.fn-span.out .fn-place', { hasText: 'already saved' }).first()).toBeVisible();
      await page.getByTestId('review-back').click({ trial: true });
    });
  });
}

test('a Word file is read on the device; a PDF needs the project setting, then Claude (test splitter) reads it', async ({ page }) => {
  const id = await freshProject(page, 'Archive files');
  await page.getByTestId('nav-notes').click();
  await page.getByTestId('archive-add').click();
  // .docx: read without a library, list items kept as bullets
  const word = await docx(['Placement procedure v3', '- Program leads update the capacity board every Friday.', '- Coordinators must confirm capacity before matching.']);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-file').click();
  await (await chooser).setFiles({ name: 'procedure.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: word });
  await expect(page.getByTestId('import-text')).toHaveValue(/- Program leads update the capacity board every Friday\./);
  await expect(page.getByTestId('import-name')).toHaveValue('procedure');
  await page.getByTestId('type-document').click();
  await page.getByTestId('import-link').fill('https://drive.example.com/procedure');
  // Claude (the test splitter on this server), after the consent dialog
  await page.getByTestId('split-claude').click();
  await expect(page.getByRole('dialog', { name: 'Send to Claude?' })).toContainText('characters of the document');
  await page.getByTestId('claude-send').click();
  await expect(page.getByTestId('import-review')).toContainText('Split by the test splitter');
  await page.getByTestId('review-save').click();
  await expect(page.getByTestId('toast')).toContainText('Saved 2 notes');
  let ev = await evidence(page, id);
  const proc = ev.imports.find((x: any) => x.name === 'procedure');
  expect(proc).toMatchObject({ docType: 'document', method: 'fixture', file: { name: 'procedure.docx', link: 'https://drive.example.com/procedure', ref: '' } });
  expect(ev.notes.filter((x: any) => x.origin?.importId === proc.id).every((x: any) => x.certainty === 'documented')).toBe(true);

  // a PDF: off by default for the project
  const pdf = Buffer.from('%PDF-1.4\n% test file\n');
  await page.getByTestId('archive-add').click();
  let pick = page.waitForEvent('filechooser');
  await page.getByTestId('import-file').click();
  await (await pick).setFiles({ name: 'board-photo.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByTestId('files-off')).toBeVisible();
  // kept for reference only, without notes
  await page.getByText('Keep it for reference only, without notes').click();
  await page.getByTestId('import-about').fill('Photo of the capacity board, 14 March.');
  await page.getByTestId('keep-reference').click();
  await expect(page.getByTestId('archive-item').filter({ hasText: 'board-photo' })).toBeVisible();
  // the server refuses a file while the setting is off, whatever the page does
  const refused = await page.request.post(`/api/projects/${id}/fieldnotes/split`, { data: { file: { name: 'x.pdf', mime: 'application/pdf', data: pdf.toString('base64') } } });
  expect(refused.status()).toBe(403);

  // turned on in Project settings, the PDF is read and split
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('ai-files').locator('input').click();
  await expect(page.getByTestId('ai-files').locator('input')).toBeChecked();
  await expect(page.getByTestId('toast')).toContainText('can be sent to Claude');
  await page.getByTestId('nav-notes').click();
  await page.getByTestId('archive-add').click();
  pick = page.waitForEvent('filechooser');
  await page.getByTestId('import-file').click();
  await (await pick).setFiles({ name: 'board-photo.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByTestId('read-claude').click();
  await expect(page.getByRole('dialog', { name: 'Send to Claude?' })).toContainText('will be sent as it is');
  await page.getByTestId('claude-send').click();
  await expect(page.getByTestId('fn-doc')).toContainText('Test transcript of board-photo.pdf');
  await page.getByTestId('review-save').click();
  await expect(page.getByTestId('toast')).toContainText('Saved 1 note');
  ev = await evidence(page, id);
  const read = ev.imports.filter((x: any) => x.file?.name === 'board-photo.pdf');
  expect(read).toHaveLength(2);
  expect(read.find((x: any) => x.noteCount === 0).text).toBe('Photo of the capacity board, 14 March.');
});
