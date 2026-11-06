import 'server-only';
import { adzuna } from './sources/adzuna';
import { arbeitnow } from './sources/arbeitnow';
import { jsearch } from './sources/jsearch';
import { remoteok } from './sources/remoteok';
import { remotive } from './sources/remotive';
import type { SourceAdapter } from './types';

/**
 * Job-board adapters. Each one decides via `enabled()` whether it runs:
 * keyed APIs need their env vars, Remotive needs ENABLE_REMOTIVE=true.
 * Persisted search across these sources arrives in Phase 7.
 */
export const ALL_SOURCES: readonly SourceAdapter[] = [arbeitnow, remoteok, adzuna, jsearch, remotive];

export function enabledSources(): SourceAdapter[] {
  return ALL_SOURCES.filter(s => s.enabled());
}
