/**
 * The page layout of an uploaded CV, read from the PDF by code: page size, margins, and every paragraph
 * with its fonts, sizes, bold/italic, alignment, indent, bullet, right-side text (dates), spacing and links.
 * Tailored DOCX files are rebuilt from it, so they keep the user's own design, wording and page count.
 * Stored as JSON next to the CV text (the file itself is never kept). Pure functions, unit tested.
 */

/** One run of text, positioned by the PDF reader (points, origin bottom-left). */
export interface LayoutItem {
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
  rtl: boolean;
  url?: string;
}

export interface LayoutPage {
  width: number;
  height: number;
  items: LayoutItem[];
}

export interface LayoutRun {
  text: string;
  font: string;
  /** Points. */
  size: number;
  bold?: boolean;
  italic?: boolean;
  url?: string;
}

export interface LayoutParagraph {
  /** 0-based page of the PDF it starts on; the first paragraph of a later page starts a new page. */
  page: number;
  runs: LayoutRun[];
  /** Text pushed to the far edge on the paragraph's first line (usually dates). */
  aside?: LayoutRun[];
  align: 'left' | 'center' | 'right' | 'justify';
  /** Points from the left margin to where the text starts. */
  indent: number;
  /** A bullet glyph before the text, at `at` points from the left margin. */
  bullet?: { char: string; at: number; font: string; size: number };
  /** Points of extra space above the paragraph. */
  spaceBefore: number;
  /** Baseline-to-baseline distance in points. */
  lineHeight: number;
  /** Lines the paragraph took in the original. */
  lines: number;
  /** About how many characters fit on one of its lines (for "no longer than the original" checks). */
  lineCapacity: number;
}

export interface CvLayout {
  version: 1;
  page: { width: number; height: number; marginTop: number; marginBottom: number; marginLeft: number; marginRight: number };
  pageCount: number;
  rtl: boolean;
  paragraphs: LayoutParagraph[];
}

export type LayoutResult = { layout: CvLayout } | { layout: null; reason: 'EMPTY' | 'MULTI_COLUMN' | 'RTL' };

const BULLET_CHARS = new Set(['•', '●', '▪', '■', '◦', '‣', '–', '-', '*', '·', '○', '➢', '►', '▸', '✓', '', '']);

interface Line {
  page: number;
  y: number;
  items: LayoutItem[];
  runs: LayoutRun[];
  aside?: LayoutRun[];
  bullet?: { char: string; x: number; font: string; size: number };
  start: number;
  end: number;
  size: number;
  rtl: boolean;
  chars: number;
}

/** "BCDEEE+Calibri-Bold" → "Calibri"; "TimesNewRomanPSMT" → "Times New Roman"; "ArialMT" → "Arial". */
export function fontFamily(pdfName: string): string {
  let name = pdfName.replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0];
  name = name.replace(/(PSMT|MT|PS)$/, '');
  const known: Record<string, string> = {
    Helvetica: 'Arial',
    TimesNewRoman: 'Times New Roman',
    Times: 'Times New Roman',
    CourierNew: 'Courier New',
    Courier: 'Courier New',
    TrebuchetMS: 'Trebuchet MS',
    Trebuchet: 'Trebuchet MS',
    SegoeUI: 'Segoe UI',
    OpenSans: 'Open Sans',
    SourceSansPro: 'Source Sans Pro',
    CenturyGothic: 'Century Gothic',
    BookAntiqua: 'Book Antiqua',
    PalatinoLinotype: 'Palatino Linotype',
  };
  if (known[name]) return known[name];
  if (!name || /^(g_d|sans-serif|serif)/.test(name)) return 'Calibri';
  return name.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function fontStyle(pdfName: string): { bold: boolean; italic: boolean } {
  const style = pdfName.replace(/^[A-Z]{6}\+/, '');
  return { bold: /bold|black|heavy|semibold|demi/i.test(style), italic: /italic|oblique/i.test(style) };
}

const sameStyle = (a: LayoutRun, b: LayoutRun) =>
  a.font === b.font && a.size === b.size && !!a.bold === !!b.bold && !!a.italic === !!b.italic && a.url === b.url;

/** Joins positioned items into styled runs, putting back the spaces the PDF encodes as gaps. */
function toRuns(items: LayoutItem[]): { runs: LayoutRun[]; chars: number } {
  const runs: LayoutRun[] = [];
  let chars = 0;
  let prev: LayoutItem | undefined;
  for (const item of items) {
    let text = item.str;
    if (prev) {
      const gap = item.x - (prev.x + prev.width);
      if (gap > item.size * 0.18 && !/\s$/.test(prev.str) && !/^\s/.test(text)) text = ` ${text}`;
    }
    const run: LayoutRun = { text, font: item.font, size: round(item.size), bold: item.bold || undefined, italic: item.italic || undefined, url: item.url };
    const last = runs.at(-1);
    if (last && sameStyle(last, run)) last.text += text;
    else runs.push(run);
    chars += text.length;
    prev = item;
  }
  // Whitespace at the edges carries no style information.
  if (runs[0]) runs[0].text = runs[0].text.replace(/^\s+/, '');
  if (runs.at(-1)) runs.at(-1)!.text = runs.at(-1)!.text.replace(/\s+$/, '');
  return { runs: runs.filter(r => r.text.length > 0), chars };
}

const round = (n: number) => Math.round(n * 10) / 10;
const runsText = (runs: LayoutRun[]) => runs.map(r => r.text).join('');

/** Lines of one page: items sharing a baseline, left to right. */
function pageLines(page: LayoutPage, pageIndex: number, right: number, edgeTolerance: number): Line[] {
  const items = page.items.filter(i => i.str.trim().length > 0 || i.str === ' ');
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: LayoutItem[][] = [];
  for (const item of items) {
    const group = groups.at(-1);
    if (group && Math.abs(group[0].y - item.y) <= Math.max(2, 0.3 * item.size)) group.push(item);
    else groups.push([item]);
  }

  return groups
    .map(group => group.filter(i => i.str.trim().length > 0).sort((a, b) => a.x - b.x))
    .filter(group => group.length > 0)
    .map(group => {
      const size = Math.max(...group.map(i => i.size));
      let main = group;
      let side: LayoutItem[] | undefined;
      // Text far to the right that ends at the right edge: dates and the like.
      for (let i = 1; i < group.length; i++) {
        const gap = group[i].x - (group[i - 1].x + group[i - 1].width);
        const tailEnd = Math.max(...group.slice(i).map(it => it.x + it.width));
        if (gap > Math.max(4 * size, 30) && Math.abs(tailEnd - right) <= edgeTolerance) {
          main = group.slice(0, i);
          side = group.slice(i);
          break;
        }
      }
      let bullet: Line['bullet'];
      const first = main[0];
      const firstText = first.str.trim();
      if (BULLET_CHARS.has(firstText) && main.length > 1) {
        bullet = { char: firstText, x: first.x, font: first.font, size: round(first.size) };
        main = main.slice(1);
      } else if (firstText.length > 2 && BULLET_CHARS.has(firstText[0]) && firstText[1] === ' ' && firstText[0] !== '-' ) {
        bullet = { char: firstText[0], x: first.x, font: first.font, size: round(first.size) };
        main = [{ ...first, str: first.str.replace(/^\s*\S\s+/, ''), x: first.x + first.size }, ...main.slice(1)];
      }
      const { runs, chars } = toRuns(main);
      const aside = side ? toRuns(side).runs : undefined;
      const all = [...main, ...(side ?? [])];
      return {
        page: pageIndex,
        y: group[0].y,
        items: all,
        runs,
        aside,
        bullet,
        start: main[0].x,
        end: Math.max(...main.map(i => i.x + i.width)),
        size,
        rtl: group.filter(i => i.rtl).length > group.length / 2,
        chars,
      } satisfies Line;
    })
    .filter(line => line.runs.length > 0 || (line.aside?.length ?? 0) > 0);
}

/** Two independent text columns (a sidebar CV): many lines with a wide gap that isn't a right-edge date. */
function looksMultiColumn(pages: LayoutPage[], right: number): boolean {
  let lines = 0;
  let split = 0;
  for (const page of pages) {
    const sorted = [...page.items].filter(i => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
    const byY = new Map<number, LayoutItem[]>();
    for (const i of sorted) byY.set(Math.round(i.y), [...(byY.get(Math.round(i.y)) ?? []), i]);
    for (const row of byY.values()) {
      lines++;
      for (let k = 1; k < row.length; k++) {
        const gap = row[k].x - (row[k - 1].x + row[k - 1].width);
        const tailEnd = Math.max(...row.slice(k).map(it => it.x + it.width));
        if (gap > 40 && Math.abs(tailEnd - right) > Math.max(6, 0.03 * (right - Math.min(...row.map(r => r.x))))) {
          split++;
          break;
        }
      }
    }
  }
  return lines >= 10 && split / lines > 0.2;
}

export function buildLayout(pages: LayoutPage[]): LayoutResult {
  const all = pages.flatMap(p => p.items.filter(i => i.str.trim()));
  if (all.length === 0) return { layout: null, reason: 'EMPTY' };
  const left = Math.min(...all.map(i => i.x));
  const right = Math.max(...all.map(i => i.x + i.width));
  if (looksMultiColumn(pages, right)) return { layout: null, reason: 'MULTI_COLUMN' };
  // Right-to-left (Hebrew) CVs use the template, which handles bidirectional text properly.
  if (all.filter(i => i.rtl).length > all.length / 2) return { layout: null, reason: 'RTL' };
  const width = right - left;
  const mid = (left + right) / 2;
  const pageMid = pages[0].width / 2;

  const lines = pages.flatMap((page, index) => pageLines(page, index, right, Math.max(6, 0.03 * width)));
  const align = (line: Line): LayoutParagraph['align'] => {
    if (line.aside || line.bullet) return 'left';
    const lineMid = (line.start + line.end) / 2;
    // Centered on the text block or on the page (margins aren't always equal).
    const tolerance = Math.max(4, 0.06 * width);
    const centered = Math.abs(lineMid - mid) <= tolerance || Math.abs(lineMid - pageMid) <= tolerance;
    if (line.start - left > 12 && line.end < right - 12 && centered) return 'center';
    if (Math.abs(line.end - right) <= 4 && line.start - left > width * 0.4) return 'right';
    return 'left';
  };

  // Typical line spacing (baseline gap / font size) inside wrapped text.
  const ratios: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].page !== lines[i - 1].page) continue;
    const r = (lines[i - 1].y - lines[i].y) / lines[i].size;
    if (r > 0.9 && r < 1.6) ratios.push(r);
  }
  ratios.sort((a, b) => a - b);
  const typicalRatio = ratios.length > 0 ? ratios[Math.floor(ratios.length * 0.25)] : 1.2;

  // Paragraphs: wrapped lines of the same text block become one paragraph.
  // A line in bold only, under a line that isn't, is a heading ("Languages" after a full skills line).
  const allBold = (l: Line) => l.runs.some(r => r.text.trim()) && l.runs.every(r => r.bold || !r.text.trim());
  const paragraphs: { lines: Line[]; align: LayoutParagraph['align'] }[] = [];
  for (const line of lines) {
    const current = paragraphs.at(-1);
    const prev = current?.lines.at(-1);
    const lineAlign = align(line);
    const continues =
      current &&
      prev &&
      prev.page === line.page &&
      !line.bullet &&
      !prev.aside &&
      !line.aside &&
      Math.abs(prev.size - line.size) < 0.6 &&
      !(allBold(line) && !allBold(prev)) &&
      prev.y - line.y <= line.size * 1.6 &&
      // the previous line was full (it wrapped)…
      prev.end >= right - Math.max(0.15 * width, 3 * line.size) &&
      // …and this one starts where the paragraph's text starts.
      ((current.align !== 'center' && Math.abs(line.start - current.lines[0].start) <= 3) ||
        (current.align === 'center' && lineAlign === 'center'));
    if (continues) current.lines.push(line);
    else paragraphs.push({ lines: [line], align: lineAlign });
  }

  const marginTop = Math.max(18, Math.min(...pages.map((page, index) => {
    const firstLine = lines.find(l => l.page === index);
    return firstLine ? page.height - firstLine.y - firstLine.size * 0.9 : 72;
  })));
  const marginBottom = Math.max(18, Math.min(54, ...lines.map(l => l.y - l.size * 0.3)));

  const out: LayoutParagraph[] = paragraphs.map((p, i) => {
    const first = p.lines[0];
    const last = p.lines.at(-1)!;
    const lineHeight =
      p.lines.length > 1 ? round((first.y - last.y) / (p.lines.length - 1)) : round(first.size * typicalRatio);
    const prev = paragraphs[i - 1]?.lines.at(-1);
    const fromPrev = prev && prev.page === first.page ? prev.y - first.y : null;
    const pageTop = pages[first.page].height - marginTop;
    const spaceBefore = Math.max(0, round(fromPrev !== null ? fromPrev - lineHeight : pageTop - first.y - lineHeight * 0.8));

    const runs: LayoutRun[] = [];
    for (const line of p.lines) {
      if (runs.length > 0 && line.runs.length > 0) {
        const tail = runs.at(-1)!;
        if (!/[\s-]$/.test(tail.text)) tail.text += ' ';
      }
      for (const run of line.runs) {
        const tail = runs.at(-1);
        if (tail && sameStyle(tail, run)) tail.text += run.text;
        else runs.push({ ...run });
      }
    }

    let alignment = p.align;
    if (alignment === 'left' && p.lines.length > 1 && p.lines.slice(0, -1).every(l => Math.abs(l.end - right) <= 3)) alignment = 'justify';

    const usedWidth = p.lines.reduce((sum, l) => sum + (l.end - l.start), 0);
    const chars = p.lines.reduce((sum, l) => sum + l.chars, 0);
    const charWidth = chars > 0 ? usedWidth / chars : first.size * 0.5;
    const lineCapacity = Math.max(10, Math.floor((right - first.start) / charWidth));

    return {
      page: first.page,
      runs,
      aside: first.aside,
      align: alignment,
      indent: alignment === 'center' || alignment === 'right' ? 0 : round(Math.max(0, first.start - left)),
      bullet: first.bullet ? { char: first.bullet.char, at: round(Math.max(0, first.bullet.x - left)), font: first.bullet.font, size: first.bullet.size } : undefined,
      spaceBefore,
      lineHeight,
      lines: p.lines.length,
      lineCapacity,
    };
  });

  const first = pages[0];
  return {
    layout: {
      version: 1,
      page: {
        width: round(first.width),
        height: round(first.height),
        marginTop: round(marginTop),
        marginBottom: round(marginBottom),
        marginLeft: round(left),
        marginRight: round(Math.max(18, first.width - right)),
      },
      pageCount: pages.length,
      rtl: lines.filter(l => l.rtl).length > lines.length / 2,
      paragraphs: out,
    },
  };
}

export const paragraphText = (p: LayoutParagraph) => runsText(p.runs);

/** Gives the characters [start, end) of a run list a link (or none), splitting runs at the edges. */
function setUrl(runs: LayoutRun[], start: number, end: number, url: string | undefined): LayoutRun[] {
  const out: LayoutRun[] = [];
  let pos = 0;
  for (const run of runs) {
    const runStart = pos;
    const runEnd = pos + run.text.length;
    pos = runEnd;
    const cuts = [runStart, Math.min(Math.max(start, runStart), runEnd), Math.min(Math.max(end, runStart), runEnd), runEnd];
    for (let i = 0; i < 3; i++) {
      if (cuts[i + 1] <= cuts[i]) continue;
      const piece: LayoutRun = { ...run, text: run.text.slice(cuts[i] - runStart, cuts[i + 1] - runStart) };
      if (i === 1) piece.url = url;
      const tail = out.at(-1);
      if (tail && sameStyle(tail, piece)) tail.text += piece.text;
      else out.push(piece);
    }
  }
  return out;
}

/**
 * Word and other exporters often place link click areas slightly off the words, so position alone can link
 * half a word and the phone number next to it. For links with a known label that appears in the paragraph
 * ("LinkedIn", "GitHub", "Portfolio"), the label word gets the link and nothing else in that paragraph does.
 */
export function alignLinkLabels(layout: CvLayout, labelled: { url: string; label: string }[]): CvLayout {
  for (const paragraph of layout.paragraphs) {
    const text = paragraphText(paragraph);
    const present = labelled.filter(l => new RegExp(`\\b${l.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    if (present.length === 0) continue;
    const presentUrls = new Set(present.map(l => l.url));
    const sameLink = (a: string | undefined, b: string) => !!a && a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();
    // Drop these links wherever position put them…
    let runs = paragraph.runs.map(r => (r.url && [...presentUrls].some(u => sameLink(r.url, u)) ? { ...r, url: undefined } : r));
    // …then put each on its label.
    for (const link of present) {
      const match = new RegExp(`\\b${link.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').exec(runsText(runs));
      if (match) runs = setUrl(runs, match.index, match.index + match[0].length, link.url);
    }
    // Merge neighbours that now share a style.
    paragraph.runs = runs.reduce<LayoutRun[]>((acc, run) => {
      const tail = acc.at(-1);
      if (tail && sameStyle(tail, run)) tail.text += run.text;
      else acc.push({ ...run });
      return acc;
    }, []);
  }
  return layout;
}

/** Removes a leading list marker ("• ", "- ") that the CV text may carry but the layout keeps separately. */
export const stripBullet = (text: string) => text.replace(/^\s*[•●▪■◦‣–\-*·○➢►▸✓]\s+/u, '');

/** Text for matching only: case, spaces, a leading list marker and the PDF's spacing don't matter. */
export const comparable = (text: string) => stripBullet(text).toLowerCase().replace(/[\s ]+/g, '');

/** Stored JSON → layout, or null when it's missing or from another version. */
export function parseStoredLayout(value: unknown): CvLayout | null {
  if (!value || typeof value !== 'object') return null;
  const layout = value as CvLayout;
  return layout.version === 1 && Array.isArray(layout.paragraphs) && layout.page ? layout : null;
}
