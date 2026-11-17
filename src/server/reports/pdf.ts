// Print-ready PDFs: the leadership decision brief and the current-state map.
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Brief } from './brief';
import { EDGE_TYPES, EDGE_TYPE_LABEL, activityForEdge, fmtQty } from '../../shared/model';
import { edgeGeom, nodeW, NODE_H, placeLabels, pos, shortLabel, wrapNodeLabel } from '../../shared/layout';

const INK = '#20352f', MUTED = '#6b7a72', LINE = '#d9e0d8', GREEN = '#225a4b', AMBER = '#8a6a2f';
const TYPE_COLOR: Record<string, string> = { flow: '#567fa7', info: '#4b9f90', dependency: '#b5914d', authority: '#967da8', association: '#8d979e' };
const DASH: Record<string, number[] | null> = { flow: null, info: [8, 6], dependency: [2, 5], authority: [11, 3, 2, 3], association: [5, 5] };

// A bundled Unicode font is registered, so text in any Latin, Greek or Cyrillic script
// (and symbols such as the minus sign and arrows) renders correctly. Without the files the built-in fonts are used.
const here = path.dirname(fileURLToPath(import.meta.url));
const fontDir = [path.resolve('assets/fonts'), path.resolve(here, '../../assets/fonts'), path.resolve(here, '../../../assets/fonts')].find((d) => existsSync(path.join(d, 'DejaVuSans.ttf')));
// pdfkit caches its built-in Helvetica under that name, so the bundled font gets names of its own.
const F = fontDir ? { r: 'Weave', b: 'Weave-Bold', i: 'Weave-Oblique' } : { r: 'Helvetica', b: 'Helvetica-Bold', i: 'Helvetica-Oblique' };
function fonts(doc: PDFKit.PDFDocument) {
  if (!fontDir) return;
  const oblique = existsSync(path.join(fontDir, 'DejaVuSans-Oblique.ttf')) ? 'DejaVuSans-Oblique.ttf' : 'DejaVuSans.ttf';
  doc.registerFont('Weave', path.join(fontDir, 'DejaVuSans.ttf'));
  doc.registerFont('Weave-Bold', path.join(fontDir, 'DejaVuSans-Bold.ttf'));
  doc.registerFont('Weave-Oblique', path.join(fontDir, oblique));
}
/** With the built-in fonts only, characters outside WinAnsi would print as garbage; map the ones this app emits. */
function plain<T>(value: T): T {
  if (fontDir) return value;
  return JSON.parse(JSON.stringify(value).replace(/\u2212|−/g, '-').replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=')) as T;
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export function briefPdf(input: Brief): Promise<Buffer> {
  const b = plain(input);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 60, left: 56, right: 56 }, bufferPages: true, info: { Title: `${b.projectName} — decision brief`, Author: 'Weave Operational Studio' } });
  fonts(doc);
  const W = doc.page.width - 112;
  const room = (h: number) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
  const h1 = (t: string) => { room(60); doc.moveDown(0.8).font(F.b).fontSize(15).fillColor(INK).text(t, { width: W }); doc.moveTo(56, doc.y + 3).lineTo(56 + W, doc.y + 3).strokeColor(LINE).lineWidth(1).stroke(); doc.moveDown(0.6); };
  const h2 = (t: string) => { room(40); doc.moveDown(0.5).font(F.b).fontSize(11.5).fillColor(GREEN).text(t, { width: W }); doc.moveDown(0.2); };
  const label = (t: string) => { room(30); doc.moveDown(0.35).font(F.b).fontSize(8).fillColor(MUTED).text(t.toUpperCase(), { width: W, characterSpacing: 0.6 }); doc.moveDown(0.1); };
  const para = (t: string, color = INK) => { if (!t.trim()) return; doc.font(F.r).fontSize(10).fillColor(color).text(t.trim(), { width: W, lineGap: 2 }); doc.moveDown(0.25); };
  const bullet = (t: string, color = INK) => { room(16); doc.font(F.r).fontSize(10).fillColor(color).text(`•  ${t}`, 62, doc.y, { width: W - 6, lineGap: 2 }); doc.x = 56; };
  const field = (name: string, value: string) => { if (!value?.trim()) return; label(name); para(value); };
  const table = (head: string[], rows: string[][], widths: number[]) => {
    const draw = (cells: string[], bold: boolean) => {
      doc.font(bold ? F.b : F.r).fontSize(8.5);
      const hgt = Math.max(...cells.map((c, i) => doc.heightOfString(c || '—', { width: widths[i] * W - 8 }))) + 8;
      room(hgt + 4);
      const y = doc.y; let x = 56;
      cells.forEach((c, i) => { doc.fillColor(bold ? MUTED : INK).text(c || '—', x + 4, y + 4, { width: widths[i] * W - 8 }); x += widths[i] * W; });
      doc.moveTo(56, y + hgt).lineTo(56 + W, y + hgt).strokeColor(LINE).lineWidth(0.6).stroke();
      doc.x = 56; doc.y = y + hgt;
    };
    draw(head, true); rows.forEach((r) => draw(r, false)); doc.moveDown(0.5);
  };

  doc.font(F.b).fontSize(8).fillColor(MUTED).text('DECISION BRIEF · ANONYMIZED', { characterSpacing: 1 });
  doc.moveDown(0.4).font(F.b).fontSize(22).fillColor(INK).text(b.projectName, { width: W });
  doc.moveDown(0.3).font(F.r).fontSize(9.5).fillColor(MUTED).text(`Generated ${b.generatedAt.slice(0, 10)} · current-state map as of ${b.asOf.slice(0, 10)}${b.scope.orgUnit ? ` · ${b.scope.orgUnit}` : ''}`);
  if (b.synthetic) { doc.moveDown(0.5).font(F.b).fontSize(9.5).fillColor(AMBER).text('SYNTHETIC DEMONSTRATION DATA. Names, sources, figures and relationships are invented and are not findings about any organization.', { width: W }); }

  h1('Scope');
  field('Research question', b.scope.researchQuestion); field('Workflow in scope', b.scope.scopeDescription);
  field('Intended outcome', b.scope.intendedOutcome); field('External interfaces', b.scope.externalInterfaces);

  h1('How the work runs today');
  const cs = b.currentState;
  para(`The current-state map has ${cs.counts.nodes} roles, systems and outputs joined by ${cs.counts.connections} connections, informed by ${cs.counts.notes} notes from ${cs.counts.sources} sources.`);
  table(['Measure', 'Value', 'Basis'], [
    ['Staff effort', cs.effortPerCase, cs.effortNote], ['Monthly effort', cs.effortMonthly, `Volume: ${cs.volume}`],
    ...cs.routes.map((r) => [`Route “${r.name}”`, `${r.elapsed} elapsed`, `${r.active} active + ${r.waiting} waiting, sequential`]),
  ], [0.26, 0.34, 0.4]);
  if (cs.missing.length) { label('Not yet measured'); cs.missing.forEach((x) => bullet(x, AMBER)); doc.moveDown(0.3); }
  if (cs.byRole.length) { label('Effort by role'); table(['Role', 'Effort'], cs.byRole.map((r) => [r.role, r.perCase]), [0.5, 0.5]); }
  for (const r of cs.routes) if (r.flags.length) { label(`Route “${r.name}” notes`); r.flags.forEach((x) => bullet(x, MUTED)); }
  h2('Handoffs in plain language');
  for (const h of cs.handoffs) { room(34); doc.font(F.b).fontSize(9.5).fillColor(INK).text(`${h.label}  `, { continued: true, width: W }).font(F.r).fillColor(MUTED).text(`(${h.type})`); para(h.sentence); if (h.unknowns.length) { doc.font(F.i).fontSize(8.5).fillColor(AMBER).text(`Not yet known: ${h.unknowns.join('; ')}`, { width: W }); doc.moveDown(0.3); } }

  h1('Opportunities and recommendations');
  if (!b.recommendations.length) para('No opportunities have been recorded yet.', MUTED);
  b.recommendations.forEach((r, i) => {
    room(90);
    doc.moveDown(0.6).font(F.b).fontSize(8).fillColor(r.isHypothesis || r.option?.withinPilotScope === false ? AMBER : GREEN).text(`${i + 1}. ${r.heading.toUpperCase()} · ${r.evidenceLevel.toUpperCase()}`, { characterSpacing: 0.6 });
    doc.moveDown(0.15).font(F.b).fontSize(13).fillColor(INK).text(r.title, { width: W }); doc.moveDown(0.3);
    if (r.stale) para('The scenario behind this item has changed since it was written. Figures below reflect the current scenario and the text may need review.', AMBER);
    if (r.isHypothesis) para('This is a hypothesis to test.', AMBER);
    if (r.closeReason) field('Why this was closed', r.closeReason);
    label('What was observed');
    if (!r.observations.length) para('No observations are linked to this item yet.', MUTED);
    for (const o of r.observations) bullet(`${o.relation === 'supports' ? 'Supports' : o.relation === 'contradicts' ? 'Contradicts' : 'Related'} · ${o.kind}, ${o.certainty} · ${o.source}${o.text ? ` — “${o.text}”` : ' — excerpt not approved for export'}`, o.relation === 'contradicts' ? AMBER : INK);
    doc.moveDown(0.3);
    label('Interpretation');
    para(r.interpretation || 'No interpretation prepared for this brief.', r.interpretation ? INK : MUTED);
    label('Evidence gaps and uncertainty');
    if (r.gaps.length) r.gaps.forEach((g) => bullet(g, AMBER)); else para('None recorded.', MUTED);
    doc.moveDown(0.3);
    field('What already works and should be protected', r.preserve); field('Whose working day changes', r.stakeholders);
    if (r.option) {
      h2(`${r.option.smallestReversible ? 'Smallest reversible change' : 'Proposed option'}: ${r.option.title}`);
      para(`${r.option.kindLabel} · confidence ${r.option.confidence}${r.option.withinPilotScope ? '' : ' · outside the pilot’s recommendation scope (exploratory)'}`, MUTED);
      field('Benefits', r.option.benefits); field('Downsides and human costs', r.option.downsides); field('Added or shifted work', r.option.shiftedWork);
      field('Implementation effort', r.option.effort); field('Costs', r.option.costs); field('Tradeoffs', r.option.tradeoffs); field('Unknowns', r.option.unknowns); field('What to test', r.option.test);
    }
    if (r.alternatives.length) { label('Other options compared'); table(['Option', 'Benefits', 'Downsides', 'Confidence'], r.alternatives.map((a) => [`${a.title} (${a.kindLabel})${a.withinPilotScope ? '' : ' · Exploratory option outside pilot scope'}`, a.benefits, a.downsides, a.confidence]), [0.26, 0.3, 0.28, 0.16]); }
    const c = r.comparison;
    if (c) {
      h2(`Modeled comparison: ${c.scenarioName}`);
      para(`Compared with ${c.pinnedTo}. Effort, elapsed time, cash and human effects are reported separately.${c.unverified ? ' Inputs include unverified or estimated values, so these are modeled figures, not measured results.' : ''}`, MUTED);
      table(['Measure', 'Baseline', 'Proposed', 'Change', 'Denominator'], c.lines.map((l) => [l.label, l.baseline, l.proposed, l.change, l.note]), [0.24, 0.18, 0.18, 0.12, 0.28]);
      if (c.byRole.length) { label('Monthly effort by role, like for like'); table(['Role', 'Baseline', 'Proposed', 'Change'], c.byRole.map((x) => [x.role, x.baseline, x.proposed, x.change]), [0.34, 0.24, 0.24, 0.18]); }
      label('Cash'); c.cash.forEach((x) => bullet(x)); doc.moveDown(0.3);
      label('Human and service effects');
      if (!c.humanEffects.length) para('None recorded.', MUTED);
      c.humanEffects.forEach((h) => bullet(`${h.role} — ${h.kind} (${h.direction}): ${h.description} Magnitude: ${h.magnitude}.${h.validation ? ` How it will be checked: ${h.validation}` : ''}`));
      doc.moveDown(0.3);
      if (c.workingConditions.length) { label('Working conditions'); table(['Role', 'Indicator', 'Today', 'Expected', 'Basis'], c.workingConditions.map((w) => [w.role, w.indicator, w.baseline, w.expected, w.basis]), [0.2, 0.26, 0.2, 0.2, 0.14]); }
      if (c.guardrails.length) { label('Guardrails'); c.guardrails.forEach((g) => bullet(`${g.metric}: ${g.detail}`)); doc.moveDown(0.3); }
      field('What the change preserves', c.preserve); field('How to reverse it', c.reversal); field('Still unknown', c.unknowns); field('Validation', c.validation);
    }
    field('Validation plan', r.validationPlan);
  });

  h1('Provenance');
  if (!b.provenance.length) para('No sources are approved for citation in this export.', MUTED);
  b.provenance.forEach((s) => bullet(`${s.id} (${s.type})${s.url ? ` — ${s.url}${s.retrieved ? `, retrieved ${s.retrieved}` : ''}` : ''}`));
  doc.moveDown(0.4); label('What this brief leaves out'); b.withheld.forEach((x) => bullet(x, MUTED));

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font(F.r).fontSize(8).fillColor(MUTED).text(`${b.projectName} · decision brief${b.synthetic ? ' · synthetic data' : ''} · page ${i + 1} of ${range.count}`, 56, doc.page.height - 44, { width: W, align: 'center', lineBreak: false });
  }
  return collect(doc);
}

export function mapPdf(input: Brief): Promise<Buffer> {
  const b = plain(input);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 36, bottom: 36, left: 36, right: 36 }, info: { Title: `${b.projectName} — current-state map`, Author: 'Weave Operational Studio' } });
  fonts(doc);
  const m = b.model, layout = b.layout;
  const PW = doc.page.width, PH = doc.page.height;
  doc.font(F.b).fontSize(8).fillColor(MUTED).text('CURRENT-STATE MAP', 36, 30, { characterSpacing: 1 });
  doc.font(F.b).fontSize(16).fillColor(INK).text(b.projectName, 36, 42);
  doc.font(F.r).fontSize(8.5).fillColor(b.synthetic ? AMBER : MUTED).text(`${b.synthetic ? 'Synthetic demonstration data. ' : ''}As of ${b.asOf.slice(0, 10)} · ${b.currentState.effortPerCase} · ${b.currentState.effortMonthly}`, 36, 62);
  const labels = placeLabels(m, layout);
  const xs: number[] = [], ys: number[] = [];
  for (const n of m.nodes) { const p = pos(layout, n.id); xs.push(p.x - nodeW(n) / 2 - 10, p.x + nodeW(n) / 2 + 10); ys.push(p.y - NODE_H / 2 - 12, p.y + NODE_H / 2 + 26); }
  for (const l of labels.values()) { xs.push(l.x - l.w / 2 - 14, l.x + l.w / 2 + 14); ys.push(l.y - 24, l.y + 20); }
  if (!xs.length) { doc.font(F.r).fontSize(11).fillColor(MUTED).text('The map is empty.', 36, 120); return collect(doc); }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const top = 88, bottom = PH - 70;
  const scale = Math.min((PW - 72) / (maxX - minX), (bottom - top) / (maxY - minY), 1.1);
  const ox = 36 + ((PW - 72) - (maxX - minX) * scale) / 2 - minX * scale, oy = top + ((bottom - top) - (maxY - minY) * scale) / 2 - minY * scale;
  doc.save().translate(ox, oy).scale(scale);
  for (const e of m.edges) {
    const g = edgeGeom(e, m, layout); if (!g) continue;
    const color = TYPE_COLOR[e.type];
    doc.path(g.d).lineWidth(2.4).strokeColor(color);
    if (DASH[e.type]) doc.dash(DASH[e.type]![0], { space: DASH[e.type]![1] }); else doc.undash();
    doc.stroke(); doc.undash();
    if (e.directed) { const a = Math.atan2(g.by - g.cy, g.bx - g.cx); doc.moveTo(g.bx, g.by).lineTo(g.bx - 10 * Math.cos(a - 0.45), g.by - 10 * Math.sin(a - 0.45)).moveTo(g.bx, g.by).lineTo(g.bx - 10 * Math.cos(a + 0.45), g.by - 10 * Math.sin(a + 0.45)).lineWidth(2).strokeColor(color).stroke(); }
    const l = labels.get(e.id); if (!l) continue;
    if (Math.hypot(l.x - g.mx, l.y - g.my) > 125) {
      doc.moveTo(g.mx, g.my).lineTo(l.x, l.y).lineWidth(1).strokeColor(color).dash(2, { space: 4 }).stroke().undash();
    }
    doc.roundedRect(l.x - l.w / 2, l.y - 21, l.w, 33, 7).lineWidth(1).fillAndStroke('#ffffff', color);
    doc.font(F.b).fontSize(10).fillColor(INK).text(shortLabel(e.label), l.x - l.w / 2, l.y - 16, { width: l.w, align: 'center', lineBreak: false });
    const a = activityForEdge(m, e.id);
    const sub = a ? `${a.activeMinutes.value === null ? '?' : fmtQty(a.activeMinutes) + 'm'} active${a.waitMinutes.value ? ` · ${fmtQty({ ...a.waitMinutes, value: a.waitMinutes.value / 60 })}h wait` : ''}` : EDGE_TYPE_LABEL[e.type].toLowerCase();
    doc.font(F.r).fontSize(8).fillColor(MUTED).text(sub, l.x - l.w / 2, l.y - 3, { width: l.w, align: 'center', lineBreak: false });
  }
  const PAL: Record<string, [string, string]> = { person: ['#f6fbf7', '#8bc3a3'], system: ['#f5f9fd', '#85abd1'], output: ['#fffbf4', '#d3a96a'], group: ['#faf8fd', '#ad99ca'], resource: ['#f7fafb', '#9cafb8'] };
  for (const n of m.nodes) {
    const p = pos(layout, n.id), w = nodeW(n), [fill, stroke] = PAL[n.kind];
    doc.roundedRect(p.x - w / 2, p.y - NODE_H / 2, w, NODE_H, 13).lineWidth(1.4);
    if (n.scope !== 'internal') doc.dash(6, { space: 4 });
    doc.fillAndStroke(fill, stroke); doc.undash();
    doc.rect(p.x - w / 2, p.y - NODE_H / 2 + 8, 4, NODE_H - 16).fill(stroke);
    const lines = wrapNodeLabel(n.label, 20);
    doc.font(F.b).fontSize(12).fillColor(INK);
    lines.forEach((ln, i) => doc.text(ln, p.x - w / 2 + 14, p.y - (lines.length > 1 ? 24 : 16) + i * 14, { width: w - 20, lineBreak: false }));
    doc.font(F.r).fontSize(8.5).fillColor(MUTED).text(`${n.kind}${n.role ? ` · ${n.role}` : ''}`.slice(0, 30), p.x - w / 2 + 14, p.y + 14, { width: w - 20, lineBreak: false });
    if (n.scope !== 'internal') { doc.roundedRect(p.x - w / 2 + 5, p.y + NODE_H / 2 + 6, 62, 15, 6).lineWidth(0.8).fillAndStroke('#fef7e9', '#dfc79e'); doc.font(F.b).fontSize(7.5).fillColor('#8d6b37').text(n.scope === 'external' ? 'EXTERNAL' : 'CONTEXT', p.x - w / 2 + 5, p.y + NODE_H / 2 + 10, { width: 62, align: 'center', lineBreak: false }); }
  }
  doc.restore();
  let lx = 36; const ly = PH - 52;
  doc.font(F.b).fontSize(8).fillColor(MUTED).text('LEGEND', lx, ly - 12, { lineBreak: false });
  for (const t of EDGE_TYPES) {
    doc.moveTo(lx, ly + 6).lineTo(lx + 26, ly + 6).lineWidth(2.2).strokeColor(TYPE_COLOR[t]);
    if (DASH[t]) doc.dash(DASH[t]![0], { space: DASH[t]![1] }); else doc.undash();
    doc.stroke(); doc.undash();
    doc.font(F.r).fontSize(8.5).fillColor(INK).text(EDGE_TYPE_LABEL[t], lx + 31, ly + 2, { lineBreak: false });
    lx += 46 + doc.widthOfString(EDGE_TYPE_LABEL[t]);
  }
  doc.font(F.r).fontSize(8.5).fillColor(INK).text('Dashed node border + tag = outside the reviewed scope', lx + 6, ly + 2, { lineBreak: false });
  return collect(doc);
}
