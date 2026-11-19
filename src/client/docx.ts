// Reads the text of a Word (.docx) file in the browser or the phone app, without a library: a .docx is a zip
// holding word/document.xml. Paragraphs become lines, list items become "- " lines so they split as bullets.

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The bytes of one file inside a zip archive, or null. Handles stored and deflated entries. */
async function unzipEntry(zip: Uint8Array, name: string): Promise<Uint8Array | null> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory: search backwards for its signature.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file is not a Word document.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const entry = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (entry === name) {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const raw = zip.subarray(start, start + size);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new Error('This Word document uses a compression the app cannot read.');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : ENTITIES[e] ?? m));

/** Plain text from word/document.xml: one line per paragraph, "- " before list items, blank lines kept. */
export function docxXmlToText(xml: string): string {
  const body = xml.replace(/<w:(?:del|instrText)\b[\s\S]*?<\/w:(?:del|instrText)>/g, '');
  const lines: string[] = [];
  for (const m of body.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const p = m[1] ?? '';
    let text = '';
    for (const t of p.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>/g)) text += t[1] !== undefined ? decode(t[1]) : t[0].startsWith('<w:tab') ? '\t' : '\n';
    const list = /<w:numPr>/.test(p), heading = /<w:pStyle w:val="(?:Heading\d|Title|Subtitle)"/i.test(p);
    lines.push(heading && text.trim() ? `# ${text.trim()}` : list && text.trim() ? `- ${text.trim()}` : text.replace(/\s+$/, ''));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function readDocx(file: Blob): Promise<string> {
  const xml = await unzipEntry(new Uint8Array(await file.arrayBuffer()), 'word/document.xml');
  if (!xml) throw new Error('This file is not a Word document.');
  return docxXmlToText(new TextDecoder().decode(xml));
}

/** Text from a pasted or opened file: .docx through the reader above, anything else as UTF-8 text. */
export async function readNotesFile(file: File): Promise<string> {
  if (/\.docx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return readDocx(file);
  if (/\.doc$/i.test(file.name)) throw new Error('Old .doc files cannot be read. Save it as .docx or .txt in Word, or copy and paste the text.');
  if (/\.pdf$/i.test(file.name)) throw new Error('PDFs cannot be read yet. Copy the text and paste it here.');
  return (await file.text()).replace(/\r\n?/g, '\n');
}
