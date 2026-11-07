import 'server-only';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { CvStructure } from './types';

/**
 * Renders a tailored CV as an editable DOCX (clean single-column template, right-to-left for Hebrew).
 * Built in memory per download; nothing is stored as a file.
 */
export interface DocxInput {
  name: string;
  contact: string[];
  structure: CvStructure;
}

/** Puts the real name back where redaction left "[CANDIDATE]"; drops other redaction markers. */
function restore(text: string, name: string): string {
  return text.replace(/\[CANDIDATE\]/g, name).replace(/\s*\[(EMAIL|PHONE|URL)\]\s*/g, ' ').trim();
}

export async function buildCvDocx({ name, contact, structure }: DocxInput): Promise<Buffer> {
  const rtl = structure.rtl;
  const text = (value: string, opts: { bold?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({ text: restore(value, name), rightToLeft: rtl, bold: opts.bold, size: opts.size, color: opts.color });
  const para = (children: TextRun[], extra: Record<string, unknown> = {}) =>
    new Paragraph({ children, bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, ...extra });

  const children: Paragraph[] = [para([text(name, { bold: true, size: 36 })], { spacing: { after: 60 } })];
  if (structure.headline) children.push(para([text(structure.headline, { size: 24, color: '444444' })]));
  if (contact.length > 0) children.push(para([text(contact.join('  ·  '), { size: 18, color: '666666' })], { spacing: { after: 200 } }));

  if (structure.summary) {
    children.push(para([text(rtl ? 'תקציר' : 'Summary', { bold: true })], { heading: HeadingLevel.HEADING_2 }));
    children.push(para([text(structure.summary)], { spacing: { after: 160 } }));
  }

  for (const section of structure.sections) {
    children.push(para([text(section.heading, { bold: true })], { heading: HeadingLevel.HEADING_2, spacing: { before: 200 } }));
    for (const entry of section.entries) {
      const head = [entry.title, entry.organization].filter(Boolean).join(rtl ? ', ' : ', ');
      if (head || entry.dates) {
        const runs = [text(head, { bold: true })];
        if (entry.dates) runs.push(text(`${head ? '  |  ' : ''}${entry.dates}`, { color: '666666' }));
        children.push(para(runs, { spacing: { before: 120 } }));
      }
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
