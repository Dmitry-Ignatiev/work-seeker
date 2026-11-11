import 'server-only';
import { adzuna } from './sources/adzuna';
import { arbeitnow } from './sources/arbeitnow';
import { jsearch } from './sources/jsearch';
import { remoteok } from './sources/remoteok';
import { remotive } from './sources/remotive';
import type { SourceAdapter } from './types';

/**
 * Job sources besides the company boards (those live in the database, see server/services/jobs.ts).
 * Each decides via `enabled()` whether it runs: keyed APIs need their env vars, and Remotive needs
 * ENABLE_REMOTIVE=true.
 */
export const ALL_SOURCES: readonly SourceAdapter[] = [jsearch, remoteok, arbeitnow, adzuna, remotive];

export function enabledSources(): SourceAdapter[] {
  return ALL_SOURCES.filter(s => s.enabled());
}
