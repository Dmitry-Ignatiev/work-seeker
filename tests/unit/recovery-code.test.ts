import { describe, expect, it } from 'vitest';
import {
  formatRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
  sameHash,
} from '@/server/recovery/code';

describe('recovery codes', () => {
  it('are 16 symbols of Crockford base32 (80 bits), with no look-alike letters', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(code).not.toMatch(/[ILOU]/);
  });

  it('do not repeat', () => {
    const codes = new Set(Array.from({ length: 1000 }, generateRecoveryCode));
    expect(codes.size).toBe(1000);
  });

  it('display in four groups', () => {
    expect(formatRecoveryCode('ABCD0123EFGH4567')).toBe('ABCD-0123-EFGH-4567');
  });

  it('accept what people type: any case, spaces, dashes, and O/I/L for 0/1', () => {
    expect(normalizeRecoveryCode('abcd-0123 efgh-4567')).toBe('ABCD0123EFGH4567');
    expect(normalizeRecoveryCode('ABCD-O123-EFGH-4567')).toBe('ABCD0123EFGH4567');
    expect(normalizeRecoveryCode('ABCD-0I23-EFGH-4567')).toBe('ABCD0123EFGH4567');
    expect(normalizeRecoveryCode('ABCD-0l23-EFGH-4567')).toBe('ABCD0123EFGH4567');
  });

  it('reject anything that cannot be a code', () => {
    expect(normalizeRecoveryCode('')).toBeNull();
    expect(normalizeRecoveryCode('ABCD-0123-EFGH')).toBeNull();
    expect(normalizeRecoveryCode('ABCD-0123-EFGH-4567-8')).toBeNull();
    expect(normalizeRecoveryCode('ABCD-0123-EFGH-456U')).toBeNull();
    expect(normalizeRecoveryCode('ABCD-0123-EFGH-456!')).toBeNull();
  });

  it('are stored as a keyed hash: same code and key match, another key or code does not', () => {
    const code = generateRecoveryCode();
    const stored = hashRecoveryCode(code, 'key-1');
    expect(stored).not.toContain(code);
    expect(sameHash(hashRecoveryCode(code, 'key-1'), stored)).toBe(true);
    expect(sameHash(hashRecoveryCode(code, 'key-2'), stored)).toBe(false);
    expect(sameHash(hashRecoveryCode(generateRecoveryCode(), 'key-1'), stored)).toBe(false);
    expect(sameHash('abcd', stored)).toBe(false);
  });
});
