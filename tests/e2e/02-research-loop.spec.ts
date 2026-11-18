import { expect, test, type Page } from '@playwright/test';
import { api, editInsight, freshProject, newInsight, saved, selectEdge } from './helpers';

async function startSession(page: Page, anon: string, type = 'interview', role = 'Coordinator', group = 'Placement fieldwork') {
  await page.getByTestId('session-button').click();
  await page.getByTestId('session-anon').fill(anon); await page.getByTestId('session-type').selectOption(type);
  await page.getByTestId('session-role').fill(role); await page.getByTestId('session-group').fill(group);
  await page.getByTestId('session-start').click();
  await expect(page.getByTestId('session-button')).toContainText(anon);
}
const capture = (page: Page, scope = page.locator('body')) => ({ text: scope.getByTestId('capture-text'), save: scope.getByTestId('capture-save') });

test.describe('Fieldwork and synthesis', () => {
  test('capture on a selected connection, capture unassigned, link to an insight, then opportunity and scenario', async ({ page }) => {
    const id = await freshProject(page, 'Fieldwork loop');
    await startSession(page, 'Interview 04');
    // 1. note on the selected connection: select, open Evidence, type, Ctrl+Enter. Source is inherited.
    await selectEdge(page, 'e3');
    await page.getByTestId('disc-evidence').locator('summary').click();
    const ev = page.getByTestId('disc-evidence');
    await expect(ev.getByTestId('capture-session')).toContainText('Interview 04');
    await ev.getByTestId('capture-text').fill('Coordinator checks three places before proposing a placement.');
    await ev.getByTestId('capture-text').press('Control+Enter');
    await expect(ev.locator('.sticky', { hasText: 'checks three places' })).toBeVisible();
    await expect(ev.locator('.sticky', { hasText: 'checks three places' }).locator('.sticky-source')).toHaveText('Interview 04');
    await expect(page.getByTestId('lens-title')).toHaveText('Find a placement'); // place on the map is not lost
    await expect(page.locator('[data-pin-for="e3"] text')).toHaveText('2');

    // 2. a note without a target, attached later
    await page.getByTestId('clear-selection').click();
    await page.keyboard.press('n');
    await page.getByTestId('capture-text').fill('Program leads say they answer capacity questions the same day.');
    await page.getByTestId('capture-save').click();
    await page.getByTestId('nav-notes').click();
    const loose = page.locator('.sticky', { hasText: 'answer capacity questions' });
    await expect(loose.locator('[data-anchor-state="unassigned"]')).toBeVisible();
    await page.getByTestId('filter-anchor').selectOption('unassigned');
    await expect(page.getByTestId('note-count')).toHaveText('1 shown');
    await loose.getByTestId('note-edit').click();
    await page.getByTestId('note-target').selectOption('e5'); await page.getByTestId('note-category').fill('Capacity'); await page.getByTestId('note-save').click();
    await page.getByTestId('filter-anchor').selectOption('');
    await expect(loose.locator('[data-anchor-state="attached"]')).toContainText('Check availability');
    await expect(loose.locator('.chip', { hasText: 'Capacity' })).toBeVisible(); // sticky category

    // filters and grouping
    await page.getByTestId('filter-source').selectOption({ label: 'Interview 04' });
    await expect(page.getByTestId('note-count')).toHaveText('2 shown');
    await page.getByTestId('filter-source').selectOption('');
    await page.getByTestId('filter-kind').selectOption('hypothesis');
    await expect(page.getByTestId('note-count')).toHaveText('1 shown');
    await page.getByTestId('filter-kind').selectOption('');
    await page.getByTestId('group-by').selectOption('target');
    await expect(page.locator('[data-group="Find a placement"] .sticky')).toHaveCount(2);
    await page.getByTestId('group-by').selectOption('group');
    await expect(page.locator('[data-group="Placement fieldwork"] .sticky')).toHaveCount(2);
    // anchor click-through returns to the map with the item selected
    await page.locator('[data-note="t1"] [data-anchor-state="attached"]').click();
    await expect(page.getByTestId('lens-title')).toHaveText('Triage application');

    // 3. insight with supporting and contradicting notes; click through to both
    await newInsight(page, 'Capacity answers arrive quickly; the delay is in asking.');
    const insight = page.getByTestId('insight').first();
    await editInsight(insight);
    const attach = async (noteText: string, relation: string) => {
      await insight.getByTestId('insight-attach').click();
      await page.getByTestId('link-relation').selectOption(relation);
      const value = await page.locator('[data-testid=link-to] option', { hasText: noteText }).getAttribute('value');
      await page.getByTestId('link-to').selectOption(value!); await page.getByTestId('link-save').click();
    };
    await attach('checks three places', 'supports');
    await attach('answer capacity questions', 'contradicts');
    await expect(insight.locator('[data-testid=insight-link][data-relation="supports"]')).toHaveCount(1);
    await expect(insight.locator('[data-testid=insight-link][data-relation="contradicts"]')).toHaveCount(1);
    await insight.locator('[data-relation="supports"]').getByTestId('insight-note-link').click();
    await expect(page.getByTestId('notes-board')).toBeVisible();
    await expect(page.locator('.sticky.flash')).toContainText('checks three places');
    await page.getByTestId('nav-insights').click();
    await page.getByTestId('insight').first().locator('[data-relation="contradicts"]').getByTestId('insight-note-link').click();
    await expect(page.locator('.sticky.flash')).toContainText('answer capacity questions');

    // 4. opportunity and scenario from the insight
    await page.getByTestId('nav-insights').click();
    await page.getByTestId('insight').first().getByTestId('insight-to-opportunity').click();
    await expect(page.getByTestId('opportunity')).toBeVisible();
    await expect(page.getByTestId('col-observations')).toContainText('checks three places');
    await expect(page.getByTestId('col-observations')).toContainText('answer capacity questions');
    await page.getByTestId('nav-insights').click();
    await page.getByTestId('insight').first().getByTestId('insight-to-scenario').click();
    await expect(page.getByTestId('scenario-banner')).toContainText('Test: Capacity answers arrive quickly');
    const branches = (await api(page, `/projects/${id}`)).branches;
    expect(branches.find((b: any) => b.kind === 'scenario').origin.type).toBe('insight');
  });

  test('multiline paste offers a split preview', async ({ page }) => {
    await freshProject(page, 'Paste split');
    await page.getByTestId('nav-notes').click();
    await page.getByTestId('capture-text').fill('- Applicants wait for a reply\n- Coordinator re-enters details\n- Board is updated on Fridays');
    await page.getByTestId('split-toggle').click();
    await page.locator('.split li input').nth(1).uncheck();
    await page.getByTestId('capture-save').click();
    await expect(page.locator('.sticky', { hasText: 'Applicants wait for a reply' })).toBeVisible();
    await expect(page.locator('.sticky', { hasText: 'Board is updated on Fridays' })).toBeVisible();
    await expect(page.locator('.sticky', { hasText: 'Coordinator re-enters details' })).toHaveCount(0);
  });
});

test.describe('Observation in context', () => {
  test('two placement episodes for the same role stay separate, with conditions and no rating of the person', async ({ page }) => {
    const id = await freshProject(page, 'Work episodes');
    await startSession(page, 'Observation 07', 'observation');
    await selectEdge(page, 'e3');
    await page.getByTestId('disc-evidence').locator('summary').click();
    const ev = page.getByTestId('disc-evidence');
    const episode = async (text: string, fields: Record<string, string>) => {
      await ev.getByTestId('capture-text').fill(text);
      await ev.getByTestId('episode-toggle').click();
      for (const [k, v] of Object.entries(fields)) await ev.getByTestId(`episode-${k}`).fill(v);
      await ev.getByTestId('capture-save').click();
      await expect(ev.locator('.sticky', { hasText: text })).toBeVisible();
    };
    await episode('Protected conversation; a good match on the first attempt.', { task: 'Match a volunteer to a placement that fits', action: 'Talked through interests and constraints without interruption', helped: 'A quiet room and twenty protected minutes', outcome: 'Placement accepted the same day', hiddenEffort: 'Read the application the evening before', clarification: 'Says protected time like this is rare' });
    await episode('Interrupted three times; an availability detail was missed.', { task: 'Match a volunteer to a placement that fits', action: 'Matched between phone calls at the front desk', hindered: 'Three interruptions; capacity board was out of date', outcome: 'Had to re-contact the volunteer two days later', hiddenEffort: 'Kept a private list of program contacts' });
    const good = ev.locator('.sticky', { hasText: 'Protected conversation' }), hard = ev.locator('.sticky', { hasText: 'Interrupted three times' });
    await expect(good.getByTestId('episode')).toContainText('A quiet room and twenty protected minutes');
    await expect(good.getByTestId('episode')).toContainText('Says protected time like this is rare');
    await expect(hard.getByTestId('episode')).toContainText('Three interruptions; capacity board was out of date');
    await expect(hard.getByTestId('episode')).not.toContainText('quiet room');
    // independently traceable: separate records, same source and target, each with its own anchor
    const notes = (await api(page, `/projects/${id}/evidence`)).notes.filter((n: any) => n.episode);
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((n: any) => n.id)).size).toBe(2);
    expect(notes.every((n: any) => n.targetId === 'e3' && n.sourceId === notes[0].sourceId)).toBe(true);
    // the app shows task and conditions; nowhere does it score or label the person
    await page.getByTestId('nav-notes').click();
    const board = await page.getByTestId('notes-board').innerText();
    expect(board).toMatch(/Conditions that helped/i); expect(board).toMatch(/Conditions that got in the way/i);
    expect(board).not.toMatch(/\b(score|rating|skill level|competen|performance review|deficit)\b/i);
  });
});

test.describe('Open-ended synthesis and decision', () => {
  test('captures an insight by tapping boxes on the map, joined by a thread; an empty press only leaves capture', async ({ page }) => {
    const id = await freshProject(page, 'Insight capture');
    await page.getByTestId('insight-mode').click();
    await expect(page.getByTestId('insight-bar')).toBeVisible();
    await page.getByTestId('insight-mode').click();
    await expect(page.getByTestId('insight-bar')).toHaveCount(0);
    expect((await api(page, `/projects/${id}/evidence`)).insights).toHaveLength(0);

    // tapping toggles boxes, does not open their details, and a thread joins two or more
    await page.getByTestId('insight-mode').click();
    await page.locator('[data-label-for="e3"]').click();
    await expect(page.getByTestId('insight-thread')).toHaveCount(0);
    await page.locator('[data-node="n3"]').click();
    await page.locator('[data-node="n1"]').click();
    await page.locator('[data-node="n1"]').click();
    await expect(page.locator('.picked')).toHaveCount(2);
    await expect(page.getByTestId('insight-thread')).toHaveCount(1);
    // a drag that starts on a box pans the map and does not pick the box
    const before = await page.getByTestId('graph').getAttribute('viewBox');
    const b2 = (await page.locator('[data-node="n2"] .base').boundingBox())!;
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2); await page.mouse.down();
    await page.mouse.move(b2.x + b2.width / 2 + 90, b2.y + b2.height / 2 + 40, { steps: 6 }); await page.mouse.up();
    expect(await page.getByTestId('graph').getAttribute('viewBox')).not.toBe(before);
    await expect(page.locator('.picked')).toHaveCount(2);
    await expect(page.locator('[data-edge="e3"]')).not.toHaveClass(/selected/);
    await expect(page.getByTestId('insight-mode')).toHaveText('✦ Save insight');
    await page.getByTestId('insight-mode').click();
    await expect(page.getByTestId('insight-bar')).toHaveCount(0);
    await expect(page.getByTestId('insight-thread')).toHaveCount(0);
    const ev = await api(page, `/projects/${id}/evidence`);
    expect(ev.insights[0]).toMatchObject({ title: 'About Find a placement, Coordinator', body: '', modelLinks: ['e3', 'n3'], focus: {} });

    // on the Insights page the box holds the tapped items as map cards; Show on map redraws the thread
    await page.getByTestId('nav-insights').click();
    const card = page.getByTestId('insight').first();
    await expect(card.getByTestId('insight-thought')).toHaveText('About Find a placement, Coordinator');
    await card.getByTestId('insight-toggle').click();
    await expect(card.getByTestId('insight-card')).toHaveCount(2);
    await card.getByTestId('show-on-map').click();
    await expect(page.locator('.canvas-wrap.insight-ctx')).toHaveCount(1);
    await expect(page.getByTestId('insight-thread')).toHaveCount(1);
    await expect(page.locator('[data-node="n3"]')).toHaveClass(/picked/);
    await expect(page.locator('[data-node="n1"]')).not.toHaveClass(/picked/);
  });

  test('an insight needs nothing attached; evidence comes and goes without touching notes; weak evidence makes a hypothesis', async ({ page }) => {
    const id = await freshProject(page, 'Open synthesis');
    await newInsight(page, 'The matching conversation is where the quality comes from.');
    await expect(page.getByTestId('insight-evidence').first()).toHaveText('No evidence linked');
    await page.reload();
    await page.getByTestId('nav-insights').click();
    await expect(page.getByTestId('insight-thought').first()).toHaveText('The matching conversation is where the quality comes from.');
    const stored = (await api(page, `/projects/${id}/evidence`)).insights[0];
    expect(stored).toMatchObject({ title: '', modelLinks: [] });
    const notesBefore = (await api(page, `/projects/${id}/evidence`)).notes;

    const insight = page.getByTestId('insight').first();
    await editInsight(insight);
    const attach = async (noteText: string, relation: string) => {
      await insight.getByTestId('insight-attach').click();
      await page.getByTestId('link-relation').selectOption(relation);
      const value = await page.locator('[data-testid=link-to] option', { hasText: noteText }).getAttribute('value');
      await page.getByTestId('link-to').selectOption(value!); await page.getByTestId('link-save').click();
    };
    await attach('checking for available placements manually', 'supports');
    await attach('needing to request an update', 'contradicts');
    await expect(insight.getByTestId('insight-link')).toHaveCount(2);
    // revise one link, detach the other
    await insight.locator('[data-testid=insight-link][data-relation="contradicts"] select').selectOption('related');
    await expect(insight.locator('[data-testid=insight-link][data-relation="related"]')).toHaveCount(1);
    await insight.locator('[data-testid=insight-link][data-relation="related"]').getByTestId('detach').click();
    await expect(insight.getByTestId('insight-link')).toHaveCount(1);
    // revise the insight text itself
    await insight.getByTestId('insight-body').fill('The protected matching conversation is where placement quality comes from.');
    await insight.getByTestId('insight-save').click();
    await expect(page.getByTestId('toast')).toContainText('Insight saved');
    expect((await api(page, `/projects/${id}/evidence`)).notes).toEqual(notesBefore); // notes untouched throughout

    await expect(insight.getByTestId('insight-thought')).toHaveText('The protected matching conversation is where placement quality comes from.');
    // use it in a recommendation
    await editInsight(insight);
    await insight.getByTestId('insight-to-opportunity').click();
    await page.locator('[data-add-option="process_change"]').click();
    await page.locator('[data-option][data-kind="process_change"]').getByTestId('opt-recommend').click();
    await expect(page.getByTestId('opp-heading')).toHaveText('Hypothesis to test');
    await expect(page.getByTestId('hypothesis-banner')).toContainText('hypothesis to test');
    await expect(page.getByTestId('col-observations')).toContainText('checking for available placements manually');
    await expect(page.getByTestId('col-interpretation')).toContainText('protected matching conversation');
    await expect(page.getByTestId('col-gaps')).toContainText('no recorded certainty');
    await page.getByTestId('nav-report').click();
    await expect(page.getByTestId('rec-heading').first()).toContainText('Hypothesis to test');
    await expect(page.getByTestId('rec-gaps').first()).toContainText('no recorded certainty');
    await expect(page.getByTestId('brief-preview')).not.toContainText('The protected matching conversation is where placement quality comes from.');
  });

  test('compare status quo, process change, existing tool and bespoke option, then export every deliverable', async ({ page }) => {
    const id = await freshProject(page, 'Decision and report');
    // make an approved source so provenance has something to show; add an internal-only remark and an unapproved note
    await page.request.post(`/api/projects/${id}/c/sources`, { data: { anonId: 'Process walk 02', type: 'walkthrough', participantRole: 'Coordinator (only one in the team)', exportApproved: true } });
    const src = (await api(page, `/projects/${id}/evidence`)).sources.find((s: any) => s.anonId === 'Process walk 02');
    const mk = async (data: object) => (await (await page.request.post(`/api/projects/${id}/c/notes`, { data })).json()).doc;
    const approved = await mk({ text: 'Capacity is confirmed by phone before every placement.', sourceId: src.id, targetId: 'e5', certainty: 'observed', excerptApproved: true });
    const hidden = await mk({ text: 'UNAPPROVED remark naming a colleague', targetId: 'e5' });
    const ins = (await (await page.request.post(`/api/projects/${id}/c/insights`, { data: { title: 'Capacity checks interrupt matching', body: 'Each check is a context switch.' } })).json()).doc;
    for (const [n, relation] of [[approved, 'supports'], [hidden, 'contradicts']] as const) await page.request.post(`/api/projects/${id}/c/links`, { data: { fromType: 'note', fromId: n.id, toType: 'insight', toId: ins.id, relation } });
    await page.reload();
    await expect(page.getByTestId('graph')).toBeVisible();
    await page.getByTestId('nav-insights').click();
    await editInsight(page.getByTestId('insight').first());
    await page.getByTestId('insight').first().getByTestId('insight-to-opportunity').click();
    await page.getByTestId('opp-report-title').fill('Protect matching conversations');
    await page.getByTestId('opp-report-title').blur();
    await page.getByTestId('opp-interpretation').fill('Capacity checks interrupt the matching conversation.');
    await page.getByTestId('opp-interpretation').blur();
    for (const k of ['status_quo', 'process_change', 'existing_tool', 'bespoke_tool']) await page.locator(`[data-add-option="${k}"]`).click();
    await expect(page.locator('[data-option]')).toHaveCount(4);
    const pc = page.locator('[data-option][data-kind="process_change"]');
    const fill = async (k: string, v: string) => { await pc.getByTestId(`opt-${k}`).fill(v); await pc.getByTestId(`opt-${k}`).blur(); };
    await fill('benefits', 'Fewer interrupted matching conversations'); await fill('downsides', 'Program leads must update a shared board weekly');
    await fill('shiftedWork', 'About ten minutes a week moves to program leads'); await fill('effort', 'One afternoon to set up'); await fill('unknowns', 'Whether leads keep the board current'); await fill('test', 'Four-week trial with two programs');
    await pc.getByTestId('opt-smallest').check();
    await pc.getByTestId('opt-recommend').click();
    const pilotScope = pc.getByRole('checkbox', { name: 'Within the pilot’s recommendation scope' });
    await pilotScope.uncheck();
    await expect(page.getByTestId('opp-heading')).toHaveText('Exploratory option outside pilot scope');
    await expect(page.getByTestId('register')).toContainText('Exploratory option outside pilot scope');
    await pilotScope.check();
    await expect(page.getByTestId('opp-heading')).toHaveText('Hypothesis to test');
    await page.getByTestId('opp-preserve').fill('The personal matching conversation.'); await page.getByTestId('opp-preserve').blur();
    await page.getByTestId('opp-internal').fill('INTERNAL-ONLY: talk to R. first'); await page.getByTestId('opp-internal').blur();
    await page.locator('[data-criterion="evidenceStrength"]').selectOption('2'); await page.locator('[data-criterion="humanRisk"]').selectOption('1');
    await expect(page.locator('[data-testid=register] tbody tr').first()).toContainText('smallest reversible');
    await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 8000 });

    // guardrail on a scenario for the selected option
    await pc.getByTestId('opt-scenario').click();
    await page.getByTestId('tab-people').click();
    await page.getByTestId('guardrails-add').click();
    await page.locator('[data-testid=guardrails] [data-field="metric"]').fill('Placements needing re-contact');
    await page.locator('[data-testid=guardrails] [data-field="denominator"]').fill('placements per month');
    await page.locator('[data-testid=guardrails] [data-field="rollbackTrigger"]').fill('re-contacts rise for two weeks');
    await saved(page);

    await page.getByTestId('nav-report').click();
    const preview = page.getByTestId('brief-preview');
    await expect(preview).toContainText('Capacity is confirmed by phone before every placement.');
    await expect(preview).toContainText('excerpt not approved for export');
    await expect(preview).toContainText('Smallest reversible change');
    await expect(page.getByTestId('rec-guardrails')).toContainText('Placements needing re-contact');
    await expect(page.getByTestId('brief-provenance')).toContainText('Process walk 02');
    const text = await preview.innerText();
    expect(text).not.toContain('UNAPPROVED'); expect(text).not.toContain('INTERNAL-ONLY'); expect(text).not.toContain('only one in the team');
    expect(text).toContain('Capacity checks interrupt the matching conversation.');
    expect(text).not.toContain('Each check is a context switch.');
    await expect(page.getByTestId('brief-percase')).toContainText('63'); await expect(preview).toContainText('unverified');

    // each deliverable downloads and opens as its real format
    const grab = async (testid: string) => { const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testid).click()]); const fs = await import('node:fs'); return { name: d.suggestedFilename(), buf: fs.readFileSync((await d.path())!) }; };
    const brief = await grab('export-brief'); expect(brief.name).toMatch(/decision-brief\.pdf$/); expect(brief.buf.subarray(0, 5).toString()).toBe('%PDF-'); expect(brief.buf.length).toBeGreaterThan(4000);
    const map = await grab('export-map'); expect(map.name).toMatch(/current-state-map\.pdf$/); expect(map.buf.subarray(0, 5).toString()).toBe('%PDF-');
    const xlsx = await grab('export-xlsx'); expect(xlsx.buf.subarray(0, 2).toString()).toBe('PK');
    const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xlsx.buf as any);
    const sheet = wb.getWorksheet('Opportunities')!; const row = sheet.getRow(3).values as string[];
    expect(row.join('|')).toContain('Protect matching conversations'); expect(row.join('|')).toContain('Program leads must update a shared board weekly');
    expect(row.join('|')).not.toContain('Capacity checks interrupt matching');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Opportunities', 'Options compared', 'Provenance']);
    const csv = (await grab('export-csv')).buf.toString(); expect(csv.split('\r\n')[1]).toContain('Hypothesis to test'); expect(csv).not.toContain('INTERNAL-ONLY');
    const json = JSON.parse((await grab('export-json')).buf.toString()); expect(json.format).toBe('weave-workspace'); expect(json.opportunities).toHaveLength(1);
    // the PDF text carries provenance and no withheld content (text streams are compressed; check through pdf.js-free heuristic on the JSON source instead)
    const data = await api(page, `/projects/${id}/export/brief.json`);
    expect(JSON.stringify(data)).not.toMatch(/UNAPPROVED|INTERNAL-ONLY|only one in the team/);
    expect(data.provenance.map((p: any) => p.id)).toContain('Process walk 02');
    await expect(page.getByTestId('effort-log')).toContainText('Capture');
  });
});
