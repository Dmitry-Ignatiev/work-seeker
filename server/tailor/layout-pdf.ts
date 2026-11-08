import 'server-only';
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSqueeze,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import type { LayoutParagraph, LayoutRun } from '@/server/cv/layout';
import { applyEdits, type LayoutDocxInput, type LayoutDocxResult } from './layout-docx';

/**
 * Rebuilds a CV as a PDF from its layout (server/cv/layout.ts), the same way the DOCX is rebuilt: page size,
 * margins, sizes, bold/italic, alignment, indents, bullets, right-side dates, spacing, page breaks and links,
 * with the accepted edits placed exactly as in the DOCX. Uses the PDF standard fonts (the closest of
 * Helvetica, Times and Courier), so text outside the Western character set can't be drawn. A standard font can
 * be wider than the CV's own (Helvetica vs Calibri), so a paragraph that would take more lines than in the
 * original is narrowed slightly (to MIN_SQUEEZE at most) to keep its line breaks and the page count.
 */

/** Text a standard-font PDF can't draw (Hebrew): the caller offers the DOCX instead. */
export class PdfNotSupportedError extends Error {
  constructor() {
    super('PDF download is not available for this CV.');
    this.name = 'PdfNotSupportedError';
  }
}

type Family = 'Helvetica' | 'Times' | 'Courier';

/** The standard PDF font closest to the CV's font. */
export function standardFamily(font: string): Family {
  if (/courier|mono|consolas|menlo/i.test(font)) return 'Courier';
  if (/sans/i.test(font)) return 'Helvetica';
  if (/times|georgia|garamond|cambria|book|palatino|serif|minion|baskerville|caslon|constantia/i.test(font)) return 'Times';
  return 'Helvetica';
}

const STANDARD: Record<Family, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

// The characters the standard fonts' WinAnsi encoding has beyond Latin-1.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACEMENTS: Record<string, string> = {
  ' ': ' ',
  ' ': ' ',
  '​': '',
  '‎': '',
  '‏': '',
  '﻿': '',
  '\t': ' ',
  '→': '->',
  '←': '<-',
  '●': '•',
  '▪': '•',
  '■': '•',
  '◦': '•',
  '‣': '•',
  '○': '•',
  '': '•',
  '': '•',
  '➢': '>',
  '►': '>',
  '▸': '>',
  '✓': '-',
  '−': '-',
  '‐': '-',
  '‑': '-',
  '′': "'",
  '″': '"',
};

const drawable = (ch: string) => {
  const code = ch.codePointAt(0)!;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch);
};

/** Text the standard fonts can draw: known symbols replaced, accents dropped where needed (č → c). */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch in REPLACEMENTS) out += REPLACEMENTS[ch];
    else if (drawable(ch)) out += ch;
    else {
      const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += [...plain].every(drawable) ? plain : '?';
    }
  }
  return out;
}

const HEBREW = /[֐-׿]/;
const LINK_COLOR = rgb(0x05 / 255, 0x63 / 255, 0xc1 / 255);
const SAFE_URL = /^(https?:|mailto:)/i;
const MIN_SQUEEZE = 0.86;

interface Piece {
  text: string;
  font: PDFFont;
  size: number;
  width: number;
  space: boolean;
  url?: string;
}

export async function buildLayoutPdf(input: LayoutDocxInput & { title?: string }): Promise<LayoutDocxResult> {
  const { layout } = input;
  const { paragraphs, unplaced } = applyEdits(input);
  if (layout.rtl || paragraphs.some(p => p.runs.some(r => HEBREW.test(r.text)))) throw new PdfNotSupportedError();

  const doc = await PDFDocument.create();
  doc.setCreator('Work Seeker');
  doc.setProducer('Work Seeker');
  if (input.title) doc.setTitle(input.title);

  const fonts = new Map<string, PDFFont>();
  const fontFor = async (run: { font: string; bold?: boolean; italic?: boolean }) => {
    const family = standardFamily(run.font);
    const variant = (run.bold ? 1 : 0) + (run.italic ? 2 : 0);
    const key = `${family}${variant}`;
    if (!fonts.has(key)) fonts.set(key, await doc.embedFont(STANDARD[family][variant]));
    return fonts.get(key)!;
  };

  const { width: pageWidth, height: pageHeight, marginTop, marginBottom, marginLeft, marginRight } = layout.page;
  const contentWidth = pageWidth - marginLeft - marginRight;
  let page: PDFPage = doc.addPage([pageWidth, pageHeight]);
  let top = pageHeight - marginTop;
  const newPage = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    top = pageHeight - marginTop;
  };

  const piecesOf = async (runs: LayoutRun[]): Promise<Piece[]> => {
    const pieces: Piece[] = [];
    for (const run of runs) {
      const font = await fontFor(run);
      const url = run.url && SAFE_URL.test(run.url) ? run.url : undefined;
      for (const token of toWinAnsi(run.text).split(/(\s+)/)) {
        if (!token) continue;
        const space = /^\s+$/.test(token);
        const text = space ? ' ' : token;
        pieces.push({ text, font, size: run.size, width: font.widthOfTextAtSize(text, run.size), space, url });
      }
    }
    return pieces;
  };

  /** Greedy line breaking; the first line can be shorter (room for the dates on the right). */
  const breakLines = (pieces: Piece[], firstWidth: number, width: number): Piece[][] => {
    const lines: Piece[][] = [[]];
    let used = 0;
    for (const piece of pieces) {
      const limit = lines.length === 1 ? firstWidth : width;
      const line = lines.at(-1)!;
      if (piece.space) {
        if (line.length > 0) {
          line.push(piece);
          used += piece.width;
        }
        continue;
      }
      if (used + piece.width > limit + 0.01 && line.some(p => !p.space)) {
        while (line.at(-1)?.space) line.pop();
        lines.push([piece]);
        used = piece.width;
      } else {
        line.push(piece);
        used += piece.width;
      }
    }
    const last = lines.at(-1)!;
    while (last.at(-1)?.space) last.pop();
    return lines;
  };

  const addLink = (x1: number, y1: number, x2: number, y2: number, url: string) => {
    const annot = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [x1, y1, x2, y2],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
      }),
    );
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (annots instanceof PDFArray) annots.push(annot);
    else page.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
  };

  /** Draws pieces from x on the baseline; `gap` is extra width per space (justified text), `squeeze` narrows letters. */
  const drawPieces = (pieces: Piece[], x: number, baseline: number, gap = 0, squeeze = 1) => {
    for (const piece of pieces) {
      const width = piece.width * squeeze + (piece.space ? gap : 0);
      if (!piece.space) {
        if (squeeze < 1) page.pushOperators(pushGraphicsState(), setCharacterSqueeze(squeeze * 100));
        page.drawText(piece.text, { x, y: baseline, size: piece.size, font: piece.font, color: piece.url ? LINK_COLOR : undefined });
        if (squeeze < 1) page.pushOperators(popGraphicsState());
      }
      if (piece.url) {
        page.drawLine({ start: { x, y: baseline - 1.2 }, end: { x: x + width, y: baseline - 1.2 }, thickness: 0.5, color: LINK_COLOR });
        addLink(x, baseline - 2, x + width, baseline + piece.size * 0.8, piece.url);
      }
      x += width;
    }
  };
  const widthOf = (pieces: Piece[]) => pieces.reduce((sum, p) => sum + p.width, 0);

  let previousPage = paragraphs[0]?.page ?? 0;
  for (const p of paragraphs as LayoutParagraph[]) {
    if (p.page !== previousPage && top < pageHeight - marginTop) newPage(); // the original started a new page here
    previousPage = p.page;
    top -= p.spaceBefore;

    const textLeft = marginLeft + Math.max(0, p.indent);
    const textWidth = contentWidth - Math.max(0, p.indent);
    const aside = p.aside?.length ? await piecesOf(p.aside) : [];
    const asideWidth = widthOf(aside);
    const pieces = await piecesOf(p.runs);
    const firstWidth = textWidth - (asideWidth ? asideWidth + 8 : 0);
    let squeeze = 1;
    let lines = breakLines(pieces, firstWidth, textWidth);
    while (lines.length > Math.max(1, p.lines) && squeeze > MIN_SQUEEZE + 0.001) {
      squeeze = Math.max(MIN_SQUEEZE, squeeze - 0.02);
      lines = breakLines(pieces, firstWidth / squeeze, textWidth / squeeze);
    }
    const lineHeight = Math.max(p.lineHeight, 1);

    for (const [i, line] of lines.entries()) {
      if (top - lineHeight < marginBottom - 0.5 && top < pageHeight - marginTop) newPage();
      const baseline = top - lineHeight * 0.78;
      const width = widthOf(line) * squeeze;
      let x = textLeft;
      let gap = 0;
      if (p.align === 'center') x = textLeft + (textWidth - width) / 2;
      else if (p.align === 'right') x = textLeft + textWidth - width;
      else if (p.align === 'justify' && i < lines.length - 1) {
        const spaces = line.filter(piece => piece.space).length;
        if (spaces > 0) gap = Math.max(0, (textWidth - (i === 0 && asideWidth ? asideWidth + 8 : 0) - width) / spaces);
      }

      if (i === 0 && p.bullet) {
        const font = await fontFor({ font: p.bullet.font });
        const char = toWinAnsi(p.bullet.char).trim() || '•';
        page.drawText(char === '?' ? '•' : char, { x: marginLeft + p.bullet.at, y: baseline, size: p.bullet.size, font });
      }
      drawPieces(line, x, baseline, gap, squeeze);
      if (i === 0 && aside.length) drawPieces(aside, marginLeft + contentWidth - asideWidth, baseline);
      top -= lineHeight;
    }
  }

  return { buffer: Buffer.from(await doc.save()), unplaced };
}
