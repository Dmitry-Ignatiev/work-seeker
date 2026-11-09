import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { comparable, paragraphText, type CvLayout } from '@/server/cv/layout';
import { extractPdfText } from '@/server/cv/pdf';
import { plainTextLayout, templateLayout } from '@/server/tailor/fallback-layout';
import { buildLayoutDocx } from '@/server/tailor/layout-docx';
import { buildLayoutPdf, PdfNotSupportedError, standardFamily, toWinAnsi } from '@/server/tailor/layout-pdf';
import { DESIGNED_CV_LINES, makePdf, SAMPLE_CV_LINES } from '../support/make-pdf';

async function layoutOf(pdf: Uint8Array): Promise<CvLayout> {
  const { layout } = await extractPdfText(pdf);
  if (!layout) throw new Error('no layout');
  return layout;
}

const texts = (layout: CvLayout) => layout.paragraphs.map(p => comparable(paragraphText(p)));
const find = (layout: CvLayout, start: string) => layout.paragraphs.find(p => paragraphText(p).startsWith(start))!;

describe('rebuilding a CV as a PDF from its layout', () => {
  it('reads back with the same page size, page count, wording and design', async () => {
    const original = await layoutOf(makePdf([DESIGNED_CV_LINES]));
    const { buffer, unplaced } = await buildLayoutPdf({ layout: original, edits: [] });
    expect(unplaced).toBe(0);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');

    const rebuilt = await layoutOf(new Uint8Array(buffer));
    expect(rebuilt.pageCount).toBe(1);
    expect(rebuilt.page).toMatchObject({ width: 612, height: 792 });
    expect(texts(rebuilt)).toEqual(texts(original));

    const name = find(rebuilt, 'Dana Levi');
    expect(name.align).toBe('center');
    expect(name.runs[0]).toMatchObject({ bold: true, size: 18 });
    expect(find(rebuilt, 'Acme Ltd').aside?.map(r => r.text).join('')).toBe('2021 - present');
    expect(find(rebuilt, 'Built TypeScript').bullet).toBeDefined();
  });

  it('puts the accepted edits in their paragraphs, as the DOCX does', async () => {
    const original = await layoutOf(makePdf([DESIGNED_CV_LINES]));
    const before = 'Designed Node.js APIs backed by PostgreSQL; shipped them with Docker.';
    const after = 'Designed Node.js REST APIs backed by PostgreSQL; shipped them with Docker.';
    const { buffer, unplaced } = await buildLayoutPdf({ layout: original, edits: [{ before, after }, { before: 'Not in this CV at all', after: 'x' }] });
    expect(unplaced).toBe(1); // the caller falls back to the template, so no edit is lost

    const { text } = await extractPdfText(new Uint8Array(buffer));
    expect(text).toContain('Node.js REST APIs');
    expect(text).not.toContain('Node.js APIs backed');
  });

  it('keeps a two-page CV on two pages', async () => {
    const original = await layoutOf(makePdf([DESIGNED_CV_LINES, [{ text: 'Projects', bold: true }, 'Robot arm controller in C++.']]));
    const rebuilt = await layoutOf(new Uint8Array((await buildLayoutPdf({ layout: original, edits: [] })).buffer));
    expect(rebuilt.pageCount).toBe(2);
    expect(find(rebuilt, 'Projects').page).toBe(1);
  });

  it('keeps links clickable', async () => {
    const original = await layoutOf(makePdf([DESIGNED_CV_LINES]));
    const contact = find(original, 'dana.levi@example.com');
    contact.runs = [{ ...contact.runs[0], text: 'dana.levi@example.com', url: 'mailto:dana.levi@example.com' }];
    const { buffer } = await buildLayoutPdf({ layout: original, edits: [] });
    const { links, layout } = await extractPdfText(new Uint8Array(buffer));
    expect(links.map(l => l.url)).toContain('mailto:dana.levi@example.com');
    expect(layout && find(layout, 'dana.levi@example.com').runs[0].url).toBe('mailto:dana.levi@example.com');
  });

  it('makes a plain email address a mailto link in the PDF and the DOCX', async () => {
    const original = await layoutOf(makePdf([DESIGNED_CV_LINES]));
    expect(find(original, 'dana.levi@example.com').runs.some(r => r.url)).toBe(false);
    const { links } = await extractPdfText(new Uint8Array((await buildLayoutPdf({ layout: original, edits: [] })).buffer));
    expect(links.map(l => l.url)).toContain('mailto:dana.levi@example.com');

    const docx = await buildLayoutDocx({ layout: original, edits: [] });
    const zip = await JSZip.loadAsync(docx.buffer);
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('mailto:dana.levi@example.com');
    expect(await zip.file('word/document.xml')!.async('string')).toContain('+972 50 123 4567'); // the rest of the line stays
  });

  it('refuses Hebrew text, which the standard PDF fonts cannot draw', async () => {
    const layout = plainTextLayout('דנה לוי\nמפתחת Full-stack');
    await expect(buildLayoutPdf({ layout, edits: [] })).rejects.toThrow(PdfNotSupportedError);
  });
});

describe('PDF text and fonts', () => {
  it('replaces symbols the standard fonts lack and keeps the ones they have', () => {
    expect(toWinAnsi('React → Next.js')).toBe('React -> Next.js');
    expect(toWinAnsi('● Built “fast” APIs – 40% café')).toBe('• Built “fast” APIs – 40% café');
    expect(toWinAnsi('Dvořák')).toBe('Dvorák'); // ř isn't drawable, á is
    expect(toWinAnsi('a b​c')).toBe('a bc');
  });

  it('picks the closest standard font', () => {
    expect(standardFamily('Arial')).toBe('Helvetica');
    expect(standardFamily('Calibri')).toBe('Helvetica');
    expect(standardFamily('Times New Roman')).toBe('Times');
    expect(standardFamily('Georgia')).toBe('Times');
    expect(standardFamily('Open Sans')).toBe('Helvetica');
    expect(standardFamily('Courier New')).toBe('Courier');
  });
});

describe('layouts for CVs without one', () => {
  it('draws an uploaded CV from its text, with list markers as bullets', async () => {
    const bullets = ['Built TypeScript and React dashboards used by 40,000 customers.', 'Designed Node.js APIs backed by PostgreSQL.'];
    const layout = plainTextLayout(['Dana Levi', '', 'Experience', ...bullets.map(b => `• ${b}`)].join('\n'));
    expect(layout.paragraphs.map(paragraphText)).toEqual(['Dana Levi', 'Experience', ...bullets]);
    expect(layout.paragraphs[1].spaceBefore).toBeGreaterThan(0);
    expect(layout.paragraphs[2].bullet).toBeDefined();

    const { text, pageCount } = await extractPdfText(new Uint8Array((await buildLayoutPdf({ layout, edits: [] })).buffer));
    expect(pageCount).toBe(1);
    expect(text).toContain('Built TypeScript and React dashboards');
  });

  it('draws the template from a CV structure, with the dates on the right', async () => {
    const layout = templateLayout({
      name: 'Dana Levi',
      contact: [{ text: 'dana.levi@example.com', url: 'mailto:dana.levi@example.com' }],
      structure: {
        rtl: false,
        summary: '[CANDIDATE] builds web products.',
        sections: [
          {
            kind: 'EXPERIENCE',
            heading: 'Experience',
            entries: [{ title: 'Senior Developer', organization: 'Acme Ltd', dates: '2021 - present', bullets: [{ id: 'b1', text: SAMPLE_CV_LINES[4] }] }],
          },
        ],
        skills: ['TypeScript', 'React'],
      },
    });
    const { text, layout: read } = await extractPdfText(new Uint8Array((await buildLayoutPdf({ layout, edits: [] })).buffer));
    expect(text).toContain('Dana Levi builds web products.');
    expect(text).toContain(SAMPLE_CV_LINES[4]);
    expect(read && find(read, 'Senior Developer').aside?.map(r => r.text).join('')).toBe('2021 - present');
  });
});
