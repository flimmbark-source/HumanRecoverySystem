// Fonts for the PDFs, read from assets/fonts. The device build has its own version of this module.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A bundled Unicode font is registered, so text in any Latin, Greek or Cyrillic script
// (and symbols such as the minus sign and arrows) renders correctly. Without the files the built-in fonts are used.
const here = path.dirname(fileURLToPath(import.meta.url));
const fontDir = [path.resolve('assets/fonts'), path.resolve(here, '../../assets/fonts'), path.resolve(here, '../../../assets/fonts')].find((d) => existsSync(path.join(d, 'DejaVuSans.ttf')));
// pdfkit caches its built-in Helvetica under that name, so the bundled font gets names of its own.
export const F = fontDir ? { r: 'Weave', b: 'Weave-Bold', i: 'Weave-Oblique' } : { r: 'Helvetica', b: 'Helvetica-Bold', i: 'Helvetica-Oblique' };
export function fonts(doc: PDFKit.PDFDocument) {
  if (!fontDir) return;
  const oblique = existsSync(path.join(fontDir, 'DejaVuSans-Oblique.ttf')) ? 'DejaVuSans-Oblique.ttf' : 'DejaVuSans.ttf';
  doc.registerFont('Weave', path.join(fontDir, 'DejaVuSans.ttf'));
  doc.registerFont('Weave-Bold', path.join(fontDir, 'DejaVuSans-Bold.ttf'));
  doc.registerFont('Weave-Oblique', path.join(fontDir, oblique));
}
/** With the built-in fonts only, characters outside WinAnsi would print as garbage; map the ones this app emits. */
export function plain<T>(value: T): T {
  if (fontDir) return value;
  return JSON.parse(JSON.stringify(value).replace(/\u2212|−/g, '-').replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=')) as T;
}
