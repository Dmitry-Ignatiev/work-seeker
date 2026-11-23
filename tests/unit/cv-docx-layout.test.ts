import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
import { describe, expect, it } from 'vitest';
import { extractDocxText } from '@/server/cv/docx';

const FILLER = 'Built and shipped web applications end to end with React, Django and PostgreSQL for real users.';

async function wordFile(children: (Paragraph | Table)[]): Promise<Uint8Array> {
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'dots',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [{ properties: { page: { margin: { left: 1440, right: 1440, top: 1080, bottom: 1080 } } }, children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe('extractDocxText layout', () => {
  it("keeps a Word CV's look: name size and bold, headings, dates on the right, bullets, italics, margins", async () => {
    const bytes = await wordFile([
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Dana Levi', bold: true, size: 40 })] }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Experience', bold: true })] }),
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
        children: [new TextRun({ text: 'Data Analyst', bold: true }), new TextRun({ children: [new Tab(), '2022 - Present'] })],
      }),
      new Paragraph({ children: [new TextRun({ text: 'Acme | Tel Aviv', italics: true })] }),
      new Paragraph({ numbering: { reference: 'dots', level: 0 }, children: [new TextRun(FILLER)] }),
    ]);
    const { layout } = await extractDocxText(bytes);
    expect(layout).not.toBeNull();
    const [name, heading, role, company, bullet] = layout!.paragraphs;

    expect(layout!.page.marginLeft).toBe(72);
    expect(name).toMatchObject({ align: 'center', runs: [{ text: 'Dana Levi', bold: true, size: 20 }] });
    expect(heading.runs[0]).toMatchObject({ text: 'Experience', bold: true });
    expect(role.runs).toMatchObject([{ text: 'Data Analyst', bold: true }]);
    expect(role.aside).toMatchObject([{ text: '2022 - Present' }]);
    expect(company.runs[0]).toMatchObject({ text: 'Acme | Tel Aviv', italic: true });
    expect(bullet.bullet).toMatchObject({ char: '•', at: 18 });
    expect(bullet.indent).toBe(36);
  });

  it('leaves side-by-side table columns and Hebrew to the plain fallback', async () => {
    const twoColumns = await wordFile([
      new Table({
        rows: [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph(`Skills ${FILLER}`)] }),
              new TableCell({ children: [new Paragraph(`Experience ${FILLER}`)] }),
            ],
          }),
        ],
      }),
    ]);
    expect((await extractDocxText(twoColumns)).layout).toBeNull();

    const hebrew = await wordFile([new Paragraph('דנה לוי, מפתחת תוכנה'), new Paragraph(FILLER), new Paragraph(FILLER)]);
    expect((await extractDocxText(hebrew)).layout).toBeNull();
  });
});
