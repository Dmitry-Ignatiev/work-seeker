import { describe, expect, it } from 'vitest';
import { normalizeAshby, normalizeGreenhouse, normalizeLever } from '@/server/discovery/ats/boards';
import { detectJobSource } from '@/server/discovery/ats/detect';
import { extractJobPostings, jobLocationText } from '@/server/discovery/jsonld';
import { isIsraelLocation, isRemoteLocation } from '@/server/discovery/location';
import { needsPaste, normalizeUrl } from '@/server/discovery/normalize-url';
import { jobFingerprint, rankJobs, titleMatchesRole, titleSearchWords, wantedSeniority } from '@/server/discovery/ranking';
import { htmlToText } from '@/server/discovery/text';
import type { Job } from '@/server/discovery/types';

// Hand-made fixtures that mirror each source's structure (no real listings are copied into the repo).

const posting = (id: number, title: string, description = 'תיאור קצר של המשרה') => `{
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  "title": "${title}",
  "description": "${description}",
  "identifier": { "@type": "PropertyValue", "name": "Gotfriends", "value": "${id}" },
  "datePosted": "2026-11-05",
  "employmentType": "FULL_TIME",
  "hiringOrganization": { "@type": "Organization", "name": "Gotfriends" },
  "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "addressCountry": "IL" } },
  "url": "https://www.gotfriends.co.il/jobslobby/software/backend-developer/${id}/"
}`;

// Some sites put several objects in one script tag, separated by commas (not valid JSON on its own).
const JSONLD_JOBS = `<html><head>
<script type="application/ld+json">{ "@context": "https://schema.org", "@type": "Organization", "name": "Gotfriends" }</script>
<script type="application/ld+json">
${posting(100001, 'Backend Developer בחברת סייבר', 'פיתוח ב-Go &amp; Kubernetes')},
${posting(100002, 'Senior Node.js Engineer')}
</script></head><body>…</body></html>`;

describe('JSON-LD', () => {
  it('reads comma-separated objects in one script tag, and @graph', () => {
    expect(extractJobPostings(JSONLD_JOBS)).toHaveLength(2);
    const graph = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"JobPosting","title":"X"}]}</script>`;
    expect(extractJobPostings(graph).map(p => p.title)).toEqual(['X']);
  });

  it('skips a broken object but keeps the others', () => {
    const page = `<script type="application/ld+json">{"@type":"JobPosting","title":"A"},{"@type": oops},{"@type":"JobPosting","title":"B"}</script>`;
    expect(extractJobPostings(page).map(p => p.title)).toEqual(['A', 'B']);
  });

  it('formats schema.org locations', () => {
    expect(jobLocationText({ address: { addressCountry: 'IL' } })).toBe('Israel');
    expect(jobLocationText([{ address: { addressLocality: 'Tel Aviv', addressCountry: 'IL' } }])).toBe('Tel Aviv, Israel');
  });
});

describe('company boards', () => {
  const board = { ats: 'greenhouse' as const, slug: 'acme', companyName: 'Acme' };

  it('normalizes Greenhouse (entity-encoded HTML content)', () => {
    const job = normalizeGreenhouse(board, {
      id: 42,
      title: ' Backend Engineer ',
      absolute_url: 'https://acme.com/careers/?gh_jid=42',
      location: { name: 'Tel Aviv' },
      content: '&lt;p&gt;Build &lt;b&gt;APIs&lt;/b&gt; in Go&lt;/p&gt;',
      first_published: '2026-11-01T10:00:00Z',
      departments: [{ name: 'R&D' }],
    });
    expect(job).toMatchObject({ id: 'greenhouse:acme:42', title: 'Backend Engineer', location: 'Tel Aviv', remote: false, tags: ['R&D'] });
    expect(job.description).toBe('Build APIs in Go');
  });

  it('normalizes Lever, including list sections', () => {
    const job = normalizeLever({ ...board, ats: 'lever' }, {
      id: 'abc',
      text: 'QA Automation Engineer',
      hostedUrl: 'https://jobs.lever.co/acme/abc',
      categories: { location: 'Remote - EMEA', team: 'QA', commitment: 'Full-time' },
      workplaceType: 'remote',
      descriptionPlain: 'Join us.',
      lists: [{ text: 'Requirements', content: '<li>Playwright</li><li>CI</li>' }],
    });
    expect(job).toMatchObject({ id: 'lever:acme:abc', remote: true, tags: ['QA', 'Full-time'] });
    expect(job.description).toContain('Requirements\nPlaywright');
  });

  it('normalizes Ashby with its address', () => {
    const job = normalizeAshby({ ...board, ats: 'ashby' }, {
      id: 'u1',
      title: 'Data Engineer',
      jobUrl: 'https://jobs.ashbyhq.com/acme/u1',
      location: 'TLV',
      address: { postalAddress: { addressLocality: 'Tel Aviv', addressCountry: 'Israel' } },
      department: 'Data',
      team: 'Data',
      descriptionPlain: 'Spark and Airflow.',
    });
    expect(job).toMatchObject({ id: 'ashby:acme:u1', location: 'TLV · Tel Aviv · Israel', tags: ['Data'] });
    expect(isIsraelLocation(job.location)).toBe(true);
  });

  it('detects company board links', () => {
    const d = (u: string) => detectJobSource(new URL(u));
    expect(d('https://boards.greenhouse.io/riskified/jobs/8725597002')).toEqual({ kind: 'board', ats: 'greenhouse', slug: 'riskified', jobId: '8725597002' });
    expect(d('https://job-boards.greenhouse.io/wizinc')).toEqual({ kind: 'board', ats: 'greenhouse', slug: 'wizinc', jobId: undefined });
    expect(d('https://boards.greenhouse.io/embed/job_app?for=taboola&token=123')).toMatchObject({ slug: 'taboola', jobId: '123' });
    expect(d('https://jobs.lever.co/walkme/6ed7-uuid')).toMatchObject({ ats: 'lever', slug: 'walkme', jobId: '6ed7-uuid' });
    expect(d('https://jobs.ashbyhq.com/lemonade')).toMatchObject({ ats: 'ashby', slug: 'lemonade' });
    expect(d('https://www.gotfriends.co.il/jobslobby/software/frontend-developer/155470/')).toBeNull();
    expect(d('https://example.com/careers')).toBeNull();
  });
});

describe('URLs and locations', () => {
  it('normalizes links and strips tracking parameters', () => {
    expect(normalizeUrl('https://Jobs.Example.com/a?utm_source=x&id=7&gclid=1#apply')?.toString()).toBe('https://jobs.example.com/a?id=7');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });

  it('sends LinkedIn, Indeed and Glassdoor to the paste flow', () => {
    for (const u of ['https://www.linkedin.com/jobs/view/1', 'https://il.indeed.com/viewjob?jk=1', 'https://www.glassdoor.co.uk/job/1', 'https://lnkd.in/abc']) {
      expect(needsPaste(normalizeUrl(u)!)).toBe(true);
    }
    expect(needsPaste(normalizeUrl('https://jobs.lever.co/acme/1')!)).toBe(false);
  });

  it('recognises Israeli and remote locations in English and Hebrew', () => {
    for (const loc of ['Tel Aviv-Yafo', 'Herzliya, Israel', 'TLV', 'ת"א והמרכז', 'חיפה והצפון', 'IL', "Ra'anana"]) {
      expect(isIsraelLocation(loc)).toBe(true);
    }
    for (const loc of ['London', 'New York, NY', 'Remote - US']) expect(isIsraelLocation(loc)).toBe(false);
    expect(isRemoteLocation('Remote - EMEA')).toBe(true);
    expect(isRemoteLocation('Tel Aviv')).toBe(false);
  });

  it('decodes hex entities', () => {
    expect(htmlToText('מס&#x27; משרה &#x2B; C&#x2B;&#x2B;')).toBe("מס' משרה + C++");
  });
});

describe('ranking', () => {
  const job = (over: Partial<Job>): Job => ({
    id: `x:${Math.random()}`,
    source: 'greenhouse',
    title: 'Engineer',
    company: 'Acme',
    location: 'Tel Aviv',
    remote: false,
    tags: [],
    url: 'https://x',
    description: '',
    ...over,
  });

  it('dedupes the same role across sources and drops irrelevant jobs', () => {
    const a = job({ title: 'Backend Engineer', source: 'jsearch' });
    const b = job({ title: 'Backend  engineer', source: 'greenhouse' });
    const c = job({ title: 'Office Manager' });
    expect(jobFingerprint(a)).toBe(jobFingerprint(b));
    expect(rankJobs([a, b, c], { query: 'backend' }).map(r => r.job)).toEqual([a]);
  });

  it('prefers Israel and recency among relevant titles, and keeps only the requested level', () => {
    const now = new Date('2026-11-07');
    const fresh = job({ title: 'Senior Backend Engineer', postedAt: '2026-11-05' });
    const berlin = job({ title: 'Backend Engineer', location: 'Berlin', remote: true });
    const junior = job({ title: 'Junior Backend Developer', postedAt: '2026-11-05' });
    const ranked = rankJobs([berlin, junior, fresh], { query: 'backend', seniority: 'senior', now });
    expect(ranked.map(r => r.job)).toEqual([fresh, berlin]); // the junior role is filtered out
    expect(rankJobs([fresh, junior], { query: 'backend', seniority: 'junior', now }).map(r => r.job)).toEqual([junior]);
  });

  // Real case from a live search: "junior full stack developer" returned these.
  it('needs the role in the title and the right level (junior full-stack search)', () => {
    const titles = {
      keep: ['Junior Full stack Developer', 'Full Stack Developer', 'Fullstack Engineer (Entry Level)', 'Full-Stack Developer, Student'],
      drop: [
        'Senior Full Stack Developer', // wrong level
        'Full Stack Tech Lead', // wrong level
        'Full Stack Team Leader',
        'Experienced Full Stack Engineer',
        'Junior Market Analyst', // only "junior" matches
        'BizOps Junior Associate (Student Position)',
        'Application Security Engineer', // only "engineer" matches
        'DevOps Engineer',
        'Senior Software Engineer - Tel Aviv',
      ],
    };
    const all = [...titles.keep, ...titles.drop].map(title =>
      job({ title, description: 'We build full stack products with React and Node. Junior developers welcome.' }),
    );
    const kept = rankJobs(all, { query: 'junior full stack developer' }).map(r => r.job.title);
    expect(kept.sort()).toEqual([...titles.keep].sort());
  });

  it('matches role spellings and synonyms in titles', () => {
    expect(titleMatchesRole('NodeJS Backend Developer', 'node.js developer')).toBe(true);
    expect(titleMatchesRole('Back-End Engineer', 'backend engineer')).toBe(true);
    expect(titleMatchesRole('SDET / Automation Engineer', 'QA engineer')).toBe(true);
    expect(titleMatchesRole('Site Reliability Engineer', 'sre')).toBe(true);
    expect(titleMatchesRole('Senior DevOps Engineer- IL', 'senior devops engineer kubernetes aws')).toBe(true);
    expect(titleMatchesRole('Senior Applications & Integrations Engineer', 'senior devops engineer kubernetes aws')).toBe(false);
    expect(titleMatchesRole('Customer Success Manager', 'customer success')).toBe(true);
    // A frontend search doesn't return full stack or backend roles, even with a frontend framework in the title.
    expect(titleMatchesRole('Full Stack Developer (React/Node)', 'frontend developer')).toBe(false);
    expect(titleMatchesRole('Full-Stack Engineer, Angular', 'frontend')).toBe(false);
    expect(titleMatchesRole('Backend Engineer', 'frontend developer')).toBe(false);
    expect(titleMatchesRole('React Developer', 'frontend developer')).toBe(true);
    expect(titleMatchesRole('Front End Engineer', 'frontend developer')).toBe(true);
    expect(titleMatchesRole('Frontend / Full Stack Developer', 'frontend developer')).toBe(true);
    expect(titleMatchesRole('Full Stack Engineer', 'backend engineer')).toBe(false);
    expect(titleMatchesRole('Full Stack Engineer (React)', 'react developer')).toBe(true);
    // Only generic words: any engineer/developer title is relevant.
    expect(titleMatchesRole('Senior Software Engineer', 'software engineer')).toBe(true);
    expect(titleMatchesRole('Marketing Manager', 'software engineer')).toBe(false);
  });

  it('reads the level from the query words when it is not passed explicitly', () => {
    expect(wantedSeniority('junior react developer')).toBe('junior');
    expect(wantedSeniority('student position qa')).toBe('junior');
    expect(wantedSeniority('senior go engineer')).toBe('senior');
    expect(wantedSeniority('devops engineer')).toBeUndefined();
    expect(wantedSeniority('devops engineer', 'lead')).toBe('lead');
    expect(titleSearchWords('senior node.js backend engineer')).toEqual(expect.arrayContaining(['node.js', 'nodejs', 'node', 'backend']));
  });

  it('keeps Hebrew-only titles from role pages, but checks their English titles like any other', () => {
    const topicalSources = new Set<Job['source']>(['lever']);
    const hebrew = job({ source: 'lever', title: 'מפתח/ת צד שרת' });
    const wrongRole = job({ source: 'lever', title: 'Backend Engineer בחברת סטארט-אפ' });
    const rightRole = job({ source: 'lever', title: 'Full Stack Software Engineer בחברת סטארט-אפ' });
    expect(rankJobs([hebrew], { query: 'backend', topicalSources })).toHaveLength(1);
    expect(rankJobs([hebrew], { query: 'backend' })).toHaveLength(0);
    expect(rankJobs([wrongRole, rightRole], { query: 'full stack developer', topicalSources }).map(r => r.job)).toEqual([rightRole]);
  });
});
