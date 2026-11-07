/** A clickable link over a whole line of text: `line` is the 0-based line index on page `page` (0-based). */
export interface PdfLink {
  page: number;
  line: number;
  url: string;
}

/** A line of text: plain (left, 11 pt Helvetica), or styled. `aside` is put flush right on the same line. */
export type PdfLine =
  | string
  | { text: string; center?: boolean; bold?: boolean; size?: number; indent?: number; aside?: string; bullet?: boolean };

const LEFT = 50;
const RIGHT = 562;
/** Helvetica averages about half an em per character: close enough to place centered and right-side text. */
const textWidth = (text: string, size: number) => text.length * size * 0.5;

/**
 * Builds a small, valid text PDF (Helvetica, ASCII), one array of lines per page, optionally with link
 * annotations over chosen lines. Used by unit and E2E tests so no binary fixtures live in the repo.
 */
export function makePdf(pages: PdfLine[][], links: PdfLink[] = []): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  let nextId = 5 + pages.length * 2;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  const escape = (s: string) => s.replace(/[\\()]/g, m => `\\${m}`);
  pages.forEach((lines, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const ops: string[] = [];
    lines.forEach((raw, n) => {
      const line = typeof raw === 'string' ? { text: raw } : raw;
      const size = line.size ?? 11;
      const font = line.bold ? '/F2' : '/F1';
      const y = 760 - 14 * n;
      let x = line.center ? (612 - textWidth(line.text, size)) / 2 : LEFT + (line.indent ?? 0);
      if (line.bullet) {
        // A separate bullet glyph, with the text indented after it (as Word exports lists).
        ops.push(`BT /F1 ${size} Tf ${x.toFixed(1)} ${y} Td (-) Tj ET`);
        x += 14;
      }
      ops.push(`BT ${font} ${size} Tf ${x.toFixed(1)} ${y} Td (${escape(line.text)}) Tj ET`);
      if (line.aside) ops.push(`BT /F1 ${size} Tf ${(RIGHT - textWidth(line.aside, size)).toFixed(1)} ${y} Td (${escape(line.aside)}) Tj ET`);
    });
    const stream = ops.join('\n');
    const annotIds = links
      .filter(link => link.page === i)
      .map(link => {
        const id = nextId++;
        const baseline = 760 - 14 * link.line;
        const raw = lines[link.line];
        const text = typeof raw === 'string' ? raw : raw.text;
        // Helvetica 11 pt is about 6 pt per character: wide enough to cover the line.
        const width = Math.ceil(text.length * 6.2);
        objects[id] =
          `<< /Type /Annot /Subtype /Link /Rect [48 ${baseline - 3} ${50 + width} ${baseline + 10}] /Border [0 0 0] ` +
          `/A << /S /URI /URI (${escape(link.url)}) >> >>`;
        return id;
      });
    const annots = annotIds.length > 0 ? ` /Annots [${annotIds.map(id => `${id} 0 R`).join(' ')}]` : '';
    objects[pageId] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R${annots} >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/** A one-page CV with known skills: TypeScript, React, Node.js, PostgreSQL, Docker. */
export const SAMPLE_CV_LINES = [
  'Dana Levi - Full-stack developer',
  'dana.levi@example.com | +972 50 123 4567',
  'Experience',
  'Acme Ltd, Senior Developer, 2021 - present',
  'Built TypeScript and React dashboards used by 40,000 customers.',
  'Designed Node.js APIs backed by PostgreSQL; shipped them with Docker.',
  'Education',
  'B.Sc. Computer Science, Tel Aviv University, 2018',
];

/** The same CV with a designed layout: centered bold name and contact row, dated entries, bullets. */
export const DESIGNED_CV_LINES: PdfLine[] = [
  { text: 'Dana Levi', center: true, bold: true, size: 18 },
  { text: 'dana.levi@example.com | +972 50 123 4567', center: true },
  '',
  { text: 'Experience', bold: true },
  { text: 'Acme Ltd, Senior Developer', bold: true, aside: '2021 - present' },
  { text: 'Built TypeScript and React dashboards used by 40,000 customers.', indent: 10, bullet: true },
  { text: 'Designed Node.js APIs backed by PostgreSQL; shipped them with Docker.', indent: 10, bullet: true },
  '',
  { text: 'Education', bold: true },
  { text: 'B.Sc. Computer Science, Tel Aviv University', aside: '2018' },
];
