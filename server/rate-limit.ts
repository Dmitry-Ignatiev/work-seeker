import 'server-only';

/**
 * A small in-memory sliding-window limiter. Per server instance only, so it slows down guessing
 * rather than stopping it; the per-account lock on recovery codes (in the database) is the hard limit.
 */
const hits = new Map<string, number[]>();

/** Records a hit for `key` and returns false when it is over `limit` within `windowMs`. */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) {
    for (const [k, times] of hits) if (times.every(t => now - t >= windowMs)) hits.delete(k);
  }
  return recent.length <= limit;
}

/** The caller's IP as Vercel reports it (first x-forwarded-for entry), or "unknown". */
export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
}
