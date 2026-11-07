/**
 * Links in a CV (the addresses behind "LinkedIn", "GitHub", a project title…). Read from the PDF by code,
 * stored next to the CV text, and put back into the tailored DOCX by code. No model ever sees them.
 * Pure functions: no server-only imports, so they can be unit tested.
 */

export type CvLinkKind = 'EMAIL' | 'LINKEDIN' | 'GITHUB' | 'GITLAB' | 'PORTFOLIO' | 'WEBSITE' | 'PROJECT';

export interface CvLink {
  url: string;
  kind: CvLinkKind;
  /** What to show in the CV header ("LinkedIn", "Portfolio", a host name). */
  label: string;
  /** The text the link sat on in the PDF (e.g. a project title); may be empty. */
  anchor: string;
}

/** A link as found in the PDF: its address and the visible text under it. */
export interface RawLink {
  url: string;
  anchor: string;
}

export const MAX_LINKS = 30;
const MAX_URL_LENGTH = 500;
const MAX_ANCHOR_LENGTH = 200;

/** Only web and email links, without credentials; returns the cleaned URL or null. */
export function normalizeLinkUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(/^www\./i.test(value) ? `https://${value}` : value);
  } catch {
    return null;
  }
  if (url.protocol === 'mailto:') return url.pathname.includes('@') ? `mailto:${url.pathname}` : null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.href;
}

/** Same link despite a trailing slash, "www." or letter case in the host. */
function linkKey(url: string): string {
  if (url.startsWith('mailto:')) return url.toLowerCase();
  const u = new URL(url);
  return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
}

const PORTFOLIO_HOSTS = ['github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'wixsite.com'];

export function classifyLink(url: string): { kind: CvLinkKind; label: string } {
  if (url.startsWith('mailto:')) return { kind: 'EMAIL', label: url.slice('mailto:'.length) };
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const segments = u.pathname.split('/').filter(Boolean);
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return { kind: 'LINKEDIN', label: 'LinkedIn' };
  if (host === 'github.com') return segments.length <= 1 ? { kind: 'GITHUB', label: 'GitHub' } : { kind: 'PROJECT', label: 'GitHub' };
  if (host === 'gitlab.com') return segments.length <= 1 ? { kind: 'GITLAB', label: 'GitLab' } : { kind: 'PROJECT', label: 'GitLab' };
  if (PORTFOLIO_HOSTS.some(h => host === h || host.endsWith(`.${h}`)) && segments.length === 0) {
    return { kind: 'PORTFOLIO', label: 'Portfolio' };
  }
  return segments.length === 0 ? { kind: 'WEBSITE', label: host } : { kind: 'PROJECT', label: host };
}

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, MAX_ANCHOR_LENGTH);

/** Cleans, de-duplicates (first appearance wins, keeping the first non-empty anchor) and classifies links. */
export function collectLinks(raw: RawLink[]): CvLink[] {
  const byKey = new Map<string, CvLink>();
  for (const { url: rawUrl, anchor } of raw) {
    const url = normalizeLinkUrl(rawUrl);
    if (!url) continue;
    const key = linkKey(url);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.anchor && anchor.trim()) existing.anchor = tidy(anchor);
      continue;
    }
    if (byKey.size >= MAX_LINKS) continue;
    byKey.set(key, { url, ...classifyLink(url), anchor: tidy(anchor) });
  }
  return [...byKey.values()];
}

/** Links for the CV header: profiles and websites, in the CV's order (not emails or project links). */
export function headerLinks(links: CvLink[]): CvLink[] {
  return links.filter(l => l.kind !== 'EMAIL' && l.kind !== 'PROJECT');
}

const comparable = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The link that sat on this entry's title in the PDF ("Miklat Finder" → its repository), if any.
 * Matches when one text starts with the other, ignoring case, spaces and punctuation.
 */
export function linkForTitle(title: string | undefined, links: CvLink[]): CvLink | undefined {
  const wanted = comparable(title ?? '');
  if (wanted.length < 3) return undefined;
  return links.find(link => {
    if (link.kind === 'EMAIL' || headerLinks([link]).length > 0) return false;
    const anchor = comparable(link.anchor);
    return anchor.length >= 3 && (anchor.startsWith(wanted) || wanted.startsWith(anchor));
  });
}

/** Stored JSON → links, dropping anything malformed. */
export function parseStoredLinks(value: unknown): CvLink[] {
  if (!Array.isArray(value)) return [];
  return collectLinks(
    value.flatMap(v =>
      v && typeof v === 'object' && typeof (v as RawLink).url === 'string'
        ? [{ url: (v as RawLink).url, anchor: typeof (v as RawLink).anchor === 'string' ? (v as RawLink).anchor : '' }]
        : [],
    ),
  );
}
