import 'server-only';
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  LineRuleType,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  type ParagraphChild,
} from 'docx';
import { comparable, paragraphText, stripBullet, type CvLayout, type LayoutParagraph, type LayoutRun } from '@/server/cv/layout';
import { DOCX_SETTINGS } from './docx-settings';

/**
 * Rebuilds the user's own CV as a DOCX from its layout (server/cv/layout.ts): same page size, margins, fonts,
 * sizes, bold/italic, alignment, indents, bullets, right-side dates, spacing, page breaks, links and wording.
 * Only the paragraphs tailoring changed get new text, in their original style.
 */
export interface LayoutDocxInput {
  layout: CvLayout;
  /** Accepted edits; `before` is the CV text as the structure holds it (contact details redacted). */
  edits: { before: string; after: string }[];
  /** The job's exact terms added to the skills list. */
  addedSkills?: string[];
  /** The CV's skills as listed, to find the skills paragraph. */
  skills?: string[];
  /** Turns layout text into the form `before` uses (redaction), for matching. */
  normalize?: (text: string) => string;
  /** Puts the name and the like back into edited text. */
  restore?: (text: string) => string;
}

export interface LayoutDocxResult {
  buffer: Buffer;
  /** Edits that couldn't be matched to a paragraph. The caller falls back to the template when this isn't 0. */
  unplaced: number;
}

const twips = (points: number) => Math.round(points * 20);
const halfPoints = (points: number) => Math.round(points * 2);
const LINK_COLOR = '0563C1';
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Applies the edits to a copy of the paragraphs. */
export function applyEdits(input: LayoutDocxInput): { paragraphs: LayoutParagraph[]; unplaced: number } {
  const normalize = input.normalize ?? ((t: string) => t);
  const restore = input.restore ?? ((t: string) => t);
  const paragraphs: LayoutParagraph[] = input.layout.paragraphs.map(p => ({ ...p, runs: p.runs.map(r => ({ ...r })) }));
  const key = (text: string) => comparable(normalize(text));
  const styleOf = (p: LayoutParagraph): LayoutRun => {
    const run = p.runs.find(r => !r.url && r.text.trim()) ?? p.runs[0];
    return { text: '', font: run.font, size: run.size, bold: run.bold, italic: run.italic };
  };
  const removed = new Set<number>();
  let unplaced = 0;

  for (const edit of input.edits) {
    const wanted = key(edit.before);
    // The layout draws list markers itself.
    const after = stripBullet(restore(edit.after)).trim();
    if (!wanted) continue;

    // 1. One paragraph, or several consecutive ones (a summary split by spacing), that are exactly the text.
    let placed = false;
    for (let i = 0; i < paragraphs.length && !placed; i++) {
      if (removed.has(i)) continue;
      let joined = '';
      for (let j = i; j < paragraphs.length && joined.length < wanted.length; j++) {
        joined += key(paragraphText(paragraphs[j]));
        if (joined === wanted) {
          paragraphs[i] = { ...paragraphs[i], runs: [{ ...styleOf(paragraphs[i]), text: after }] };
          for (let k = i + 1; k <= j; k++) removed.add(k);
          placed = true;
          break;
        }
        if (!wanted.startsWith(joined)) break;
      }
    }
    // 2. Part of a paragraph: replace just that text, keeping the paragraph's other runs.
    if (!placed) {
      const words = stripBullet(edit.before).trim().split(/\s+/).map(escapeRegExp);
      const pattern = new RegExp(words.join('\\s*'), 'i');
      for (let i = 0; i < paragraphs.length && !placed; i++) {
        if (removed.has(i)) continue;
        const p = paragraphs[i];
        const text = normalize(paragraphText(p));
        const match = pattern.exec(text);
        if (!match || p.runs.length !== 1) continue;
        // Single-style paragraph: the replacement can't break run boundaries.
        const original = paragraphText(p);
        if (normalize(original) !== original) continue; // redaction shifted positions: don't guess
        p.runs = [{ ...p.runs[0], text: original.slice(0, match.index) + after + original.slice(match.index + match[0].length) }];
        placed = true;
      }
    }
    if (!placed) unplaced++;
  }

  // Skills the guard added (the job's exact term for something the CV shows): append to the skills line.
  if (input.addedSkills?.length && input.skills?.length) {
    const has = (text: string, skill: string) => comparable(text).includes(comparable(skill));
    let best = -1;
    let bestCount = 0;
    paragraphs.forEach((p, i) => {
      const count = input.skills!.filter(s => has(paragraphText(p), s)).length;
      if (count > bestCount) [best, bestCount] = [i, count];
    });
    if (best >= 0 && bestCount >= 3) {
      const p = paragraphs[best];
      const text = paragraphText(p);
      const separator = text.includes(' · ') ? ' · ' : text.includes('|') ? ' | ' : text.includes(';') ? '; ' : ', ';
      const tail = p.runs.at(-1)!;
      p.runs = [...p.runs, { ...tail, url: undefined, text: `${separator}${input.addedSkills.join(separator)}` }];
    }
  }

  return { paragraphs: paragraphs.filter((_, i) => !removed.has(i)).map(linkEmails), unplaced };
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Email addresses that aren't links yet become mailto: links. A PDF's link often misses the address
 * (an icon beside it shifts the link box), and a mailto link only opens a new message, so it's always safe.
 */
export function linkEmails(p: LayoutParagraph): LayoutParagraph {
  if (!p.runs.some(r => !r.url && r.text.includes('@'))) return p;
  const runs: LayoutRun[] = [];
  for (const run of p.runs) {
    if (run.url) {
      runs.push(run);
      continue;
    }
    let last = 0;
    for (const match of run.text.matchAll(EMAIL)) {
      if (match.index > last) runs.push({ ...run, text: run.text.slice(last, match.index) });
      runs.push({ ...run, text: match[0], url: `mailto:${match[0]}` });
      last = match.index + match[0].length;
    }
    if (last < run.text.length) runs.push({ ...run, text: run.text.slice(last) });
  }
  return { ...p, runs };
}

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

export async function buildLayoutDocx(input: LayoutDocxInput): Promise<LayoutDocxResult> {
  const { layout } = input;
  const { paragraphs, unplaced } = applyEdits(input);
  const contentWidth = layout.page.width - layout.page.marginLeft - layout.page.marginRight;

  // The most common font and size become the document defaults.
  const tally = new Map<string, number>();
  for (const p of layout.paragraphs) for (const r of p.runs) tally.set(`${r.font}|${r.size}`, (tally.get(`${r.font}|${r.size}`) ?? 0) + r.text.length);
  const [defaultFont, defaultSize] = ([...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Calibri|11').split('|');

  const run = (r: LayoutRun): ParagraphChild => {
    const text = new TextRun({
      text: r.text,
      font: r.font,
      size: halfPoints(r.size),
      bold: r.bold,
      italics: r.italic,
      color: r.url ? LINK_COLOR : undefined,
      underline: r.url ? {} : undefined,
    });
    return r.url ? new ExternalHyperlink({ link: r.url, children: [text] }) : text;
  };

  const seenPages = new Set<number>([0]);
  const children = paragraphs.map(p => {
    const kids: ParagraphChild[] = [];
    const tabStops: { type: (typeof TabStopType)[keyof typeof TabStopType]; position: number }[] = [];
    let indent: { left: number; hanging?: number } | undefined;
    if (p.bullet) {
      kids.push(new TextRun({ text: p.bullet.char, font: p.bullet.font, size: halfPoints(p.bullet.size) }), new TextRun({ children: [new Tab()] }));
      indent = { left: twips(p.indent), hanging: twips(Math.max(0, p.indent - p.bullet.at)) };
      tabStops.push({ type: TabStopType.LEFT, position: twips(p.indent) });
    } else if (p.indent > 1.5) {
      indent = { left: twips(p.indent) };
    }
    kids.push(...p.runs.map(run));
    if (p.aside?.length) {
      kids.push(new TextRun({ children: [new Tab()] }), ...p.aside.map(run));
      tabStops.push({ type: TabStopType.RIGHT, position: twips(contentWidth) });
    }
    const newPage = !seenPages.has(p.page);
    seenPages.add(p.page);
    return new Paragraph({
      children: kids,
      alignment: ALIGN[p.align],
      indent,
      tabStops: tabStops.length > 0 ? tabStops : undefined,
      pageBreakBefore: newPage || undefined,
      spacing: { before: twips(p.spaceBefore), after: 0, line: twips(p.lineHeight), lineRule: LineRuleType.EXACT },
    });
  });

  const doc = new Document({
    creator: 'Work Seeker',
    styles: {
      default: {
        document: {
          run: { font: defaultFont, size: halfPoints(Number(defaultSize)) },
          paragraph: { spacing: { before: 0, after: 0 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: twips(layout.page.width), height: twips(layout.page.height) },
            margin: {
              top: twips(layout.page.marginTop),
              bottom: twips(layout.page.marginBottom),
              left: twips(layout.page.marginLeft),
              right: twips(layout.page.marginRight),
            },
          },
        },
        children,
      },
    ],
  });
  return { buffer: await Packer.toBuffer(doc, false, DOCX_SETTINGS), unplaced };
}
