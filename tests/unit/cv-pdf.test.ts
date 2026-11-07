import { describe, expect, it } from 'vitest';
import { checkPdfBytes, cleanPdfText, CV_MAX_BYTES, CvUploadError, extractPdfText } from '@/server/cv/pdf';
import { makePdf, SAMPLE_CV_LINES } from '../support/make-pdf';

describe('checkPdfBytes', () => {
  it('accepts a PDF header', () => {
    expect(() => checkPdfBytes(makePdf([SAMPLE_CV_LINES]))).not.toThrow();
  });

  it('rejects files that are not PDFs, whatever their name', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => checkPdfBytes(png)).toThrow('Only PDF files');
    expect(() => checkPdfBytes(new TextEncoder().encode('hello'))).toThrow(CvUploadError);
  });

  it('rejects empty and oversize files', () => {
    expect(() => checkPdfBytes(new Uint8Array())).toThrow('empty');
    const big = new Uint8Array(CV_MAX_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(() => checkPdfBytes(big)).toThrow('larger than 4 MB');
  });
});

describe('cleanPdfText', () => {
  it('drops NUL bytes, trailing spaces and extra blank lines', () => {
    expect(cleanPdfText('  a\u0000b  \r\n\n\n\nc \n')).toBe('ab\n\nc');
  });
});

describe('extractPdfText', () => {
  it('extracts the text and page count of a real PDF', async () => {
    const { text, pageCount } = await extractPdfText(makePdf([SAMPLE_CV_LINES, ['Projects', 'Open source work']]));
    expect(pageCount).toBe(2);
    expect(text).toContain('Built TypeScript and React dashboards');
    expect(text).toContain('Open source work');
  });

  it('reads the links behind text, with the words they sit on, and ignores unsafe ones', async () => {
    const lines = ['Dana Levi', 'LinkedIn | GitHub', 'Projects', 'Robot Arm Controller (C++, ROS)', 'Built a controller', 'Bad link'];
    const { links } = await extractPdfText(
      makePdf([[...lines, ...SAMPLE_CV_LINES]], [
        { page: 0, line: 1, url: 'https://www.linkedin.com/in/dana-levi/' },
        { page: 0, line: 3, url: 'https://github.com/dana/robot-arm' },
        { page: 0, line: 5, url: 'javascript:alert(1)' },
      ]),
    );
    expect(links.map(l => [l.kind, l.url])).toEqual([
      ['LINKEDIN', 'https://www.linkedin.com/in/dana-levi/'],
      ['PROJECT', 'https://github.com/dana/robot-arm'],
    ]);
    expect(links[1].anchor).toContain('Robot Arm Controller');
  });

  it('uploads a PDF without links as before', async () => {
    const { links } = await extractPdfText(makePdf([SAMPLE_CV_LINES]));
    expect(links).toEqual([]);
  });

  it('rejects PDFs with more than 20 pages', async () => {
    const pages = Array.from({ length: 21 }, () => SAMPLE_CV_LINES);
    await expect(extractPdfText(makePdf(pages))).rejects.toThrow('more than 20 pages');
  });

  it('rejects PDFs without text, like scans', async () => {
    await expect(extractPdfText(makePdf([['CV']]))).rejects.toThrow('No text found');
  });

  it('rejects damaged PDFs with a friendly message', async () => {
    await expect(extractPdfText(new TextEncoder().encode('%PDF-1.4\nnot really a pdf'))).rejects.toThrow(
      'could not be opened',
    );
  });
});
