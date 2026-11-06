import { describe, expect, it } from 'vitest';
import { normalizeAshby, normalizeGreenhouse, normalizeLever } from '@/server/discovery/ats/boards';
import { detectJobSource } from '@/server/discovery/ats/detect';
import { extractJobPostings, jobLocationText } from '@/server/discovery/jsonld';
import { isIsraelLocation, isRemoteLocation } from '@/server/discovery/location';
import { needsPaste, normalizeUrl } from '@/server/discovery/normalize-url';
import { jobFingerprint, rankJobs } from '@/server/discovery/ranking';
import { pagesForQuery, parseGotFriendsJobPage, parseGotFriendsListing } from '@/server/discovery/scrape/gotfriends';
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

// GotFriends puts several objects in one script tag, separated by commas (not valid JSON on its own).
const JSONLD_JOBS = `<html><head>
<script type="application/ld+json">{ "@context": "https://schema.org", "@type": "Organization", "name": "Gotfriends" }</script>
<script type="application/ld+json">
${posting(100001, 'Backend Developer בחברת סייבר', 'פיתוח ב-Go &amp; Kubernetes')},
${posting(100002, 'Senior Node.js Engineer')}
</script></head><body>…</body></html>`;

const card = (id: number, title: string, location: string, body: string) => `
<div class="item"> <a href="/jobslobby/software/backend-developer/${id}/" class="position p-1108"> <h2 class="title">${title}</h2> </a>
 <strong class="hotornot ir">משרה חמה</strong>
 <div class="item_content"><div class="inner"><section class="info meta"><dl><dd>
 <span class="info-label">מיקום:</span> <span class="info-data"> ${location} </span>
 </dd></dl></section>
 <div class="desc"> <div class="title_c">תיאור המשרה:</div> ${body}
 <div class="x Models.Jobsprofessionarea>.Id">מס&#x27; משרה: ${id}</div>
 <div class="bottom"> <button class="popupHpOpen button">שלחו קורות חיים עכשיו</button> </div>
 </div></div></div>`;

// Role pages: the real jobs are HTML cards; their JSON-LD lists categories (no job number), which must be ignored.
const LISTING = `<html><head><script type="application/ld+json">
{ "@type": "JobPosting", "title": "SRE", "identifier": { "name": "Gotfriends", "value": null }, "url": "https://www.gotfriends.co.il/jobslobby/system/sre/" }
</script></head><body><div class="list panel">
${card(155417, 'Backend Developer בחברת סייבר', 'ת&quot;א והמרכז', 'פיתוח ב-Go &amp; Kubernetes.<br /><br />דרישות המשרה:<br />- 3 שנות ניסיון ב-Go<br />- ניסיון עם Kubernetes')}
${card(155418, 'Senior Node.js Engineer', 'חיפה והצפון', 'צוות קטן.<br />דרישות המשרה:<br />- Node.js')}
</div><footer>…</footer></body></html>`;

const JOB_PAGE = `<html><head><script type="application/ld+json">${posting(100001, 'Backend Developer בחברת סייבר')}</script>
<style>.x{}</style></head><body>
<nav>דף הבית &gt; דרושים הייטק</nav>
<h1>Backend Developer בחברת סייבר</h1>
<div>מיקום:</div><div> ת&quot;א והמרכז</div>
<div>תיאור המשרה:</div>
<div>החברה מפתחת פלטפורמת אבטחה.</div>
<div>דרישות המשרה:</div><ul><li>- 3 שנות ניסיון ב-Go</li><li>- ניסיון עם Kubernetes</li></ul>
<span class="x.Id">מס&#x27; משרה: 100001</span>
<div>שלחו קורות חיים עכשיו</div>
<div>משרות נוספות: Frontend…</div>
</body></html>`;

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

describe('GotFriends', () => {
  it('maps queries to role pages, best match first', () => {
    expect(pagesForQuery('Senior backend engineer')[0]).toBe('/jobslobby/software/backend-developer/');
    expect(pagesForQuery('DevOps with Kubernetes')).toContain('/jobslobby/system/devops-positions/');
    expect(pagesForQuery('מפתח פולסטאק')[0]).toBe('/jobslobby/software/full-stack-developer/');
    expect(pagesForQuery('QA automation')).toEqual(['/jobslobby/qa/automation-developer/', '/jobslobby/qa/qa-positions/']);
    expect(pagesForQuery('something unusual')).toEqual(['/jobslobby/software/']);
    expect(pagesForQuery('react node full stack typescript python').length).toBeLessThanOrEqual(2);
  });

  it('parses job cards with location and the full description, ignoring category JSON-LD', () => {
    const jobs = parseGotFriendsListing(LISTING);
    expect(jobs.map(j => j.id)).toEqual(['gotfriends:155417', 'gotfriends:155418']);
    expect(jobs[0]).toMatchObject({
      source: 'gotfriends',
      title: 'Backend Developer בחברת סייבר',
      location: 'ת"א והמרכז',
      url: 'https://www.gotfriends.co.il/jobslobby/software/backend-developer/155417/',
    });
    expect(jobs[0].description).toBe('פיתוח ב-Go & Kubernetes.\nדרישות המשרה:\n- 3 שנות ניסיון ב-Go\n- ניסיון עם Kubernetes');
    expect(jobs[1].location).toBe('חיפה והצפון');
  });

  it('falls back to JSON-LD entries that link to real jobs', () => {
    const jobs = parseGotFriendsListing(JSONLD_JOBS);
    expect(jobs.map(j => j.id)).toEqual(['gotfriends:100001', 'gotfriends:100002']);
    expect(jobs[0]).toMatchObject({ location: 'Israel', postedAt: '2026-11-05', description: 'פיתוח ב-Go & Kubernetes' });
  });

  it('reads location and full description with requirements from the job page', () => {
    const page = parseGotFriendsJobPage(JOB_PAGE);
    expect(page.location).toBe('ת"א והמרכז');
    expect(page.description).toContain('החברה מפתחת פלטפורמת אבטחה.');
    expect(page.description).toContain('3 שנות ניסיון ב-Go');
    expect(page.description).not.toContain('משרות נוספות');
    expect(page.title).toBe('Backend Developer בחברת סייבר');
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

  it('detects board and GotFriends links', () => {
    const d = (u: string) => detectJobSource(new URL(u));
    expect(d('https://boards.greenhouse.io/riskified/jobs/8725597002')).toEqual({ kind: 'board', ats: 'greenhouse', slug: 'riskified', jobId: '8725597002' });
    expect(d('https://job-boards.greenhouse.io/wizinc')).toEqual({ kind: 'board', ats: 'greenhouse', slug: 'wizinc', jobId: undefined });
    expect(d('https://boards.greenhouse.io/embed/job_app?for=taboola&token=123')).toMatchObject({ slug: 'taboola', jobId: '123' });
    expect(d('https://jobs.lever.co/walkme/6ed7-uuid')).toMatchObject({ ats: 'lever', slug: 'walkme', jobId: '6ed7-uuid' });
    expect(d('https://jobs.ashbyhq.com/lemonade')).toMatchObject({ ats: 'ashby', slug: 'lemonade' });
    expect(d('https://www.gotfriends.co.il/jobslobby/software/frontend-developer/155470/')).toEqual({ kind: 'gotfriends', jobId: '155470' });
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

  it('prefers title matches, Israel, recency and the requested seniority', () => {
    const now = new Date('2026-11-07');
    const titleHit = job({ title: 'Senior Backend Engineer', postedAt: '2026-11-05' });
    const descHit = job({ title: 'Engineer II', description: 'backend services', location: 'Berlin', remote: true });
    const junior = job({ title: 'Junior Backend Developer', postedAt: '2026-11-05' });
    const ranked = rankJobs([descHit, junior, titleHit], { query: 'backend', seniority: 'senior', now });
    expect(ranked[0].job).toBe(titleHit);
    expect(ranked.at(-1)?.job).toBe(descHit);
    expect(rankJobs([titleHit, junior], { query: 'backend', seniority: 'junior', now })[0].job).toBe(junior);
  });

  it('keeps topical-source results (role pages) even without a keyword hit', () => {
    const hebrew = job({ source: 'gotfriends', title: 'מפתח/ת צד שרת' });
    expect(rankJobs([hebrew], { query: 'backend', topicalSources: new Set(['gotfriends']) })).toHaveLength(1);
    expect(rankJobs([hebrew], { query: 'backend' })).toHaveLength(0);
  });
});
