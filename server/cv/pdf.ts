import 'server-only';
import { extractText, getDocumentProxy } from 'unpdf';

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
export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
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
    return { text: clean.slice(0, MAX_TEXT_CHARS), pageCount: pdf.numPages };
  } finally {
    // Frees the document and its worker-side state.
    await pdf.loadingTask.destroy();
  }
}
