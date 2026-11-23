import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { extractDocxText } from '@/server/cv/docx';
import { extractCv } from '@/server/cv/extract';
import { makeDocx } from '../support/make-docx';
import { makePdf, SAMPLE_CV_LINES } from '../support/make-pdf';

describe('extractDocxText', () => {
  it('reads the text of a Word CV in order, page header first', async () => {
    const { text, pageCount, layout } = await extractDocxText(
      await makeDocx(SAMPLE_CV_LINES.slice(2), { header: SAMPLE_CV_LINES.slice(0, 2) }),
    );
    expect(text.split('\n')).toEqual(SAMPLE_CV_LINES);
    expect(pageCount).toBe(1);
    // The look is read too (see cv-docx-layout.test.ts), page header first like the text.
    expect(layout?.paragraphs.map(p => p.runs.map(r => r.text).join(''))).toEqual(SAMPLE_CV_LINES.filter(l => l.trim()));
  });

  it('keeps hyperlinks with the text they sit on', async () => {
    const lines = [...SAMPLE_CV_LINES, 'LinkedIn', 'Work Seeker (project)'];
    const { links } = await extractDocxText(
      await makeDocx(lines, {
        links: [
          { line: lines.length - 2, url: 'https://www.linkedin.com/in/dana-levi' },
          { line: lines.length - 1, url: 'https://github.com/dana/work-seeker' },
        ],
      }),
    );
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://www.linkedin.com/in/dana-levi', kind: 'LINKEDIN' }),
        expect.objectContaining({ url: 'https://github.com/dana/work-seeker', anchor: 'Work Seeker (project)' }),
      ]),
    );
  });

  it('decodes XML entities and keeps Hebrew', async () => {
    const lines = [...SAMPLE_CV_LINES, 'R&D lead <Platform> — מפתח צד שרת'];
    const { text } = await extractDocxText(await makeDocx(lines));
    expect(text).toContain('R&D lead <Platform> — מפתח צד שרת');
  });

  it('asks for .docx or PDF when given an old binary .doc', async () => {
    const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0]);
    await expect(extractDocxText(doc)).rejects.toThrow('older Word file (.doc)');
  });

  it('rejects a zip that is not a Word document', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'hello');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(extractDocxText(bytes)).rejects.toThrow('Only PDF or Word (.docx) files are supported.');
  });

  it('rejects a Word file with almost no text', async () => {
    await expect(extractDocxText(await makeDocx(['CV']))).rejects.toThrow('No text found');
  });

  it('refuses a part that would unzip to more than the limit (zip bomb)', async () => {
    const zip = await JSZip.loadAsync(await makeDocx(SAMPLE_CV_LINES));
    zip.file('word/document.xml', `<w:document>${' '.repeat(6 * 1024 * 1024)}</w:document>`);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    expect(bytes.byteLength).toBeLessThan(100_000);
    await expect(extractDocxText(bytes)).rejects.toThrow('too large');
  });
});

describe('extractCv', () => {
  it('picks the reader from the bytes, not the file name', async () => {
    expect((await extractCv(makePdf([SAMPLE_CV_LINES]))).text).toContain('Dana Levi');
    expect((await extractCv(await makeDocx(SAMPLE_CV_LINES))).text).toContain('Dana Levi');
  });

  it('rejects anything else with one clear message', async () => {
    await expect(extractCv(new TextEncoder().encode('plain text pretending to be a CV'))).rejects.toThrow(
      'Only PDF or Word (.docx) files are supported.',
    );
    await expect(extractCv(new Uint8Array())).rejects.toThrow('The file is empty.');
  });
});
