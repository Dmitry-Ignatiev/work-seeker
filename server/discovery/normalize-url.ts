/** Pure URL normalization and the list of sites we never fetch. */

const TRACKING_PARAMS = /^(utm_\w+|gclid|fbclid|msclkid|mc_cid|mc_eid|ref|refid|trk|trackingid|src|source|lipi|_hsenc|_hsmi)$/i;

/** https, lowercase host, no tracking params, no fragment, no trailing slash noise. Null if not a web URL. */
export function normalizeUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url;
}

/**
 * Sites whose robots.txt or bot protection rules out fetching: the user pastes the description instead.
 * Their listings can still reach us legitimately through JSearch (Google for Jobs).
 */
const NEEDS_PASTE_HOSTS = [/(^|\.)linkedin\.com$/, /(^|\.)indeed\.[a-z.]+$/, /(^|\.)glassdoor\.[a-z.]+$/, /(^|\.)lnkd\.in$/];

export function needsPaste(url: URL): boolean {
  return NEEDS_PASTE_HOSTS.some(pattern => pattern.test(url.hostname));
}
