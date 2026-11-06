import 'server-only';
import { gotfriends } from './scrape/gotfriends';
import { adzuna } from './sources/adzuna';
import { arbeitnow } from './sources/arbeitnow';
import { jsearch } from './sources/jsearch';
import { remoteok } from './sources/remoteok';
import { remotive } from './sources/remotive';
import type { SourceAdapter } from './types';

/**
 * Job sources besides the company boards (those live in the database, see server/services/jobs.ts).
 * Each decides via `enabled()` whether it runs: keyed APIs need their env vars, Remotive needs
 * ENABLE_REMOTIVE=true, and the GotFriends scraper can be switched off with SCRAPE_GOTFRIENDS=false.
 */
export const ALL_SOURCES: readonly SourceAdapter[] = [gotfriends, jsearch, remoteok, arbeitnow, adzuna, remotive];

export function enabledSources(): SourceAdapter[] {
  return ALL_SOURCES.filter(s => s.enabled());
}
