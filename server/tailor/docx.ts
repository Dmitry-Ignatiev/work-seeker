import 'server-only';
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from 'docx';
import { linkForTitle, type CvLink } from '@/server/cv/links';
import type { CvStructure } from './types';

/**
 * Renders a tailored CV as an editable DOCX (clean single-column template, right-to-left for Hebrew).
 * Built in memory per download; nothing is stored as a file.
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
function restore(text: string, name: string): string {
  return text.replace(/\[CANDIDATE\]/g, name).replace(/\s*\[(EMAIL|PHONE|URL)\]\s*/g, ' ').trim();
}

const LINK_COLOR = '0563C1';

export async function buildCvDocx({ name, contact, links = [], structure }: DocxInput): Promise<Buffer> {
  const rtl = structure.rtl;
  type RunOptions = { bold?: boolean; size?: number; color?: string; underline?: boolean };
  const text = (value: string, opts: RunOptions = {}) =>
    new TextRun({
      text: restore(value, name),
      rightToLeft: rtl,
      bold: opts.bold,
      size: opts.size,
      color: opts.color,
      underline: opts.underline ? {} : undefined,
    });
  const link = (value: string, url: string, opts: RunOptions = {}) =>
    new ExternalHyperlink({ link: url, children: [text(value, { ...opts, color: LINK_COLOR, underline: true })] });
  const para = (children: ParagraphChild[], extra: Record<string, unknown> = {}) =>
    new Paragraph({ children, bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, ...extra });

  const children: Paragraph[] = [para([text(name, { bold: true, size: 36 })], { spacing: { after: 60 } })];
  if (structure.headline) children.push(para([text(structure.headline, { size: 24, color: '444444' })]));
  if (contact.length > 0) {
    const runs: ParagraphChild[] = [];
    contact.forEach((item, i) => {
      if (i > 0) runs.push(text('  ·  ', { size: 18, color: '666666' }));
      runs.push(item.url ? link(item.text, item.url, { size: 18 }) : text(item.text, { size: 18, color: '666666' }));
    });
    children.push(para(runs, { spacing: { after: 200 } }));
  }

  if (structure.summary) {
    children.push(para([text(rtl ? 'תקציר' : 'Summary', { bold: true })], { heading: HeadingLevel.HEADING_2 }));
    children.push(para([text(structure.summary)], { spacing: { after: 160 } }));
  }

  for (const section of structure.sections) {
    children.push(para([text(section.heading, { bold: true })], { heading: HeadingLevel.HEADING_2, spacing: { before: 200 } }));
    for (const entry of section.entries) {
      const runs: ParagraphChild[] = [];
      const titleLink = linkForTitle(entry.title, links);
      if (entry.title) runs.push(titleLink ? link(entry.title, titleLink.url, { bold: true }) : text(entry.title, { bold: true }));
      if (entry.organization) runs.push(text(`${entry.title ? ', ' : ''}${entry.organization}`, { bold: true }));
      if (entry.dates) runs.push(text(`${runs.length > 0 ? '  |  ' : ''}${entry.dates}`, { color: '666666' }));
      if (runs.length > 0) children.push(para(runs, { spacing: { before: 120 } }));
      for (const bullet of entry.bullets) children.push(para([text(bullet.text)], { bullet: { level: 0 } }));
    }
  }

  if (structure.skills.length > 0) {
    children.push(para([text(rtl ? 'כישורים' : 'Skills', { bold: true })], { heading: HeadingLevel.HEADING_2, spacing: { before: 200 } }));
    children.push(para([text(structure.skills.join(', '))]));
  }

  const doc = new Document({
    creator: 'Work Seeker',
    title: `${name} CV`,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children }],
  });
  return Packer.toBuffer(doc);
}
