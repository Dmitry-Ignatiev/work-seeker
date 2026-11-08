import 'server-only';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  type ParagraphChild,
} from 'docx';
import { DOCX_SETTINGS } from './docx-settings';
import { linkForTitle, type CvLink } from '@/server/cv/links';
import type { CvStructure } from './types';

/**
 * Renders a tailored CV as an editable DOCX: a clean single-column layout that ATS systems read well,
 * right-to-left for Hebrew. Built in memory per download; nothing is stored as a file.
 */
export interface ContactItem {
  text: string;
  /** Makes the item clickable (mailto: for the email, the profile address for LinkedIn and others). */
  url?: string;
}

export interface DocxInput {
  name: string;
  contact: ContactItem[];
  /** Links read from the original PDF: a project title that was a link stays one. */
  links?: CvLink[];
  structure: CvStructure;
}

/** Puts the real name back where redaction left "[CANDIDATE]"; drops other redaction markers. */
export function restorePlaceholders(text: string, name: string): string {
  return text.replace(/\[CANDIDATE\]/g, name).replace(/\s*\[(EMAIL|PHONE|URL)\]\s*/g, ' ').trim();
}

// A4 with 0.6" side margins; sizes are in half-points, distances in twentieths of a point.
const PAGE_WIDTH = 11906;
const SIDE_MARGIN = 864;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * SIDE_MARGIN;
const FONT = 'Calibri';
const BODY_SIZE = 21; // 10.5 pt
const ACCENT = '1F3864'; // dark navy: name, section titles, links
const MUTED = '595959';
const BULLETS = 'cv-bullets';

export async function buildCvDocx({ name, contact, links = [], structure }: DocxInput): Promise<Buffer> {
  const rtl = structure.rtl;
  const align = rtl ? AlignmentType.RIGHT : AlignmentType.LEFT;
  type RunOptions = { bold?: boolean; italics?: boolean; size?: number; color?: string; underline?: boolean };
  const text = (value: string, opts: RunOptions = {}) =>
    new TextRun({
      text: restorePlaceholders(value, name),
      rightToLeft: rtl,
      bold: opts.bold,
      italics: opts.italics,
      size: opts.size,
      sizeComplexScript: opts.size,
      color: opts.color,
      underline: opts.underline ? {} : undefined,
    });
  const link = (value: string, url: string, opts: RunOptions = {}) =>
    new ExternalHyperlink({ link: url, children: [text(value, { ...opts, color: ACCENT, underline: true })] });
  const para = (children: ParagraphChild[], extra: Record<string, unknown> = {}) =>
    new Paragraph({ children, bidirectional: rtl, alignment: align, ...extra });
  const sectionTitle = (title: string) =>
    new Paragraph({ heading: HeadingLevel.HEADING_2, bidirectional: rtl, alignment: align, children: [text(title)] });

  const children: Paragraph[] = [];

  // Header: name, headline, contact row.
  children.push(para([text(name, { bold: true, size: 44, color: ACCENT })], { spacing: { after: 40 } }));
  if (structure.headline) children.push(para([text(structure.headline, { size: 23, color: MUTED })], { spacing: { after: 60 } }));
  if (contact.length > 0) {
    const runs: ParagraphChild[] = [];
    contact.forEach((item, i) => {
      if (i > 0) runs.push(text('  |  ', { size: 19, color: 'A6A6A6' }));
      runs.push(item.url ? link(item.text, item.url, { size: 19 }) : text(item.text, { size: 19, color: MUTED }));
    });
    children.push(para(runs, { spacing: { after: 120 } }));
  }

  if (structure.summary) {
    children.push(sectionTitle(rtl ? 'תקציר' : 'Summary'));
    children.push(para([text(structure.summary)], { spacing: { after: 60 }, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.JUSTIFIED }));
  }

  for (const section of structure.sections) {
    children.push(sectionTitle(section.heading));
    for (const entry of section.entries) {
      const runs: ParagraphChild[] = [];
      const titleLink = linkForTitle(entry.title, links);
      if (entry.title) runs.push(titleLink ? link(entry.title, titleLink.url, { bold: true }) : text(entry.title, { bold: true }));
      if (entry.organization) runs.push(text(`${entry.title ? ' · ' : ''}${entry.organization}`, { bold: !entry.title }));
      if (entry.dates) {
        // Left-to-right: dates flush right on the same line. Right-to-left: after a separator.
        if (rtl) runs.push(text(`${runs.length > 0 ? '  |  ' : ''}${entry.dates}`, { color: MUTED }));
        else runs.push(new TextRun({ children: [new Tab(), restorePlaceholders(entry.dates, name)], color: MUTED, size: 20 }));
      }
      if (runs.length > 0) {
        children.push(
          para(runs, {
            spacing: { before: 100, after: 30 },
            keepNext: entry.bullets.length > 0,
            tabStops: rtl ? undefined : [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
          }),
        );
      }
      entry.bullets.forEach((bullet, i) =>
        children.push(
          para([text(bullet.text)], {
            numbering: { reference: BULLETS, level: 0 },
            spacing: { after: 30 },
            keepNext: i < entry.bullets.length - 1 && entry.bullets.length <= 3,
          }),
        ),
      );
    }
  }

  if (structure.skills.length > 0) {
    children.push(sectionTitle(rtl ? 'כישורים' : 'Skills'));
    children.push(para([text(structure.skills.join('  ·  '))]));
  }

  const doc = new Document({
    creator: 'Work Seeker',
    title: `${name} CV`,
    styles: {
      default: {
        document: { run: { font: FONT, size: BODY_SIZE, sizeComplexScript: BODY_SIZE }, paragraph: { spacing: { line: 252 } } },
        heading2: {
          run: { font: FONT, size: 22, bold: true, allCaps: !rtl, color: ACCENT, characterSpacing: 10 },
          paragraph: {
            spacing: { before: 220, after: 80 },
            keepNext: true,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 2 } },
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: align,
              style: { paragraph: { indent: { left: 300, hanging: 220 } }, run: { color: ACCENT } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: { size: { width: PAGE_WIDTH, height: 16838 }, margin: { top: 720, bottom: 720, left: SIDE_MARGIN, right: SIDE_MARGIN } },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc, false, DOCX_SETTINGS);
}
