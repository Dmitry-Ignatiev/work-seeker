import 'server-only';
import JSZip from 'jszip';
import { collectLinks, MAX_LINKS, type RawLink } from './links';
import { cleanPdfText, CV_MAX_BYTES, CV_MAX_PAGES, CvUploadError, type ExtractedCv } from './pdf';

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\3\4": DOCX is a zip
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // old binary .doc
const MIN_TEXT_CHARS = 100;
const MAX_TEXT_CHARS = 100_000;
/** Unzipped size limits, so a small "zip bomb" can't make the server inflate gigabytes. */
const MAX_PART_BYTES = 5 * 1024 * 1024;
const MAX_ENTRIES = 2_000;
const PARSE_TIMEOUT_MS = 15_000;

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((byte, i) => bytes[i] === byte);

export const isZip = (bytes: Uint8Array) => startsWith(bytes, ZIP_MAGIC);
export const isOldWordDoc = (bytes: Uint8Array) => startsWith(bytes, OLE_MAGIC);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML entities to text (named, decimal and hex). */
function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** The text of one run of WordprocessingML: text, tabs and line breaks, in order. */
function runText(xml: string): string {
  let out = '';
  for (const [, tag, body] of xml.matchAll(/<w:(t|tab|br|cr|noBreakHyphen)\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:\1>)/g)) {
    if (tag === 't') out += decodeXml(body ?? '');
    else if (tag === 'tab') out += '\t';
    else if (tag === 'noBreakHyphen') out += '-';
    else out += '\n';
  }
  return out;
}

/** Relationship id → external target (hyperlinks) from a part's .rels file. */
function readRelationships(xml: string | undefined): Map<string, string> {
  const targets = new Map<string, string>();
  if (!xml) return targets;
  for (const [tag] of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = tag.match(/\bId="([^"]+)"/)?.[1];
    const target = tag.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target && /TargetMode="External"/.test(tag)) targets.set(id, decodeXml(target));
  }
  return targets;
}

/** One part (document, header or footer): its paragraphs as lines, and the links in it with the text they sit on. */
function readPart(rawXml: string, rels: Map<string, string>, links: RawLink[]): string[] {
  const xml = rawXml
    // Text boxes are stored twice (modern + legacy fallback); keep one copy.
    .replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '')
    // Paragraph and run properties hold tab-stop definitions (<w:tab .../>), not text.
    .replace(/<w:pPr>[\s\S]*?<\/w:pPr>/g, '')
    .replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, '');
  const lines: string[] = [];
  for (const [paragraph] of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    // Hyperlinks: <w:hyperlink r:id="…">runs</w:hyperlink>; the anchor is the text of those runs.
    for (const [, attrs, body] of paragraph.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/g)) {
      const url = rels.get(attrs.match(/\br:id="([^"]+)"/)?.[1] ?? '');
      if (url && links.length < MAX_LINKS * 4) links.push({ url, anchor: runText(body).trim() });
    }
    // Field-code links: <w:instrText> HYPERLINK "https://…" </w:instrText>.
    for (const [, url] of paragraph.matchAll(/<w:instrText\b[^>]*>\s*HYPERLINK\s+"([^"]+)"/g)) {
      if (links.length < MAX_LINKS * 4) links.push({ url: decodeXml(url), anchor: '' });
    }
    lines.push(runText(paragraph));
  }
  return lines;
}

async function readText(zip: JSZip, path: string): Promise<string | undefined> {
  const entry = zip.file(path);
  if (!entry) return undefined;
  // jszip keeps the declared size from the zip's directory; checked before inflating.
  const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  if (declared > MAX_PART_BYTES) throw new CvUploadError('This Word file is too large to read.');
  const text = await entry.async('string');
  if (text.length > MAX_PART_BYTES) throw new CvUploadError('This Word file is too large to read.');
  return text;
}

async function parse(bytes: Uint8Array): Promise<ExtractedCv> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new CvUploadError('This Word file could not be opened. It may be damaged or password-protected.');
  }
  if (Object.keys(zip.files).length > MAX_ENTRIES) throw new CvUploadError('This Word file could not be opened.');

  const types = await readText(zip, '[Content_Types].xml');
  const document = await readText(zip, 'word/document.xml');
  if (!types || !document || !/wordprocessingml\.document\.main\+xml/.test(types)) {
    throw new CvUploadError('Only PDF or Word (.docx) files are supported.');
  }

  const links: RawLink[] = [];
  const partLines = async (path: string) => {
    const xml = await readText(zip, path);
    if (!xml) return [];
    const relsPath = path.replace(/^word\/([^/]+)$/, 'word/_rels/$1.rels');
    return readPart(xml, readRelationships(await readText(zip, relsPath)), links);
  };
  // Contact details often live in the page header, so headers come first and footers last (each once).
  const parts = Object.keys(zip.files).sort();
  const headers = parts.filter(p => /^word\/header\d*\.xml$/.test(p));
  const footers = parts.filter(p => /^word\/footer\d*\.xml$/.test(p));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const path of [...headers, 'word/document.xml', ...footers]) {
    for (const line of await partLines(path)) {
      const key = line.trim();
      if (path !== 'word/document.xml' && (!key || seen.has(key))) continue;
      seen.add(key);
      lines.push(line);
    }
  }

  const text = cleanPdfText(lines.join('\n'));
  if (text.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
    throw new CvUploadError('No text found in this Word file. Is the CV an image inside it? Save it as a PDF instead.');
  }

  const declaredPages = Number((await readText(zip, 'docProps/app.xml'))?.match(/<Pages>(\d+)<\/Pages>/)?.[1]);
  const pageCount = Number.isInteger(declaredPages) && declaredPages > 0 ? declaredPages : 1;
  if (pageCount > CV_MAX_PAGES) throw new CvUploadError(`The CV has more than ${CV_MAX_PAGES} pages.`);

  // No page layout: Word files don't carry positions like a PDF, so tailored files use the clean template.
  return { text: text.slice(0, MAX_TEXT_CHARS), pageCount, links: collectLinks(links), layout: null };
}

/**
 * Extracts a Word (.docx) CV's text and links in memory. The bytes are never written anywhere.
 * Throws CvUploadError for anything the user can fix (old .doc, damaged, too big, no text).
 */
export async function extractDocxText(bytes: Uint8Array): Promise<ExtractedCv> {
  if (bytes.byteLength === 0) throw new CvUploadError('The file is empty.');
  if (bytes.byteLength > CV_MAX_BYTES) throw new CvUploadError('The file is larger than 4 MB.');
  if (isOldWordDoc(bytes)) throw new CvUploadError('This is an older Word file (.doc). Save it as .docx or PDF and upload again.');
  if (!isZip(bytes)) throw new CvUploadError('Only PDF or Word (.docx) files are supported.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CvUploadError('Reading the Word file took too long.')), PARSE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([parse(bytes), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
