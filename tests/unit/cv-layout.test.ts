import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildLayout, comparable, fontFamily, fontStyle, paragraphText, type CvLayout, type LayoutItem } from '@/server/cv/layout';
import { extractPdfText } from '@/server/cv/pdf';
import { droppedWords, lengthLimits } from '@/server/tailor/fit';
import { buildLayoutDocx } from '@/server/tailor/layout-docx';
import { DESIGNED_CV_LINES, makePdf } from '../support/make-pdf';

async function designedLayout(pages = [DESIGNED_CV_LINES]): Promise<CvLayout> {
  const { layout } = await extractPdfText(makePdf(pages));
  if (!layout) throw new Error('no layout');
  return layout;
}

const find = (layout: CvLayout, start: string) => layout.paragraphs.find(p => paragraphText(p).startsWith(start))!;

async function docxXml(buffer: Buffer): Promise<string> {
  return (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string');
}

describe('reading a CV layout from a PDF', () => {
  it('maps PDF font names to Word fonts and styles', () => {
    expect(fontFamily('BCDEEE+Calibri-Bold')).toBe('Calibri');
    expect(fontFamily('ArialMT')).toBe('Arial');
    expect(fontFamily('TimesNewRomanPSMT')).toBe('Times New Roman');
    expect(fontFamily('Helvetica-Bold')).toBe('Arial');
    expect(fontFamily('ABCDEF+OpenSans-Regular')).toBe('Open Sans');
    expect(fontStyle('BCDEEE+Calibri-BoldItalic')).toEqual({ bold: true, italic: true });
    expect(fontStyle('ArialMT')).toEqual({ bold: false, italic: false });
  });

  it('keeps centered lines centered, sizes, bold, right-side dates and bullets', async () => {
    const layout = await designedLayout();
    expect(layout.pageCount).toBe(1);
    expect(layout.page).toMatchObject({ width: 612, height: 792 });

    const name = find(layout, 'Dana Levi');
    expect(name.align).toBe('center');
    expect(name.runs[0]).toMatchObject({ bold: true, size: 18, font: 'Arial' });
    expect(find(layout, 'dana.levi@example.com').align).toBe('center');

    expect(find(layout, 'Experience')).toMatchObject({ align: 'left' });
    expect(find(layout, 'Experience').runs[0].bold).toBe(true);

    const job = find(layout, 'Acme Ltd');
    expect(job.aside?.map(r => r.text).join('')).toBe('2021 - present');

    const bullet = find(layout, 'Built TypeScript');
    expect(bullet.bullet?.char).toBe('-');
    expect(bullet.indent).toBeGreaterThan(bullet.bullet!.at);
  });

  it('makes Word open the DOCX in Print Layout, not Web Layout', async () => {
    const { buffer } = await buildLayoutDocx({ layout: await designedLayout(), edits: [] });
    const settings = await (await JSZip.loadAsync(buffer)).file('word/settings.xml')!.async('string');
    expect(settings).toContain('<w:view w:val="print"/>');
  });

  it('keeps a bold heading right under a full line of text as its own paragraph', async () => {
    const skills = 'Java, REST APIs, Python, LangGraph, SQL, MySQL, Docker, Linux CLI, Django, React, Bash, PowerShell';
    const layout = await designedLayout([
      [...DESIGNED_CV_LINES, { text: 'Core Skills', bold: true }, skills, { text: 'Languages', bold: true }, 'English, Hebrew, Russian'],
    ]);
    expect(paragraphText(find(layout, 'Java, REST APIs'))).toBe(skills);
    expect(find(layout, 'Languages').runs[0].bold).toBe(true);
    expect(paragraphText(find(layout, 'Languages'))).toBe('Languages');
  });

  it('joins wrapped lines into one paragraph and starts later pages on a new page', async () => {
    const long = 'Led the migration of eleven services to a shared platform with clear ownership and on-call rules,';
    const layout = await designedLayout([
      [...DESIGNED_CV_LINES, '', 'Summary', long, 'cutting incidents across the whole group.'],
      [{ text: 'Projects', bold: true }, 'Robot arm controller in C++.'],
    ]);
    const summary = find(layout, 'Led the migration');
    expect(summary.lines).toBe(2);
    expect(paragraphText(summary)).toBe(`${long} cutting incidents across the whole group.`);
    expect(layout.pageCount).toBe(2);
    expect(find(layout, 'Projects').page).toBe(1);
  });

  it('gives up on two-column designs instead of scrambling them', () => {
    const items: LayoutItem[] = [];
    for (let i = 0; i < 20; i++) {
      const y = 750 - i * 14;
      items.push({ str: `Sidebar ${i}`, x: 40, y, width: 60, size: 10, font: 'Arial', bold: false, italic: false, rtl: false });
      items.push({ str: `Main column text ${i}`, x: 220, y, width: 150, size: 10, font: 'Arial', bold: false, italic: false, rtl: false });
    }
    items.push({ str: 'Edge', x: 500, y: 100, width: 70, size: 10, font: 'Arial', bold: false, italic: false, rtl: false });
    expect(buildLayout([{ width: 612, height: 792, items }])).toEqual({ layout: null, reason: 'MULTI_COLUMN' });
  });
});

describe('rebuilding the CV as DOCX from its layout', () => {
  it('keeps the design and changes only the edited text', async () => {
    const layout = await designedLayout();
    const { buffer, unplaced } = await buildLayoutDocx({
      layout,
      edits: [
        {
          before: 'Designed Node.js APIs backed by PostgreSQL; shipped them with Docker.',
          after: 'Designed Node.js REST APIs backed by PostgreSQL; shipped them with Docker.',
        },
      ],
    });
    expect(unplaced).toBe(0);
    const xml = await docxXml(buffer);
    expect(xml).toContain('Designed Node.js REST APIs backed by PostgreSQL');
    expect(xml).not.toContain('Designed Node.js APIs backed');
    expect(xml).toContain('Built TypeScript and React dashboards'); // untouched bullet
    expect(xml).toContain('<w:jc w:val="center"/>'); // centered header
    expect(xml).toMatch(/<w:tab w:val="right" w:pos="\d+"\/>/); // dates flush right
    expect(xml).toContain('2021 - present');
    expect(xml).toContain('w:rFonts w:ascii="Arial"');
    expect(xml).toContain('<w:sz w:val="36"/>'); // the 18 pt name
    expect(xml).toMatch(/w:lineRule="exact"/);
  });

  it('starts each original page on a new page', async () => {
    const layout = await designedLayout([DESIGNED_CV_LINES, [{ text: 'Projects', bold: true }, 'Robot arm controller in C++.']]);
    const xml = await docxXml((await buildLayoutDocx({ layout, edits: [] })).buffer);
    expect(xml.match(/<w:pageBreakBefore\/>/g)).toHaveLength(1);
  });

  it('reports an edit it cannot place, so the caller can fall back to the template', async () => {
    const layout = await designedLayout();
    const { unplaced } = await buildLayoutDocx({ layout, edits: [{ before: 'A sentence that is not in this CV.', after: 'x' }] });
    expect(unplaced).toBe(1);
  });

  it('appends skills the guard added to the skills line, with its separator', async () => {
    const layout = await designedLayout([[...DESIGNED_CV_LINES, '', { text: 'Skills', bold: true }, 'TypeScript, React, Node.js, PostgreSQL']]);
    const xml = await docxXml(
      (await buildLayoutDocx({ layout, edits: [], skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'], addedSkills: ['Kubernetes'] })).buffer,
    );
    expect(xml).toContain(', Kubernetes');
  });
});

describe('keeping the page count and the summary', () => {
  it('limits each text to the lines it takes in the original', async () => {
    const layout = await designedLayout();
    const bullet = 'Built TypeScript and React dashboards used by 40,000 customers.';
    const limits = lengthLimits(layout, [
      { id: 'b1', text: bullet },
      { id: 'b2', text: 'Not in the layout at all.' },
    ]);
    const limit = limits.get('b1')!;
    expect(limit).toBeGreaterThanOrEqual(bullet.length); // room to fill the rest of its line…
    expect(limit).toBeLessThan(bullet.length * 1.6); // …but not to add a line
    expect(limits.has('b2')).toBe(false);
    expect(comparable(' A  b ')).toBe('ab');
  });

  it('finds the words a summary rewrite drops (plurals and -ing forms count as kept)', () => {
    const before =
      'B.Sc. Computer Science graduate with hands-on experience building full-stack web applications. ' +
      'Experienced in frontend/backend integration, database-driven applications, and AI coding tools.';
    const shortened = 'B.Sc. Computer Science graduate and Junior Full-Stack Developer building full-stack web applications.';
    expect(droppedWords(before, shortened)).toEqual(
      expect.arrayContaining(['hands', 'experience', 'frontend', 'backend', 'integration', 'database', 'coding', 'tools']),
    );
    const extended = `${before.replace('building', 'builds')} Also React and TypeScript.`;
    expect(droppedWords(before, extended)).toEqual([]);
  });
});
