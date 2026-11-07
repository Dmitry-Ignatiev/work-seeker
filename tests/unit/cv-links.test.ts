import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { classifyLink, collectLinks, headerLinks, linkForTitle, normalizeLinkUrl, parseStoredLinks } from '@/server/cv/links';
import { buildCvDocx } from '@/server/tailor/docx';
import type { CvStructure } from '@/server/tailor/types';

// The links from a real CV (header labels and project titles), as the PDF reader returns them.
const RAW = [
  { url: 'https://www.linkedin.com/in/dmitry-ignatiev/', anchor: 'LinkedI' },
  { url: 'https://www.linkedin.com/in/dmitry-ignatiev', anchor: 'In|0527274124' },
  { url: 'https://github.com/Dmitry-Ignatiev/', anchor: '124|Git' },
  { url: 'https://gitlab.com/Dmitry-Ignatiev', anchor: 'Hub|GitLab |' },
  { url: 'https://dmitry-ignatiev.github.io/', anchor: '| Portfolio' },
  { url: 'https://github.com/Dmitry-Ignatiev/Miklat_Finder', anchor: 'Miklat Finder' },
  { url: 'https://gitlab.com/maxjp5/focus', anchor: 'Focus (Python, Django,' },
  { url: 'mailto:dima@example.com', anchor: 'dima@example.com' },
];

describe('CV links', () => {
  it('keep only web and email addresses, without credentials', () => {
    expect(normalizeLinkUrl('https://github.com/dana')).toBe('https://github.com/dana');
    expect(normalizeLinkUrl('www.dana.dev')).toBe('https://www.dana.dev/');
    expect(normalizeLinkUrl('mailto:dana@example.com')).toBe('mailto:dana@example.com');
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:pw@evil.test/', 'mailto:nobody', '', `https://a.test/${'x'.repeat(600)}`]) {
      expect(normalizeLinkUrl(bad)).toBeNull();
    }
  });

  it('are labelled by their address: profiles, portfolio sites, projects', () => {
    expect(classifyLink('https://www.linkedin.com/in/dana/')).toEqual({ kind: 'LINKEDIN', label: 'LinkedIn' });
    expect(classifyLink('https://github.com/dana')).toEqual({ kind: 'GITHUB', label: 'GitHub' });
    expect(classifyLink('https://github.com/dana/repo')).toEqual({ kind: 'PROJECT', label: 'GitHub' });
    expect(classifyLink('https://gitlab.com/dana')).toEqual({ kind: 'GITLAB', label: 'GitLab' });
    expect(classifyLink('https://dana.github.io/')).toEqual({ kind: 'PORTFOLIO', label: 'Portfolio' });
    expect(classifyLink('https://www.dana.dev/')).toEqual({ kind: 'WEBSITE', label: 'dana.dev' });
    expect(classifyLink('mailto:dana@example.com')).toEqual({ kind: 'EMAIL', label: 'dana@example.com' });
  });

  it('are de-duplicated (trailing slash, www) and keep the CV order for the header', () => {
    const links = collectLinks(RAW);
    expect(links.filter(l => l.kind === 'LINKEDIN')).toHaveLength(1);
    expect(headerLinks(links).map(l => l.label)).toEqual(['LinkedIn', 'GitHub', 'GitLab', 'Portfolio']);
  });

  it('find the link that sat on a project title, and none for other entries', () => {
    const links = collectLinks(RAW);
    expect(linkForTitle('Miklat Finder', links)?.url).toBe('https://github.com/Dmitry-Ignatiev/Miklat_Finder');
    expect(linkForTitle('Miklat Finder (TypeScript, React)', links)?.url).toBe('https://github.com/Dmitry-Ignatiev/Miklat_Finder');
    expect(linkForTitle('Focus', links)?.url).toBe('https://gitlab.com/maxjp5/focus');
    expect(linkForTitle('ACID Technologies', links)).toBeUndefined();
    expect(linkForTitle('Git', links)).toBeUndefined(); // a profile link is never a project title's link
    expect(linkForTitle(undefined, links)).toBeUndefined();
  });

  it('read back from storage, dropping anything malformed', () => {
    const stored = JSON.parse(JSON.stringify(collectLinks(RAW)));
    expect(parseStoredLinks(stored)).toEqual(collectLinks(RAW));
    expect(parseStoredLinks([{ url: 'javascript:x' }, 'nope', null, { anchor: 'no url' }])).toEqual([]);
    expect(parseStoredLinks(null)).toEqual([]);
  });

  it('come back as clickable links in the tailored DOCX: header items and project titles', async () => {
    const links = collectLinks(RAW);
    const structure: CvStructure = {
      rtl: false,
      skills: ['React'],
      sections: [
        { kind: 'PROJECTS', heading: 'Projects', entries: [{ title: 'Miklat Finder', bullets: [{ id: 'b1', text: 'Built a shelter map.' }] }] },
      ],
    };
    const buffer = await buildCvDocx({
      name: 'Dana Levi',
      contact: [
        { text: 'dima@example.com', url: 'mailto:dima@example.com' },
        { text: '050-1234567' },
        ...headerLinks(links).map(l => ({ text: l.label, url: l.url })),
      ],
      links,
      structure,
    });
    const zip = await JSZip.loadAsync(buffer);
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    const body = await zip.file('word/document.xml')!.async('string');
    for (const url of [
      'mailto:dima@example.com',
      'https://www.linkedin.com/in/dmitry-ignatiev/',
      'https://github.com/Dmitry-Ignatiev/',
      'https://gitlab.com/Dmitry-Ignatiev',
      'https://dmitry-ignatiev.github.io/',
      'https://github.com/Dmitry-Ignatiev/Miklat_Finder',
    ]) {
      expect(rels).toContain(`Target="${url}"`);
    }
    expect(body.match(/<w:hyperlink /g)).toHaveLength(6);
    expect(body).toContain('Portfolio');
  });
});
