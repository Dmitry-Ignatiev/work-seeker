import 'server-only';
import { extractText, getDocumentProxy } from 'unpdf';
import { alignLinkLabels, buildLayout, fontFamily, fontStyle, type CvLayout, type LayoutPage } from './layout';
import { collectLinks, headerLinks, MAX_LINKS, normalizeLinkUrl, type CvLink, type RawLink } from './links';

/** Under Vercel's 4.5 MB function body limit, with room for the multipart envelope. */
export const CV_MAX_BYTES = 4 * 1024 * 1024;
export const CV_MAX_PAGES = 20;
/** Fewer non-space characters than this usually means a scanned (image-only) PDF. */
const MIN_TEXT_CHARS = 100;
const MAX_TEXT_CHARS = 100_000;
const PARSE_TIMEOUT_MS = 15_000;
/** ~16 MP: one declared image can't make PDF.js allocate gigabytes. */
const MAX_IMAGE_PIXELS = 16_777_216;

/** A problem with the uploaded file. The message is safe to show to the user. */
export class CvUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CvUploadError';
  }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Size and magic-byte checks. Runs before any parsing. */
export function checkPdfBytes(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw new CvUploadError('The file is empty.');
  if (bytes.byteLength > CV_MAX_BYTES) throw new CvUploadError('The file is larger than 4 MB.');
  if (!PDF_MAGIC.every((byte, i) => bytes[i] === byte)) throw new CvUploadError('Only PDF files are supported.');
}

/** Normalizes extracted text: no NUL bytes, no trailing spaces, at most one blank line in a row. */
export function cleanPdfText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ExtractedCv {
  text: string;
  pageCount: number;
  links: CvLink[];
  /** The page layout (server/cv/layout.ts), or null when it can't be read reliably. */
  layout: CvLayout | null;
  /** Why there's no layout when that's worth telling the user: a two-column design is rebuilt in one column. */
  layoutNote?: 'MULTI_COLUMN';
}

/**
 * Extracts a CV's text, links and layout in memory. The bytes are never written anywhere.
 * Throws CvUploadError for anything the user can fix (wrong type, too big, too many pages, scanned, encrypted).
 */
export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedCv> {
  checkPdfBytes(bytes);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CvUploadError('Reading the PDF took too long.')), PARSE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([parse(bytes), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type Pdf = Awaited<ReturnType<typeof getDocumentProxy>>;

async function parse(bytes: Uint8Array): Promise<ExtractedCv> {
  let pdf: Pdf;
  try {
    // PDF.js may transfer (detach) the buffer it gets, so hand it a copy. Font names are needed for the layout.
    pdf = await getDocumentProxy(bytes.slice(), { maxImageSize: MAX_IMAGE_PIXELS, fontExtraProperties: true });
  } catch {
    throw new CvUploadError('This PDF could not be opened. It may be damaged or password-protected.');
  }
  try {
    if (pdf.numPages > CV_MAX_PAGES) throw new CvUploadError(`The CV has more than ${CV_MAX_PAGES} pages.`);
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = cleanPdfText(text);
    if (clean.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
      throw new CvUploadError('No text found in this PDF. Is it a scanned image? Export it from Word or Docs instead.');
    }
    const { links, layout, layoutNote } = await readPages(pdf);
    return { text: clean.slice(0, MAX_TEXT_CHARS), pageCount: pdf.numPages, links, layout, layoutNote };
  } finally {
    // Frees the document and its worker-side state.
    await pdf.loadingTask.destroy();
  }
}

interface TextItem {
  str: string;
  width: number;
  transform: number[];
  fontName: string;
  dir?: string;
}

/**
 * Links (annotations, with the visible text under each) and the page layout. Both are extras:
 * a PDF whose annotations or fonts can't be read still uploads, without them.
 */
async function readPages(pdf: Pdf): Promise<Pick<ExtractedCv, 'links' | 'layout' | 'layoutNote'>> {
  const raw: RawLink[] = [];
  const pages: LayoutPage[] = [];
  let layoutOk = true;
  for (let p = 1; p <= pdf.numPages; p++) {
    try {
      const page = await pdf.getPage(p);
      const view = page.view;
      const annotations = (await page.getAnnotations()) as { subtype?: string; url?: string; rect?: number[] }[];
      const rectsByUrl = new Map<string, number[][]>();
      for (const a of annotations) {
        if (a.subtype !== 'Link' || typeof a.url !== 'string' || !Array.isArray(a.rect)) continue;
        rectsByUrl.set(a.url, [...(rectsByUrl.get(a.url) ?? []), a.rect]);
      }
      // Text runs only (marked-content entries have no text or position).
      const items = (await page.getTextContent()).items.filter(i => 'str' in i) as unknown as TextItem[];
      if (raw.length < MAX_LINKS * 4) for (const [url, rects] of rectsByUrl) raw.push({ url, anchor: textUnder(items, rects) });
      if (!layoutOk) continue;

      await page.getOperatorList(); // loads the fonts, so their real names are known
      const fontNames = new Map<string, string>();
      const fontName = (id: string) => {
        if (!fontNames.has(id)) {
          let name = '';
          try {
            name = (page.commonObjs.get(id) as { name?: string } | undefined)?.name ?? '';
          } catch {
            name = '';
          }
          fontNames.set(id, name);
        }
        return fontNames.get(id)!;
      };
      pages.push({
        width: view[2] - view[0],
        height: view[3] - view[1],
        items: items.map(item => {
          const pdfFont = fontName(item.fontName);
          const url = linkAt(rectsByUrl, item.transform[4], item.transform[4] + item.width, item.transform[5]);
          return {
            str: item.str,
            x: item.transform[4] - view[0],
            y: item.transform[5] - view[1],
            width: item.width,
            size: Math.hypot(item.transform[0], item.transform[1]) || Math.abs(item.transform[3]),
            font: fontFamily(pdfFont),
            ...fontStyle(pdfFont),
            rtl: item.dir === 'rtl',
            // Only web and email links, the same ones collectLinks keeps.
            url: url ? (normalizeLinkUrl(url) ?? undefined) : undefined,
          };
        }),
      });
    } catch {
      layoutOk = false;
    }
  }
  const links = collectLinks(raw);
  if (!layoutOk) return { links, layout: null };
  const result = buildLayout(pages);
  if (result.layout) {
    const labelled = headerLinks(links).filter(l => l.kind !== 'WEBSITE');
    return { links, layout: alignLinkLabels(result.layout, labelled) };
  }
  return { links, layout: null, layoutNote: result.reason === 'MULTI_COLUMN' ? 'MULTI_COLUMN' : undefined };
}

/** The link whose rectangles cover most of this piece of text, if any (a click area that merely grazes it doesn't count). */
function linkAt(rectsByUrl: Map<string, number[][]>, x1: number, x2: number, y: number): string | undefined {
  const width = Math.max(x2 - x1, 0.1);
  for (const [url, rects] of rectsByUrl) {
    const covered = rects
      .filter(([, ry1, , ry2]) => y >= ry1 - 2 && y <= ry2 + 1)
      .reduce((sum, [rx1, , rx2]) => sum + Math.max(0, Math.min(x2, rx2) - Math.max(x1, rx1)), 0);
    if (covered / width >= 0.5) return url;
  }
  return undefined;
}

/** Text items whose baseline lies inside one of the link's rectangles, in reading order. */
function textUnder(items: TextItem[], rects: number[][]): string {
  const hits = items.filter(item => {
    const x1 = item.transform[4];
    const x2 = x1 + item.width;
    const y = item.transform[5];
    return rects.some(([rx1, ry1, rx2, ry2]) => x2 > rx1 + 0.5 && x1 < rx2 - 0.5 && y >= ry1 - 2 && y <= ry2 + 1);
  });
  hits.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  return hits.map(i => i.str).join('');
}
