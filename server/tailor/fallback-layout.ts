import 'server-only';
import type { CvLayout, LayoutParagraph, LayoutRun } from '@/server/cv/layout';
import { linkForTitle } from '@/server/cv/links';
import { restorePlaceholders, type DocxInput } from './docx';

/**
 * Layouts for CVs whose PDF layout couldn't be read (two columns, older uploads), so they can still be drawn
 * by the layout DOCX and PDF builders. Pure functions.
 */

const A4 = { width: 595.28, height: 841.89 };
const FONT = 'Calibri';
const BODY = 10.5;
const LIST_MARKER = /^\s*[•●▪■◦‣\-–*·○]\s+/;

const paragraph = (runs: LayoutRun[], extra: Partial<LayoutParagraph> = {}): LayoutParagraph => ({
  page: 0,
  runs,
  align: 'left',
  indent: 0,
  spaceBefore: 0,
  lineHeight: BODY * 1.3,
  lines: 1,
  lineCapacity: 100,
  ...extra,
});

const run = (text: string, extra: Partial<LayoutRun> = {}): LayoutRun => ({ text, font: FONT, size: BODY, ...extra });

const page = (marginSide: number) => ({
  ...A4,
  marginTop: 50,
  marginBottom: 50,
  marginLeft: marginSide,
  marginRight: marginSide,
});

/** The CV's own text, line by line: list markers become bullets, blank lines become space. */
export function plainTextLayout(text: string): CvLayout {
  const paragraphs: LayoutParagraph[] = [];
  let gap = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      gap = 8;
      continue;
    }
    const marker = LIST_MARKER.exec(line);
    paragraphs.push(
      marker
        ? paragraph([run(line.slice(marker[0].length))], {
            spaceBefore: gap,
            indent: 14,
            bullet: { char: '•', at: 3, font: FONT, size: BODY },
          })
        : paragraph([run(line)], { spaceBefore: gap }),
    );
    gap = 0;
  }
  // Hebrew text: right-aligned (the PDF builder refuses it; the DOCX keeps it).
  const rtl = /[֐-׿]/.test(text);
  if (rtl) for (const p of paragraphs) p.align = 'right';
  return { version: 1, page: page(54), pageCount: 1, rtl, paragraphs };
}

/** The clean template (server/tailor/docx.ts) as a layout: name, contact row, sections, entries, skills. */
export function templateLayout({ name, contact, links = [], structure }: DocxInput): CvLayout {
  const text = (value: string) => restorePlaceholders(value, name);
  const heading = (title: string) => paragraph([run(title.toUpperCase(), { bold: true, size: 11 })], { spaceBefore: 12, lineHeight: 16 });
  const paragraphs: LayoutParagraph[] = [paragraph([run(name, { bold: true, size: 22 })], { lineHeight: 28 })];

  if (structure.headline) paragraphs.push(paragraph([run(text(structure.headline), { size: 11.5 })], { lineHeight: 16 }));
  if (contact.length > 0) {
    const runs: LayoutRun[] = [];
    contact.forEach((item, i) => {
      if (i > 0) runs.push(run('  |  ', { size: 9.5 }));
      runs.push(run(item.text, { size: 9.5, url: item.url }));
    });
    paragraphs.push(paragraph(runs, { spaceBefore: 2, lineHeight: 14 }));
  }
  if (structure.summary) {
    paragraphs.push(heading('Summary'), paragraph([run(text(structure.summary))], { align: 'justify' }));
  }
  for (const section of structure.sections) {
    paragraphs.push(heading(section.heading));
    for (const entry of section.entries) {
      const runs: LayoutRun[] = [];
      const titleLink = linkForTitle(entry.title, links);
      if (entry.title) runs.push(run(text(entry.title), { bold: true, url: titleLink?.url }));
      if (entry.organization) runs.push(run(`${entry.title ? ' · ' : ''}${text(entry.organization)}`, { bold: !entry.title }));
      if (runs.length > 0 || entry.dates) {
        paragraphs.push(
          paragraph(runs.length > 0 ? runs : [run('')], {
            spaceBefore: 5,
            aside: entry.dates ? [run(text(entry.dates), { size: 10 })] : undefined,
          }),
        );
      }
      for (const bullet of entry.bullets) {
        paragraphs.push(paragraph([run(text(bullet.text))], { indent: 15, bullet: { char: '•', at: 4, font: FONT, size: BODY } }));
      }
    }
  }
  if (structure.skills.length > 0) paragraphs.push(heading('Skills'), paragraph([run(structure.skills.join('  ·  '))]));

  return { version: 1, page: page(43), pageCount: 1, rtl: structure.rtl, paragraphs };
}
