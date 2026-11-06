import { describe, expect, it } from 'vitest';
import { isBlockedIp } from '@/server/discovery/net/ip';
import { isAllowedByRobots, parseRobots } from '@/server/discovery/net/robots';
import { assertPublicUrl, FetchBlockedError, safeFetch, type SafeFetchDeps } from '@/server/discovery/net/safe-fetch';

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    'not-an-ip',
  ])('blocks %s', ip => expect(isBlockedIp(ip)).toBe(true));

  it.each(['8.8.8.8', '104.18.1.1', '172.32.0.1', '2606:4700::6810:85e5', '::ffff:8.8.8.8'])('allows public %s', ip =>
    expect(isBlockedIp(ip)).toBe(false),
  );
});

function deps(routes: Record<string, () => Response>, dns: Record<string, string[]> = {}): SafeFetchDeps {
  return {
    lookup: async host => dns[host] ?? ['93.184.216.34'],
    fetch: (async (input: URL | string) => {
      const route = routes[input.toString()];
      if (!route) throw new Error(`unexpected fetch ${input}`);
      return route();
    }) as typeof fetch,
  };
}

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

describe('safeFetch', () => {
  it('fetches a public HTML page', async () => {
    const result = await safeFetch('https://jobs.example.com/a', {}, deps({ 'https://jobs.example.com/a': () => html('<p>ok</p>') }));
    expect(result).toMatchObject({ status: 200, text: '<p>ok</p>', url: 'https://jobs.example.com/a' });
  });

  it('rejects hosts that resolve to internal addresses', async () => {
    const d = deps({}, { 'internal.example.com': ['10.0.0.5'], 'mixed.example.com': ['8.8.8.8', '127.0.0.1'] });
    await expect(safeFetch('https://internal.example.com/', {}, d)).rejects.toThrow(FetchBlockedError);
    await expect(safeFetch('https://mixed.example.com/', {}, d)).rejects.toThrow('not allowed');
    await expect(safeFetch('http://169.254.169.254/latest/meta-data', {}, d)).rejects.toThrow('not allowed');
    await expect(safeFetch('http://localhost/', {}, d)).rejects.toThrow('not allowed');
  });

  it('re-checks every redirect target', async () => {
    const d = deps(
      { 'https://jobs.example.com/a': () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }) },
      {},
    );
    await expect(safeFetch('https://jobs.example.com/a', {}, d)).rejects.toThrow('not allowed');
  });

  it('limits redirects', async () => {
    const loop = () => new Response(null, { status: 301, headers: { location: 'https://jobs.example.com/a' } });
    await expect(safeFetch('https://jobs.example.com/a', { maxRedirects: 2 }, deps({ 'https://jobs.example.com/a': loop }))).rejects.toThrow(
      'Too many redirects',
    );
  });

  it('rejects odd schemes, ports and credentials', async () => {
    await expect(assertPublicUrl('ftp://example.com/x')).rejects.toThrow('Only web links');
    await expect(assertPublicUrl('https://example.com:8443/x')).rejects.toThrow('custom ports');
    await expect(assertPublicUrl('https://user:pw@example.com/x')).rejects.toThrow('credentials');
  });

  it('enforces the content type and size limit', async () => {
    const pdf = () => new Response('x', { headers: { 'content-type': 'application/pdf' } });
    await expect(safeFetch('https://a.example.com/', {}, deps({ 'https://a.example.com/': pdf }))).rejects.toThrow('not a web page');
    const big = () => html('x'.repeat(5000));
    await expect(safeFetch('https://a.example.com/', { maxBytes: 1000 }, deps({ 'https://a.example.com/': big }))).rejects.toThrow('too large');
  });
});

describe('robots.txt', () => {
  const rules = parseRobots(`
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /jobssalary
Disallow: /api/
Allow: /api/public/
Disallow: /*?*area=
Disallow: /exact$
`);

  it('uses the * group when no group names us', () => {
    expect(isAllowedByRobots(rules, '/jobslobby/software/')).toBe(true);
    expect(isAllowedByRobots(rules, '/jobssalary/table')).toBe(false);
  });

  it('applies the longest match, with Allow winning ties', () => {
    expect(isAllowedByRobots(rules, '/api/jobs')).toBe(false);
    expect(isAllowedByRobots(rules, '/api/public/list')).toBe(true);
  });

  it('supports * wildcards and $ anchors', () => {
    expect(isAllowedByRobots(rules, '/jobs/search?q=x&area=5')).toBe(false);
    expect(isAllowedByRobots(rules, '/exact')).toBe(false);
    expect(isAllowedByRobots(rules, '/exactly')).toBe(true);
  });

  it('prefers a group addressed to our bot, and treats "Disallow: /" as everything', () => {
    const own = parseRobots('User-agent: *\nAllow: /\n\nUser-agent: WorkSeekerBot\nDisallow: /');
    expect(isAllowedByRobots(own, '/anything')).toBe(false);
    expect(isAllowedByRobots(parseRobots(''), '/anything')).toBe(true);
  });
});
