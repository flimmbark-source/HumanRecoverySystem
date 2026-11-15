// Opportunity sheet as XLSX and CSV. Internal notes and unapproved excerpts never appear here.
import ExcelJS from 'exceljs';
import type { Brief } from './brief';

const HEAD = ['Rank', 'Opportunity', 'Status', 'Evidence', 'Supporting observations', 'Contradicting observations', 'Interpretation', 'Evidence gaps and uncertainty', 'What to protect', 'Whose day changes',
  'Selected option', 'Option type', 'Smallest reversible change', 'Benefits', 'Downsides and human costs', 'Added or shifted work', 'Implementation effort', 'Costs', 'Tradeoffs', 'Confidence', 'Unknowns', 'What to test',
  'Monthly effort change (like for like)', 'Monthly effort change (modeled volumes)', 'Cash', 'Guardrails', 'Validation plan'];

function rows(b: Brief): string[][] {
  return b.recommendations.map((r, i) => {
    const line = (label: string) => r.comparison?.lines.find((l) => l.label === label);
    const like = line('Monthly effort, like for like'), modeled = line('Monthly effort at modeled volumes');
    return [String(i + 1), r.title, r.heading, r.evidenceLevel, String(r.observations.filter((o) => o.relation === 'supports').length), String(r.observations.filter((o) => o.relation === 'contradicts').length),
      [r.insights.map((x) => x.title).join('; '), r.interpretation].filter(Boolean).join(' — '), r.gaps.join(' | '), r.preserve, r.stakeholders,
      r.option?.title ?? '', r.option?.kindLabel ?? '', r.option ? (r.option.smallestReversible ? 'Yes' : 'No') : '', r.option?.benefits ?? '', r.option?.downsides ?? '', r.option?.shiftedWork ?? '', r.option?.effort ?? '', r.option?.costs ?? '',
      r.option?.tradeoffs ?? '', r.option?.confidence ?? '', r.option?.unknowns ?? '', r.option?.test ?? '',
      like ? `${like.change} (${like.note})` : 'Not modeled', modeled ? `${modeled.change} (${modeled.note})` : 'Not modeled', r.comparison ? r.comparison.cash[0] : 'Unknown', r.comparison?.guardrails.map((g) => g.metric).join('; ') ?? '', r.validationPlan];
  });
}

export async function opportunityXlsx(b: Brief): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Weave Operational Studio';
  const ws = wb.addWorksheet('Opportunities', { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.addRow([`${b.projectName} — opportunity sheet · generated ${b.generatedAt.slice(0, 10)}${b.synthetic ? ' · SYNTHETIC DEMONSTRATION DATA' : ''}`]);
  ws.addRow(HEAD);
  ws.getRow(1).font = { bold: true, size: 12 };
  ws.getRow(2).font = { bold: true };
  ws.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9F2E9' } };
  rows(b).forEach((r) => ws.addRow(r));
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 6 : [1, 6, 7, 13, 14].includes(i) ? 38 : 22; c.alignment = { wrapText: true, vertical: 'top' }; });
  const opts = wb.addWorksheet('Options compared');
  opts.addRow(['Opportunity', 'Option', 'Type', 'Selected', 'Benefits', 'Downsides', 'Confidence']).font = { bold: true };
  for (const r of b.recommendations) {
    if (r.option) opts.addRow([r.title, r.option.title, r.option.kindLabel, 'Yes', r.option.benefits, r.option.downsides, r.option.confidence]);
    for (const a of r.alternatives) opts.addRow([r.title, a.title, a.kindLabel, 'No', a.benefits, a.downsides, a.confidence]);
  }
  opts.columns.forEach((c) => { c.width = 30; c.alignment = { wrapText: true, vertical: 'top' }; });
  const prov = wb.addWorksheet('Provenance');
  prov.addRow(['Source ID', 'Type', 'URL', 'Retrieved']).font = { bold: true };
  b.provenance.forEach((s) => prov.addRow([s.id, s.type, s.url, s.retrieved]));
  prov.addRow([]); b.withheld.forEach((w) => prov.addRow([w]));
  prov.columns.forEach((c) => { c.width = 34; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function opportunityCsv(b: Brief): string {
  // Leading = + - @ are neutralized so a spreadsheet never treats research text as a formula.
  const cell = (s: string) => { const v = /^[=+\-@]/.test(s) ? `'${s}` : s; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return [HEAD, ...rows(b)].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
