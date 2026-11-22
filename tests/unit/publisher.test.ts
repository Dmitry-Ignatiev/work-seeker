import { describe, expect, it } from 'vitest';
import { isFromSite, JOB_SITES, publisherName, siteName } from '@/server/discovery/publisher';
import { jsearchParams } from '@/server/discovery/sources/jsearch';

describe('publisherName', () => {
  it('names the job site a listing came from', () => {
    expect(publisherName('https://il.linkedin.com/jobs/view/qa-engineer-123')).toBe('LinkedIn');
    expect(publisherName('https://www.glassdoor.co.il/job-listing/abc')).toBe('Glassdoor');
    expect(publisherName('https://www.gotfriends.co.il/jobslobby/qa/automation-developer/155417/')).toBe('GotFriends');
    expect(publisherName('https://www.drushim.co.il/job/123/')).toBe('Drushim');
    expect(publisherName('https://www.comeet.com/jobs/acme/1.2/qa/AB.CD')).toBe('Comeet');
  });

  it('returns null for company sites and bad links', () => {
    expect(publisherName('https://careers.example.com/jobs/1')).toBeNull();
    expect(publisherName('https://notlinkedin.com/jobs')).toBeNull();
    expect(publisherName('not a url')).toBeNull();
    expect(publisherName(null)).toBeNull();
  });
});

describe('isFromSite', () => {
  it('matches only the site asked for', () => {
    expect(isFromSite('https://il.linkedin.com/jobs/view/1', 'linkedin')).toBe(true);
    expect(isFromSite('https://il.linkedin.com/jobs/view/1', 'glassdoor')).toBe(false);
    expect(isFromSite('https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=1', 'alljobs')).toBe(true);
  });

  it('knows a name for every site it can search', () => {
    for (const site of JOB_SITES) expect(siteName(site)).toBeTruthy();
  });
});

describe('jsearchParams with a site', () => {
  it('asks Google for that site’s listings, still in Israel', () => {
    expect(Object.fromEntries(jsearchParams({ query: 'qa engineer', site: 'gotfriends' }))).toMatchObject({
      query: 'qa engineer in Israel via GotFriends',
      country: 'il',
    });
  });
});
