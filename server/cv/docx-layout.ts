import 'server-only';
import type { CvLayout, LayoutParagraph, LayoutRun } from './layout';

/**
 * Reads a Word CV's look into a CvLayout, the same shape the PDF reader makes: page size and margins, and per
 * paragraph its runs (font, size, bold, italic, links), alignment, indent, bullet, spacing and the text pushed
 * to the right edge by a right tab stop (dates). The layout DOCX/PDF builders then redraw it, so a downloaded
 * or tailored CV keeps the user's formatting instead of plain lines.
 *
 * Pure and in memory. Returns null for what can't be redrawn faithfully as one column of paragraphs
 * (tables with several columns, text boxes, Hebrew): those keep the previous plain or template fallback.
 */

export interface DocxParts {
  document: string;
  styles?: string;
  numbering?: string;
  theme?: string;
  /** Header parts' XML, first page first: contact details often live there. */
  headers?: string[];
  /** Relationship id → external URL, for the document's hyperlinks. */
  rels: Map<string, string>;
  pageCount: number;
}

interface RunProps {
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  caps?: boolean;
}

interface ParaProps {
  align?: LayoutParagraph['align'];
  left?: number;
  hanging?: number;
  firstLine?: number;
  before?: number;
  after?: number;
  line?: number;
  lineRule?: string;
  numId?: string;
  level?: string;
  rightTab?: boolean;
}

interface Style {
  basedOn?: string;
  run: RunProps;
  para: ParaProps;
}

const twipsToPt = (value: string | undefined) => (value === undefined ? undefined : Math.round(Number(value) / 2) / 10);
const attr = (xml: string, tag: string, name: string) => xml.match(new RegExp(`<w:${tag}\\b[^>]*?\\bw:${name}="([^"]*)"`))?.[1];
/** A toggle like <w:b/>: on unless w:val is 0/false/off. */
function toggle(xml: string, tag: string): boolean | undefined {
  const match = xml.match(new RegExp(`<w:${tag}(?:\\s[^>]*)?/?>`));
  if (!match) return undefined;
  const value = match[0].match(/w:val="([^"]*)"/)?.[1];
  return value === undefined || !/^(0|false|off)$/i.test(value);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function readRunProps(rPr: string, themeFonts: { minor: string; major: string }): RunProps {
  const props: RunProps = {};
  const fonts = rPr.match(/<w:rFonts\b[^>]*>/)?.[0];
  if (fonts) {
    const ascii = fonts.match(/w:ascii="([^"]+)"/)?.[1] ?? fonts.match(/w:hAnsi="([^"]+)"/)?.[1];
    const theme = fonts.match(/w:asciiTheme="([^"]+)"/)?.[1];
    if (ascii) props.font = decodeXml(ascii);
    else if (theme) props.font = theme.startsWith('major') ? themeFonts.major : themeFonts.minor;
  }
  const size = attr(rPr, 'sz', 'val');
  if (size) props.size = Number(size) / 2;
  const bold = toggle(rPr, 'b');
  if (bold !== undefined) props.bold = bold;
  const italic = toggle(rPr, 'i');
  if (italic !== undefined) props.italic = italic;
  const caps = toggle(rPr, 'caps');
  if (caps !== undefined) props.caps = caps;
  return props;
}

function readParaProps(pPr: string): ParaProps {
  const props: ParaProps = {};
  const jc = attr(pPr, 'jc', 'val');
  if (jc)
    props.align = jc === 'center' ? 'center' : /right|end/.test(jc) ? 'right' : /both|distribute/.test(jc) ? 'justify' : 'left';
  const ind = pPr.match(/<w:ind\b[^>]*>/)?.[0];
  if (ind) {
    const left = ind.match(/w:(?:left|start)="(-?\d+)"/)?.[1];
    const hanging = ind.match(/w:hanging="(\d+)"/)?.[1];
    const firstLine = ind.match(/w:firstLine="(\d+)"/)?.[1];
    if (left !== undefined) props.left = twipsToPt(left);
    if (hanging !== undefined) props.hanging = twipsToPt(hanging);
    if (firstLine !== undefined) props.firstLine = twipsToPt(firstLine);
  }
  const spacing = pPr.match(/<w:spacing\b[^>]*>/)?.[0];
  if (spacing) {
    const before = spacing.match(/w:before="(\d+)"/)?.[1];
    const after = spacing.match(/w:after="(\d+)"/)?.[1];
    const line = spacing.match(/w:line="(\d+)"/)?.[1];
    if (before !== undefined) props.before = twipsToPt(before);
    if (after !== undefined) props.after = twipsToPt(after);
    if (line !== undefined) {
      props.line = Number(line);
      props.lineRule = spacing.match(/w:lineRule="([^"]+)"/)?.[1] ?? 'auto';
    }
  }
  const numId = attr(pPr, 'numId', 'val');
  if (numId) {
    props.numId = numId;
    props.level = attr(pPr, 'ilvl', 'val') ?? '0';
  }
  if (/<w:tab\b[^>]*w:val="(right|end)"/.test(pPr)) props.rightTab = true;
  return props;
}

function readStyles(xml: string | undefined, themeFonts: { minor: string; major: string }) {
  const styles = new Map<string, Style>();
  let defaults: Style = { run: {}, para: {} };
  if (!xml) return { styles, defaults, normal: 'Normal' };
  const docDefaults = xml.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0] ?? '';
  defaults = {
    run: readRunProps(docDefaults.match(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/)?.[0] ?? '', themeFonts),
    para: readParaProps(docDefaults.match(/<w:pPrDefault>[\s\S]*?<\/w:pPrDefault>/)?.[0] ?? ''),
  };
  let normal = 'Normal';
  for (const [block] of xml.matchAll(/<w:style\b[\s\S]*?<\/w:style>/g)) {
    const id = block.match(/w:styleId="([^"]+)"/)?.[1];
    if (!id) continue;
    if (/w:type="paragraph"/.test(block) && /w:default="1"/.test(block)) normal = id;
    styles.set(id, {
      basedOn: attr(block, 'basedOn', 'val'),
      run: readRunProps(block.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '', themeFonts),
      para: readParaProps(block.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? ''),
    });
  }
  return { styles, defaults, normal };
}

/** A style with everything it inherits (basedOn chain), defaults first. */
function resolveStyle(id: string | undefined, styles: Map<string, Style>, depth = 0): Style {
  const style = id ? styles.get(id) : undefined;
  if (!style || depth > 10) return { run: {}, para: {} };
  const base = resolveStyle(style.basedOn, styles, depth + 1);
  return { run: { ...base.run, ...style.run }, para: { ...base.para, ...style.para } };
}

/** Bullet glyph and indents per list (numId) and level, from numbering.xml. */
function readNumbering(xml: string | undefined) {
  const abstracts = new Map<string, Map<string, { char: string; font?: string; para: ParaProps; numbered: boolean }>>();
  const lists = new Map<string, string>();
  if (!xml) return { abstracts, lists };
  for (const [block] of xml.matchAll(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g)) {
    const id = block.match(/w:abstractNumId="(\d+)"/)?.[1];
    if (!id) continue;
    const levels = new Map<string, { char: string; font?: string; para: ParaProps; numbered: boolean }>();
    for (const [level] of block.matchAll(/<w:lvl\b[\s\S]*?<\/w:lvl>/g)) {
      const ilvl = level.match(/w:ilvl="(\d+)"/)?.[1] ?? '0';
      const format = attr(level, 'numFmt', 'val') ?? 'bullet';
      const text = decodeXml(attr(level, 'lvlText', 'val') ?? '•');
      const font = level.match(/<w:rFonts\b[^>]*w:ascii="([^"]+)"/)?.[1];
      levels.set(ilvl, {
        // Symbol/Wingdings bullets are private-use glyphs; a plain bullet reads the same everywhere.
        char: format === 'bullet' ? (/^[\u2022\u25aa\u25cf\u2013\-o*]$/.test(text) ? text : '•') : text.replace(/%\d/, '1'),
        font,
        para: readParaProps(level.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? ''),
        numbered: format !== 'bullet' && format !== 'none',
      });
    }
    abstracts.set(id, levels);
  }
  for (const [block] of xml.matchAll(/<w:num\b[\s\S]*?<\/w:num>/g)) {
    const numId = block.match(/w:numId="(\d+)"/)?.[1];
    const abstractId = attr(block, 'abstractNumId', 'val');
    if (numId && abstractId) lists.set(numId, abstractId);
  }
  return { abstracts, lists };
}

function themeFontsOf(theme: string | undefined) {
  const minor = theme?.match(/<a:minorFont>\s*<a:latin typeface="([^"]+)"/)?.[1] ?? 'Calibri';
  const major = theme?.match(/<a:majorFont>\s*<a:latin typeface="([^"]+)"/)?.[1] ?? 'Calibri Light';
  return { minor, major };
}

/** The runs of one paragraph in order, with each run's text, tabs and link. */
function paragraphRuns(paragraph: string, rels: Map<string, string>) {
  const out: { xml: string; url?: string }[] = [];
  // Hyperlinks wrap their runs; split the paragraph so each run knows its link.
  const pieces = paragraph.split(/(<w:hyperlink\b[^>]*>[\s\S]*?<\/w:hyperlink>)/);
  for (const piece of pieces) {
    const link = piece.match(/^<w:hyperlink\b([^>]*)>/);
    const url = link ? rels.get(link[1].match(/\br:id="([^"]+)"/)?.[1] ?? '') : undefined;
    for (const [run] of piece.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)) out.push({ xml: run, url });
  }
  return out;
}

const HEBREW = /[\u0590-\u05ff]/;

export function readDocxLayout(parts: DocxParts): CvLayout | null {
  const body = parts.document.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '').match(/<w:body>([\s\S]*)<\/w:body>/)?.[1];
  if (!body) return null;
  // Text boxes and side-by-side table cells are placed by position, which a column of paragraphs can't show.
  if (/<w:txbxContent\b/.test(body)) return null;
  for (const [row] of body.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
    const filled = [...row.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].filter(([cell]) => /<w:t\b[^>]*>[^<]*\S/.test(cell));
    if (filled.length > 1) return null;
  }

  const themeFonts = themeFontsOf(parts.theme);
  const { styles, defaults, normal } = readStyles(parts.styles, themeFonts);
  const numbering = readNumbering(parts.numbering);

  const sect = body.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)?.at(-1) ?? '';
  const width = twipsToPt(attr(sect, 'pgSz', 'w')) ?? 595.28;
  const height = twipsToPt(attr(sect, 'pgSz', 'h')) ?? 841.89;
  const page = {
    width,
    height,
    marginTop: twipsToPt(attr(sect, 'pgMar', 'top')) ?? 72,
    marginBottom: twipsToPt(attr(sect, 'pgMar', 'bottom')) ?? 72,
    marginLeft: twipsToPt(attr(sect, 'pgMar', 'left')) ?? 72,
    marginRight: twipsToPt(attr(sect, 'pgMar', 'right')) ?? 72,
  };
  const contentWidth = width - page.marginLeft - page.marginRight;

  const paragraphs: LayoutParagraph[] = [];
  let pageIndex = 0;
  let pendingAfter = 0;
  let allText = '';
  const xmlParagraphs = [...(parts.headers ?? []), body].flatMap(xml =>
    [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map(m => m[0]),
  );

  for (const paragraph of xmlParagraphs) {
    const pPrXml = paragraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
    const directPara = readParaProps(pPrXml.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, ''));
    const styleId = attr(pPrXml, 'pStyle', 'val') ?? normal;
    const style = resolveStyle(styleId, styles);
    const list = directPara.numId ?? style.para.numId;
    const level = directPara.numId ? directPara.level : style.para.level;
    const listLevel =
      list && list !== '0' ? numbering.abstracts.get(numbering.lists.get(list) ?? '')?.get(level ?? '0') : undefined;
    const para: ParaProps = { ...defaults.para, ...style.para, ...(listLevel?.para ?? {}), ...directPara };
    if (/<w:pageBreakBefore\b(?![^>]*w:val="(?:0|false)")/.test(pPrXml) && paragraphs.length > 0) pageIndex++;

    const runs: LayoutRun[] = [];
    const aside: LayoutRun[] = [];
    let afterTab = false;
    for (const { xml, url } of paragraphRuns(paragraph, parts.rels)) {
      const rPr = xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
      const charStyle = resolveStyle(attr(rPr, 'rStyle', 'val'), styles).run;
      const props: RunProps = { ...defaults.run, ...style.run, ...charStyle, ...readRunProps(rPr, themeFonts) };
      if (/<w:br\b[^>]*w:type="page"/.test(xml)) pageIndex++;
      for (const [, tag, inner] of xml.matchAll(/<w:(t|tab|br|cr|noBreakHyphen)\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:\1>)/g)) {
        if (tag === 'tab') {
          // Text after a tab on a line with a right tab stop goes to the right edge (dates).
          if (para.rightTab) afterTab = true;
          else (afterTab ? aside : runs).push(makeRun(' ', props, url));
          continue;
        }
        if (tag === 'br' || tag === 'cr') continue;
        const text = tag === 'noBreakHyphen' ? '-' : decodeXml(inner ?? '');
        if (!text) continue;
        (afterTab ? aside : runs).push(makeRun(props.caps ? text.toUpperCase() : text, props, url));
      }
    }
    const merged = mergeRuns(runs);
    const mergedAside = mergeRuns(aside);
    const text = merged.map(r => r.text).join('') + mergedAside.map(r => r.text).join('');
    allText += text;
    const before = para.before ?? 0;
    if (!text.trim()) {
      // An empty paragraph is vertical space.
      const size = merged[0]?.size ?? defaults.run.size ?? 11;
      pendingAfter += before + lineHeightOf(para, size) + (para.after ?? 0);
      continue;
    }
    trimEdges(merged);
    trimEdges(mergedAside);

    const size = Math.max(...merged.map(r => r.size), ...mergedAside.map(r => r.size));
    const left = Math.max(0, para.left ?? 0);
    const hanging = para.hanging ?? 0;
    const lineCapacity = Math.max(20, Math.round((contentWidth - left) / (size * 0.5)));
    const out: LayoutParagraph = {
      page: pageIndex,
      runs: merged,
      align: para.align ?? 'left',
      indent: Math.round((listLevel ? left : Math.max(0, left + (para.firstLine ?? 0) - hanging)) * 10) / 10,
      spaceBefore: pendingAfter + before,
      lineHeight: lineHeightOf(para, size),
      lines: Math.max(1, Math.ceil(text.length / lineCapacity)),
      lineCapacity,
    };
    if (mergedAside.length > 0) out.aside = mergedAside;
    if (listLevel) {
      out.bullet = {
        char: listLevel.char,
        at: Math.max(0, left - hanging),
        font: listLevel.numbered ? (merged[0]?.font ?? 'Calibri') : 'Calibri',
        size: merged[0]?.size ?? size,
      };
    }
    paragraphs.push(out);
    pendingAfter = para.after ?? 0;
  }

  if (paragraphs.length === 0 || HEBREW.test(allText)) return null;
  return { version: 1, page, pageCount: Math.max(parts.pageCount, pageIndex + 1), rtl: false, paragraphs };
}

function makeRun(text: string, props: RunProps, url: string | undefined): LayoutRun {
  const run: LayoutRun = { text, font: props.font ?? 'Calibri', size: props.size ?? 11 };
  if (props.bold) run.bold = true;
  if (props.italic) run.italic = true;
  if (url) run.url = url;
  return run;
}

/** Joins neighbouring runs that look the same, so a word split by Word's revision marks is one run again. */
function mergeRuns(runs: LayoutRun[]): LayoutRun[] {
  const out: LayoutRun[] = [];
  for (const run of runs) {
    const last = out.at(-1);
    if (
      last &&
      last.font === run.font &&
      last.size === run.size &&
      !!last.bold === !!run.bold &&
      !!last.italic === !!run.italic &&
      last.url === run.url
    ) {
      last.text += run.text;
    } else {
      out.push({ ...run });
    }
  }
  return out;
}

/** Drops leading and trailing spaces of a paragraph (Word files often pad with them). */
function trimEdges(runs: LayoutRun[]) {
  while (runs.length > 0 && !runs[0].text.trim()) runs.shift();
  while (runs.length > 0 && !runs.at(-1)!.text.trim()) runs.pop();
  if (runs.length > 0) {
    runs[0].text = runs[0].text.trimStart();
    runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
  }
}

/** Baseline-to-baseline distance: "auto" spacing is a multiple of single (about 1.2 × the font size). */
function lineHeightOf(para: ParaProps, size: number): number {
  if (para.line && para.lineRule && para.lineRule !== 'auto') return para.line / 20;
  const multiple = para.line ? para.line / 240 : 1;
  return Math.round(size * 1.2 * multiple * 10) / 10;
}
