import 'server-only';
import { isAllowedByRobots, parseRobots, type RobotsRules } from './robots';
import { FetchBlockedError, safeFetch, type SafeFetchOptions, type SafeFetchResult } from './safe-fetch';

const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
/** Minimum gap between two requests to the same host. */
export const HOST_SPACING_MS = 2_000;

const robotsCache = new Map<string, { at: number; rules: RobotsRules }>();
/** host → the time its next request may start (requests to one host are queued). */
const nextSlot = new Map<string, number>();

async function rulesFor(origin: string): Promise<RobotsRules> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < ROBOTS_TTL_MS) return hit.rules;
  let rules: RobotsRules = { allow: [], disallow: [] };
  try {
    const res = await safeFetch(`${origin}/robots.txt`, { accept: ['text/plain', 'text/html', ''], maxBytes: 512 * 1024 });
    // 4xx = no robots.txt = everything allowed. 5xx = be conservative and stay away.
    if (res.status >= 500) rules = { allow: [], disallow: ['/'] };
    else if (res.status < 400) rules = parseRobots(res.text);
  } catch {
    rules = { allow: [], disallow: ['/'] };
  }
  robotsCache.set(origin, { at: Date.now(), rules });
  return rules;
}

async function waitForSlot(host: string): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, start + HOST_SPACING_MS);
  if (start > now) await new Promise(resolve => setTimeout(resolve, start - now));
}

/**
 * Fetch for scraping: robots.txt is honoured for the exact path, and requests to one host
 * are spaced HOST_SPACING_MS apart. Built on safeFetch (SSRF guard, limits, honest UA).
 * Never logs in, never solves CAPTCHAs: a blocked page is simply a failed source.
 */
export async function politeFetch(raw: string, options?: SafeFetchOptions): Promise<SafeFetchResult> {
  const url = new URL(raw);
  const rules = await rulesFor(url.origin);
  if (!isAllowedByRobots(rules, `${url.pathname}${url.search}`)) {
    throw new FetchBlockedError(`${url.hostname} doesn't allow automated access to that page.`);
  }
  await waitForSlot(url.host);
  const result = await safeFetch(raw, options);
  if (result.status === 403 || result.status === 429) {
    throw new FetchBlockedError(`${url.hostname} refused the request (${result.status}).`);
  }
  if (result.status >= 400) throw new FetchBlockedError(`${url.hostname} responded ${result.status}.`);
  return result;
}
