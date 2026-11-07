import 'server-only';
import { extractText, getDocumentProxy } from 'unpdf';
import { collectLinks, MAX_LINKS, type CvLink, type RawLink } from './links';

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

/**
 * Extracts a CV's text in memory. The bytes are never written anywhere.
 * Throws CvUploadError for anything the user can fix (wrong type, too big, too many pages, scanned, encrypted).
 */
export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pageCount: number; links: CvLink[] }> {
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

async function parse(bytes: Uint8Array) {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // PDF.js may transfer (detach) the buffer it gets, so hand it a copy.
    pdf = await getDocumentProxy(bytes.slice(), { maxImageSize: MAX_IMAGE_PIXELS });
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
    return { text: clean.slice(0, MAX_TEXT_CHARS), pageCount: pdf.numPages, links: await readLinks(pdf) };
  } finally {
    // Frees the document and its worker-side state.
    await pdf.loadingTask.destroy();
  }
}

type Pdf = Awaited<ReturnType<typeof getDocumentProxy>>;
interface TextItem {
  str: string;
  width: number;
  transform: number[];
}

/**
 * The web/email links in the PDF (link annotations) and the visible text under each one.
 * Links are a nice-to-have: a PDF whose annotations can't be read still uploads, without them.
 */
async function readLinks(pdf: Pdf): Promise<CvLink[]> {
  const raw: RawLink[] = [];
  try {
    for (let p = 1; p <= pdf.numPages && raw.length < MAX_LINKS * 4; p++) {
      const page = await pdf.getPage(p);
      const annotations = (await page.getAnnotations()) as { subtype?: string; url?: string; rect?: number[] }[];
      const byUrl = new Map<string, number[][]>();
      for (const a of annotations) {
        if (a.subtype !== 'Link' || typeof a.url !== 'string' || !Array.isArray(a.rect)) continue;
        byUrl.set(a.url, [...(byUrl.get(a.url) ?? []), a.rect]);
      }
      if (byUrl.size === 0) continue;
      // Text runs only (marked-content entries have no text or position).
      const items = (await page.getTextContent()).items.filter(i => 'str' in i) as unknown as TextItem[];
      for (const [url, rects] of byUrl) raw.push({ url, anchor: textUnder(items, rects) });
    }
  } catch {
    // Keep the links read so far.
  }
  return collectLinks(raw);
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
