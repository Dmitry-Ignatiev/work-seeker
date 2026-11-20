import 'server-only';
import { extractDocxText, isOldWordDoc, isZip } from './docx';
import { CvUploadError, extractPdfText, type ExtractedCv } from './pdf';

const isPdf = (bytes: Uint8Array) => [0x25, 0x50, 0x44, 0x46, 0x2d].every((byte, i) => bytes[i] === byte); // "%PDF-"

/**
 * Reads an uploaded CV, PDF or Word (.docx), in memory. The type comes from the file's bytes, not its name.
 * Throws CvUploadError (safe to show) for anything the user can fix.
 */
export async function extractCv(bytes: Uint8Array): Promise<ExtractedCv> {
  if (bytes.byteLength === 0) throw new CvUploadError('The file is empty.');
  if (isPdf(bytes)) return extractPdfText(bytes);
  if (isZip(bytes) || isOldWordDoc(bytes)) return extractDocxText(bytes);
  throw new CvUploadError('Only PDF or Word (.docx) files are supported.');
}
