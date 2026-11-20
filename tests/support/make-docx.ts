import { Document, ExternalHyperlink, Header, Packer, Paragraph, TextRun } from 'docx';

/**
 * Builds a small Word (.docx) CV: optional page-header lines, body lines, and links on chosen body lines.
 * Used by unit and E2E tests so no binary fixtures live in the repo.
 */
export async function makeDocx(
  lines: string[],
  { header = [], links = [] }: { header?: string[]; links?: { line: number; url: string }[] } = {},
): Promise<Uint8Array> {
  const paragraph = (text: string, i?: number) => {
    const link = i === undefined ? undefined : links.find(l => l.line === i);
    return new Paragraph({
      children: link ? [new ExternalHyperlink({ link: link.url, children: [new TextRun(text)] })] : [new TextRun(text)],
    });
  };
  const doc = new Document({
    sections: [
      {
        headers: header.length ? { default: new Header({ children: header.map(text => paragraph(text)) }) } : undefined,
        children: lines.map(paragraph),
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
