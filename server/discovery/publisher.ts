/**
 * Which job site a Google for Jobs (JSearch) listing came from, read from its apply link. Pure.
 * JSearch lists jobs from LinkedIn, Glassdoor, Indeed, Israeli boards and company sites; we never read
 * those sites ourselves.
 */

/** Job sites a search can be limited to (through Google for Jobs). */
export const JOB_SITES = [
  'linkedin',
  'glassdoor',
  'indeed',
  'gotfriends',
  'drushim',
  'alljobs',
  'jobmaster',
  'comeet',
  'secrettelaviv',
  'builtin',
  'wellfound',
] as const;
export type JobSite = (typeof JOB_SITES)[number];

const SITES: Record<JobSite, { host: RegExp; name: string }> = {
  linkedin: { host: /(^|\.)linkedin\.com$/, name: 'LinkedIn' },
  glassdoor: { host: /(^|\.)glassdoor\.[a-z.]+$/, name: 'Glassdoor' },
  indeed: { host: /(^|\.)indeed\.[a-z.]+$/, name: 'Indeed' },
  gotfriends: { host: /(^|\.)gotfriends\.co\.il$/, name: 'GotFriends' },
  drushim: { host: /(^|\.)drushim\.co\.il$/, name: 'Drushim' },
  alljobs: { host: /(^|\.)alljobs\.co\.il$/, name: 'AllJobs' },
  jobmaster: { host: /(^|\.)jobmaster\.co\.il$/, name: 'JobMaster' },
  comeet: { host: /(^|\.)comeet\.(com|co)$/, name: 'Comeet' },
  secrettelaviv: { host: /(^|\.)secrettelaviv\.com$/, name: 'Secret Tel Aviv' },
  builtin: { host: /(^|\.)builtin\.com$/, name: 'Built In' },
  wellfound: { host: /(^|\.)(wellfound|angel)\.co$/, name: 'Wellfound' },
};

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** "LinkedIn", "GotFriends"… for a known job site; null for a company's own site or an unknown one. */
export function publisherName(url: string | null | undefined): string | null {
  const host = hostOf(url);
  if (!host) return null;
  return Object.values(SITES).find(s => s.host.test(host))?.name ?? null;
}

/** The site's name as Google for Jobs knows it, for "… via <name>" searches. */
export const siteName = (site: JobSite) => SITES[site].name;

/** Is this listing from the site the user asked for? */
export function isFromSite(url: string | null | undefined, site: JobSite): boolean {
  const host = hostOf(url);
  return Boolean(host && SITES[site].host.test(host));
}
