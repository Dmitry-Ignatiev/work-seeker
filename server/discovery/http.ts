const USER_AGENT = 'work-seeker-agent/0.1 (personal job search)';

export async function getJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return (await res.json()) as T;
}

type Entry = { at: number; value: unknown };
const cache = new Map<string, Entry>();

/** Tiny in-memory TTL cache, per server instance. */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}
