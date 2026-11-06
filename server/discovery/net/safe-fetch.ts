import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isBlockedIp } from './ip';

/** Honest identification for every request we make to third-party sites. */
export const BOT_USER_AGENT = 'WorkSeekerBot/0.1 (personal job-search assistant; respects robots.txt)';

/** A fetch we refused or that failed. The message is safe to show to the user. */
export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchBlockedError';
  }
}

export interface SafeFetchOptions {
  /** Accepted content types (prefix match). Default: HTML. */
  accept?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  text: string;
}

/** Injectable for tests. */
export interface SafeFetchDeps {
  lookup: (host: string) => Promise<string[]>;
  fetch: typeof fetch;
}

const defaultDeps: SafeFetchDeps = {
  lookup: async host => (await dnsLookup(host, { all: true, verbatim: true })).map(a => a.address),
  fetch: (...args) => fetch(...args),
};

/** Rejects URLs that could reach internal infrastructure. Resolves DNS and checks every address. */
export async function assertPublicUrl(raw: string | URL, deps: Pick<SafeFetchDeps, 'lookup'> = defaultDeps): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchBlockedError('That is not a valid link.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchBlockedError('Only web links are supported.');
  if (url.username || url.password) throw new FetchBlockedError('Links with credentials are not supported.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new FetchBlockedError('Links with custom ports are not supported.');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new FetchBlockedError('That address is not allowed.');
  }
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await deps.lookup(host);
    } catch {
      throw new FetchBlockedError(`Couldn't find ${host}.`);
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedIp)) throw new FetchBlockedError('That address is not allowed.');
  return url;
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new FetchBlockedError('The page is too large.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchBlockedError('The page is too large.');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

/**
 * GET with an SSRF guard: public addresses only (checked again after every redirect),
 * a redirect limit, a timeout, a body size cap and a content-type allowlist.
 *
 * Known limit: DNS is resolved separately from the connection, so a host that changes its
 * answer between the two (DNS rebinding) is not fully covered. Acceptable for fetching job pages.
 */
export async function safeFetch(
  raw: string,
  { accept = ['text/html', 'application/xhtml+xml'], maxBytes = 2 * 1024 * 1024, timeoutMs = 10_000, maxRedirects = 3 }: SafeFetchOptions = {},
  deps: SafeFetchDeps = defaultDeps,
): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = await assertPublicUrl(raw, deps);

  for (let hop = 0; ; hop++) {
    let response: Response;
    try {
      response = await deps.fetch(url, {
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': BOT_USER_AGENT, Accept: accept.join(', ') },
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new FetchBlockedError(`${url.hostname} took too long to answer.`);
      }
      throw new FetchBlockedError(`Couldn't reach ${url.hostname}.`);
    }

    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      if (hop >= maxRedirects) throw new FetchBlockedError('Too many redirects.');
      url = await assertPublicUrl(new URL(response.headers.get('location')!, url), deps);
      continue;
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (response.ok && !accept.some(type => contentType.startsWith(type))) {
      throw new FetchBlockedError('That link is not a web page.');
    }
    const text = response.ok ? await readLimited(response, maxBytes) : '';
    return { url: url.toString(), status: response.status, contentType, text };
  }
}
