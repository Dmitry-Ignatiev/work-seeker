/**
 * Builds a small, valid text PDF (Helvetica, ASCII), one array of lines per page.
 * Used by unit and E2E tests so no binary fixtures live in the repo.
 */
export function makePdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  const escape = (s: string) => s.replace(/[\\()]/g, m => `\\${m}`);
  pages.forEach((lines, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const stream = `BT /F1 11 Tf 14 TL 50 760 Td ${lines.map(l => `(${escape(l)}) Tj T*`).join(' ')} ET`;
    objects[pageId] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
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
