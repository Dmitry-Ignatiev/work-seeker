import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/safe-next';

describe('safeNext', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/my-cvs')).toBe('/my-cvs');
    expect(safeNext('/jobs/abc?tailor=1')).toBe('/jobs/abc?tailor=1');
  });

  it('refuses anything that could leave the site', () => {
    for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example', 'evil', '', null, undefined]) {
      expect(safeNext(next)).toBeNull();
    }
  });
});
