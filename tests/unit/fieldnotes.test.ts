import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classify, findNames, locate, markRepeats, merge, place, replaceNames, segment, splitAt, splitOffline } from '../../src/shared/fieldnotes';
import { proposalsFromOutput, splitFileWithClaude, splitWithClaude, type SplitOutput } from '../../src/shared/fieldnotes-ai';
import { docxXmlToText } from '../../src/client/docx';
import { fixtureModel } from './helpers';

const NOTES = readFileSync('tests/fixtures/fieldnotes-mixed.txt', 'utf8');

describe('splitting field notes on the device', () => {
  it('leaves headings and metadata out, splits bullets, prose sentences and speaker lines', () => {
    const ps = splitOffline(NOTES, null);
    const texts = ps.map((p) => p.text);
    expect(texts.some((t) => t.startsWith('Interview with') || t.startsWith('Location'))).toBe(false);
    expect(texts).toContain('Watched her triage two applications.');
    expect(texts).toContain('The second call went to voicemail.');
    expect(ps.find((p) => p.text.startsWith('we only find out'))).toMatchObject({ speaker: 'Sam', certainty: 'reported' });
    // every proposal points at its exact words
    for (const p of ps) expect(NOTES.slice(p.start, p.end).trim()).toBe(p.text);
  });
  it('is cautious about how something is known', () => {
    expect(classify('Coordinator checks the board.', '')).toEqual({ kind: 'observation', certainty: null });
    expect(classify('Takes about 20 min per placement.', '')).toMatchObject({ kind: 'measurement' });
    expect(classify('Prob. because leads only update on Fridays?', '')).toEqual({ kind: 'hypothesis', certainty: 'inferred' });
    expect(classify('Ask the lead whether this is a rule.', '')).toEqual({ kind: 'question', certainty: null });
    expect(classify('Said the board is "never current".', '')).toMatchObject({ certainty: 'reported' });
    expect(classify('Leads update the board every Friday.', '', 'document')).toEqual({ kind: 'observation', certainty: 'documented' });
    // sentences after "Watched ..." in the same paragraph were seen too
    expect(splitOffline(NOTES, null).find((p) => p.text.startsWith('She read'))!.certainty).toBe('observed');
  });
  it('treats a short first line as a title', () => {
    expect(segment('Placement procedure v3\n- Leads update the board every Friday.').map((s) => s.start)).toEqual([25]);
  });
  it('places a note by shared words, with how sure it is', () => {
    const m = fixtureModel();
    expect(place('The coordinator phones every applicant.', m).targetId).toBe('n3');
    expect(place('Lunch was late.', m)).toEqual({ targetId: null, confidence: 'low' });
  });
});

describe('names', () => {
  it('finds likely names, not days, map words or sentence starts', () => {
    expect(findNames(NOTES).map((n) => n.name)).toEqual(['Dana', 'Sam']);
    expect(findNames('Coordinator said hi to Priya.', fixtureModel()).map((n) => n.name)).toEqual(['Priya']);
  });
  it('replaces whole words, keeps possessives, and capitalises at the start of a line', () => {
    const out = replaceNames("Dana: fine.\n- Dana's sheet is late.\nAsk Danae, not Dana.", [{ name: 'Dana', with: 'the coordinator' }]);
    expect(out).toBe("The coordinator: fine.\n- The coordinator's sheet is late.\nAsk Danae, not the coordinator.");
    expect(segment(out)[0].speaker).toBe('The coordinator');
  });
});

describe('review edits', () => {
  it('joins two proposals over the original words and includes the result', () => {
    const doc = 'First claim here today. Second claim follows now.';
    const [a, b] = splitOffline(doc, null);
    const j = merge(doc, { ...a, include: false }, b);
    expect(j).toMatchObject({ text: doc, start: 0, end: doc.length, include: true });
    const cut = splitAt(doc, j, 'First claim here today.'.length, null)!;
    expect(cut.map((p) => p.text)).toEqual(['First claim here today.', 'Second claim follows now.']);
  });
  it('finds excerpts despite different spacing, and marks repeats of saved notes', () => {
    expect(locate('one  two\nthree', 'two three')).toEqual({ start: 5, end: 14 });
    const ps = markRepeats(splitOffline('This claim is already saved. A brand new claim appears.', null), [{ id: 't1', text: 'This claim is ALREADY saved' }]);
    expect(ps.map((p) => [p.include, p.duplicateOf])).toEqual([[false, 't1'], [true, null]]);
  });
});

describe('reading Word files', () => {
  it('keeps paragraphs, bullets, headings and entities', () => {
    const p = (inner: string, pPr = '') => `<w:p>${pPr}<w:r>${inner}</w:r></w:p>`;
    const xml = `<w:document><w:body>${p('<w:t>Plan</w:t>', '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>')}${p('<w:t>Leads &amp; coordinators</w:t>')}${p('<w:t>Check the board</w:t>', '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>')}<w:p/>${p('<w:t xml:space="preserve">A </w:t><w:t>split</w:t><w:tab/><w:t>run</w:t>')}</w:body></w:document>`;
    expect(docxXmlToText(xml)).toBe('# Plan\nLeads & coordinators\n- Check the board\n\nA split\trun');
  });
});

describe("Claude's reply", () => {
  const items = [{ id: 'n3', type: 'node' as const, label: 'Coordinator', detail: '' }];
  const note = (excerpt: string, extra: Partial<SplitOutput['notes'][number]> = {}) => ({ excerpt, readable: '', kind: 'observation' as const, certainty: 'unknown' as const, target: '', confidence: 'high' as const, not_on_map: '', speaker: '', why: '', ...extra });
  it('locates excerpts in order, drops unknown map ids and keeps what it cannot find, marked', () => {
    const doc = 'Alpha happens. Beta happens. Alpha happens.';
    const ps = proposalsFromOutput(doc, { notes: [note('Alpha happens.', { target: 'n3' }), note('Alpha happens.', { target: 'nope' }), note('Gamma never written.')] }, items);
    expect(ps.map((p) => [p.start, p.targetId, p.certainty])).toEqual([[0, 'n3', null], [29, null, null], [-1, null, null]]);
  });
  const stub = (reply: unknown, stop = 'end_turn') => {
    const calls: any[] = [];
    const client = { beta: { messages: { stream: (params: any) => { calls.push(params); return { finalMessage: async () => ({ stop_reason: stop, content: [{ type: 'text', text: JSON.stringify(reply) }] }) }; } } } };
    return { client: client as any, calls };
  };
  it('asks with a structured reply format, the fallback opt-in and the map, and validates the answer', async () => {
    const { client, calls } = stub({ notes: [note('x')] });
    const out = await splitWithClaude(client, { text: 'x', items, docType: 'notes' });
    expect(out.notes).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'], output_config: { format: { type: 'json_schema' } } });
    expect(calls[0].messages[0].content[0].text).toContain('n3 | node | Coordinator');
    await expect(splitWithClaude(stub({ wrong: true }).client, { text: 'x', items, docType: 'notes' })).rejects.toThrow('expected form');
    await expect(splitWithClaude(stub({}, 'refusal').client, { text: 'x', items, docType: 'notes' })).rejects.toThrow('declined');
  });
  it('sends a PDF as a document block and needs a transcript back', async () => {
    const { client, calls } = stub({ transcript: 'Leads update weekly.', notes: [note('Leads update weekly.', { certainty: 'documented' })] });
    const out = await splitFileWithClaude(client, { name: 'p.pdf', mime: 'application/pdf', data: 'JVBERi0=', items, docType: 'document' });
    expect(out.transcript).toBe('Leads update weekly.');
    expect(calls[0].messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
    expect(calls[0].output_config.format.schema.required).toEqual(['transcript', 'notes']);
  });
});
