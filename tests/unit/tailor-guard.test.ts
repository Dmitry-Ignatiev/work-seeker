import { describe, expect, it } from 'vitest';
import { applyGuard, type GuardInput } from '@/server/tailor/guard';
import { containsTerm, isQuoteIn, numbersIn } from '@/server/tailor/text-match';
import type { CvStructure, JobKeyword, TailorOutput } from '@/server/tailor/types';
import { buildStructure, validateKeywords } from '@/server/tailor/validate';

const CV_TEXT = `Dana Levi
Backend Developer
Experience
Acme Ltd, Backend Developer, 2021 - present
Designed Node.js APIs backed by PostgreSQL; cut response times by 30%.
Ran our services on k8s and wrote automated tests for every release.
Mentored two junior developers.`;

const STRUCTURE: CvStructure = {
  headline: 'Backend Developer',
  sections: [
    {
      kind: 'EXPERIENCE',
      heading: 'Experience',
      entries: [
        {
          title: 'Backend Developer',
          organization: 'Acme Ltd',
          dates: '2021 - present',
          bullets: [
            { id: 'b0.0.0', text: 'Designed Node.js APIs backed by PostgreSQL; cut response times by 30%.' },
            { id: 'b0.0.1', text: 'Ran our services on k8s and wrote automated tests for every release.' },
            { id: 'b0.0.2', text: 'Mentored two junior developers.' },
          ],
        },
      ],
    },
  ],
  skills: [],
  rtl: false,
};

const kw = (keyword: string, strict = true, importance: 'MUST' | 'NICE' = 'MUST'): JobKeyword => ({ keyword, strict, importance, quote: keyword });

const SYNONYMS: Record<string, string[]> = { kubernetes: ['Kubernetes', 'k8s'], k8s: ['Kubernetes', 'k8s'] };
const TECH = ['Kubernetes', 'Rust', 'Terraform', 'Python', 'Node.js', 'PostgreSQL', 'AWS'];

function run(output: Partial<TailorOutput>, keywords: JobKeyword[], confirmed: string[] = [], extra: Partial<GuardInput> = {}) {
  const input: GuardInput = {
    cvText: CV_TEXT,
    structure: STRUCTURE,
    keywords,
    confirmed,
    ...extra,
    synonyms: term => SYNONYMS[term.toLowerCase()] ?? [term],
    skillsIn: text =>
      new Set(TECH.filter(t => [t, ...(SYNONYMS[t.toLowerCase()] ?? [])].some(s => containsTerm(text, s)))),
    output: { summary: null, edits: [], ...output },
  };
  return applyGuard(input);
}

const edit = (bulletId: string, text: string, evidence: string[] = []) => ({ bulletId, text, evidence });

describe('truthfulness guard', () => {
  it('rejects an edit that no longer fits its lines, so the CV keeps its page count', () => {
    const bullet = 'Ran our services on k8s and wrote automated tests for every release.';
    const longer = 'Ran our services on Kubernetes and wrote automated tests for every release.';
    const tight = run({ edits: [edit('b0.0.1', longer)] }, [kw('Kubernetes')], [], { limits: new Map([['b0.0.1', bullet.length]]) });
    expect(tight.changes).toEqual([]);
    expect(tight.rejected[0].reason).toBe('it would no longer fit its lines, and your CV would get longer');
    const roomy = run({ edits: [edit('b0.0.1', longer)] }, [kw('Kubernetes')], [], { limits: new Map([['b0.0.1', 100]]) });
    expect(roomy.changes).toHaveLength(1);
  });

  it('rejects a summary rewrite that drops what the candidate wrote, and accepts one that only adds', () => {
    const summary = 'Backend developer experienced in database-driven applications and automated testing.';
    const structure = { ...STRUCTURE, summary };
    const dropped = run(
      { summary: { text: 'Backend developer building Node.js APIs.', evidence: [] } },
      [],
      [],
      { structure, cvText: `${CV_TEXT}\n${summary}` },
    );
    expect(dropped.changes).toEqual([]);
    expect(dropped.rejected[0].reason).toMatch(/^it would remove "experienced", "database", "driven" from your summary$/);

    const added = run(
      { summary: { text: 'Backend developer experienced in database-driven Node.js applications and automated testing.', evidence: [] } },
      [kw('Node.js')],
      [],
      { structure, cvText: `${CV_TEXT}\n${summary}` },
    );
    expect(added.changes).toHaveLength(1);
  });

  it('rejects a technology the CV never mentions', () => {
    const r = run({ edits: [edit('b0.0.2', 'Mentored two junior developers on Terraform.')] }, [kw('Terraform')]);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0].reason).toBe('"Terraform" isn\'t in your CV');
    expect(r.missing).toEqual(['Terraform']);
  });

  it('accepts the job’s exact term when the CV says the same thing differently (k8s → Kubernetes)', () => {
    const r = run(
      { edits: [edit('b0.0.1', 'Ran our services on Kubernetes and wrote automated tests for every release.')] },
      [kw('Kubernetes')],
    );
    expect(r.changes).toEqual([
      expect.objectContaining({ bulletId: 'b0.0.1', keywords: ['Kubernetes'], reworded: false }),
    ]);
    expect(r.coverageBefore).toBe(0);
    expect(r.coverageAfter).toBe(1);
  });

  it('adds a backed strict keyword to the skills list when no bullet uses it', () => {
    const r = run({}, [kw('Kubernetes'), kw('Node.js')]);
    expect(r.skillsAdded).toEqual(['Kubernetes']); // Node.js is already written exactly
    expect(r.structure.skills).toContain('Kubernetes');
    expect(r.coverageAfter).toBe(2);
  });

  it('accepts a reworded responsibility only with a real CV quote, and flags it', () => {
    const backed = run(
      { edits: [edit('b0.0.1', 'Ran our services on k8s and owned test automation for every release.', ['wrote automated tests for every release'])] },
      [kw('test automation', false)],
    );
    expect(backed.changes[0]).toMatchObject({ keywords: ['test automation'], reworded: true });

    const invented = run(
      { edits: [edit('b0.0.1', 'Ran our services on k8s and owned test automation for every release.', ['led the QA guild'])] },
      [kw('test automation', false)],
    );
    expect(invented.changes).toEqual([]);
    expect(invented.rejected[0].reason).toBe('nothing in your CV backs "test automation"');
  });

  it('never accepts new numbers', () => {
    const r = run({ edits: [edit('b0.0.0', 'Designed Node.js APIs backed by PostgreSQL; cut response times by 45%.')] }, []);
    expect(r.rejected[0].reason).toBe('adds the number "45%", which your CV doesn\'t state');
  });

  it('accepts experience the user confirmed', () => {
    const r = run({ edits: [edit('b0.0.2', 'Mentored two junior developers and introduced Terraform.')] }, [kw('Terraform')], ['Terraform']);
    expect(r.changes[0].keywords).toEqual(['Terraform']);
    expect(r.missing).toEqual([]);
  });

  it('rejects other technologies sneaking in, even if the job didn’t ask for them', () => {
    const r = run({ edits: [edit('b0.0.2', 'Mentored two junior developers in Rust.')] }, []);
    expect(r.rejected[0].reason).toBe("mentions Rust, which isn't in your CV");
  });

  it('rejects edits that drop a job keyword the bullet had', () => {
    const r = run({ edits: [edit('b0.0.0', 'Designed APIs backed by PostgreSQL; cut response times by 30%.')] }, [kw('Node.js')]);
    expect(r.rejected[0].reason).toBe('would remove "Node.js" from your CV');
  });

  it('ignores unknown bullet ids and keeps the original text of rejected bullets', () => {
    const r = run({ edits: [edit('b9.9.9', 'Invented a startup.'), edit('b0.0.2', 'Mentored two junior developers in Rust.')] }, []);
    expect(r.changes).toEqual([]);
    expect(r.rejected).toHaveLength(1);
    expect(r.structure.sections[0].entries[0].bullets[2].text).toBe('Mentored two junior developers.');
  });

  it('checks a rewritten summary against the whole CV', () => {
    const ok = run({ summary: { text: 'Backend developer building Node.js APIs; cut response times by 30%.', evidence: [] } }, [kw('Node.js')]);
    expect(ok.changes[0].bulletId).toBe('summary');
    expect(ok.structure.summary).toContain('Node.js APIs');
    const bad = run({ summary: { text: 'Backend developer with 10 years of experience.', evidence: [] } }, []);
    expect(bad.rejected[0].reason).toContain('"10"');
  });
});

describe('text matching', () => {
  it('matches whole terms, spelling variants and Hebrew prefixes', () => {
    expect(containsTerm('ניסיון בפיתוח ב-React ו-TypeScript', 'React')).toBe(true);
    expect(containsTerm('ניסיון בפיתוח ובReact', 'react')).toBe(true);
    expect(containsTerm('Built NodeJS services', 'Node.js')).toBe(true);
    expect(containsTerm('full-stack developer', 'Full Stack')).toBe(true);
    expect(containsTerm('JavaScript developer', 'Java')).toBe(false);
    expect(containsTerm('C++ and C#', 'C')).toBe(false);
  });

  it('finds quotes ignoring case and whitespace, and extracts numbers', () => {
    expect(isQuoteIn('Ran our services\non k8s', 'ran our services on K8S')).toBe(true);
    expect(isQuoteIn('abc', 'zz')).toBe(false);
    expect([...numbersIn('Saved 40,000 users 30% time in 2021')].sort()).toEqual(['2021', '30%', '40000']);
  });
});

describe('validating model output', () => {
  const posting = 'Requirements: 3+ years with Kubernetes (k8s). Experience with Go is an advantage. B2B SaaS background.';

  it('keeps keywords with a real quote that names them', () => {
    const result = validateKeywords(
      posting,
      {
        keywords: [
          { keyword: 'Kubernetes', kind: 'TECH', importance: 'MUST', quote: '3+ years with Kubernetes (k8s)' },
          { keyword: 'Go', kind: 'TECH', importance: 'NICE', quote: 'Experience with Go is an advantage' },
          { keyword: 'Rust', kind: 'TECH', importance: 'MUST', quote: 'Experience with Rust' }, // invented quote
          { keyword: 'AWS', kind: 'TECH', importance: 'MUST', quote: 'B2B SaaS background' }, // quote doesn't name it
          { keyword: 'B2B SaaS', kind: 'DOMAIN', importance: 'MUST', quote: 'B2B SaaS background' },
          { keyword: 'kubernetes', kind: 'TECH', importance: 'MUST', quote: 'Kubernetes' }, // duplicate
        ],
      },
    );
    expect(result).toEqual([
      { keyword: 'Kubernetes', strict: true, importance: 'MUST', quote: '3+ years with Kubernetes (k8s)' },
      { keyword: 'Go', strict: true, importance: 'NICE', quote: 'Experience with Go is an advantage' },
      { keyword: 'B2B SaaS', strict: false, importance: 'MUST', quote: 'B2B SaaS background' },
    ]);
  });

  it('builds a CV structure from verbatim text only, with stable bullet ids', () => {
    const structure = buildStructure(CV_TEXT, {
      headline: 'Backend Developer',
      sections: [
        {
          kind: 'EXPERIENCE',
          heading: 'Experience',
          entries: [
            {
              title: 'Backend Developer',
              organization: 'Acme Ltd',
              dates: '2021 - present',
              bullets: ['Mentored two junior developers.', 'Led a team of 40 engineers.'], // second one is invented
            },
            { title: 'CTO', organization: 'Google', bullets: [] }, // invented entry
          ],
        },
      ],
      skills: ['Node.js', 'Rust'],
    });
    expect(structure.sections[0].entries).toEqual([
      {
        title: 'Backend Developer',
        organization: 'Acme Ltd',
        dates: '2021 - present',
        bullets: [{ id: 'b0.0.0', text: 'Mentored two junior developers.' }],
      },
    ]);
    expect(structure.skills).toEqual(['Node.js']);
    expect(structure.rtl).toBe(false);
  });
});
