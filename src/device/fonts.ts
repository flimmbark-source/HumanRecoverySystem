// The PDF fonts (src/server/reports/fonts.ts) for the device build: the same DejaVu files, bundled as assets.
// pdfkit registers fonts synchronously, so the worker loads the files once when it starts.
import regularUrl from '../../assets/fonts/DejaVuSans.ttf?url';
import boldUrl from '../../assets/fonts/DejaVuSans-Bold.ttf?url';

let regular: ArrayBuffer | null = null, bold: ArrayBuffer | null = null;

export async function loadFonts() {
  [regular, bold] = await Promise.all([regularUrl, boldUrl].map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load the PDF font (${res.status}).`);
    return res.arrayBuffer();
  }));
}

export const F = { r: 'Weave', b: 'Weave-Bold', i: 'Weave-Oblique' };
export function fonts(doc: PDFKit.PDFDocument) {
  if (!regular || !bold) throw new Error('The PDF fonts are not loaded.');
  doc.registerFont('Weave', regular);
  doc.registerFont('Weave-Bold', bold);
  // No oblique file is bundled. The server uses the regular face in that case too.
  doc.registerFont('Weave-Oblique', regular);
}
/** The bundled font covers every character the PDFs use. */
export const plain = <T>(value: T): T => value;
