import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Recovery codes: 16 symbols from Crockford's base32 alphabet (5 bits each = 80 bits of entropy),
 * shown as XXXX-XXXX-XXXX-XXXX. Pure functions; the service stores only the HMAC.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 16;

/** A fresh code from the CSPRNG, without dashes. */
export function generateRecoveryCode(): string {
  let code = '';
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** XXXX-XXXX-XXXX-XXXX, for display. */
export function formatRecoveryCode(code: string): string {
  return code.match(/.{1,4}/g)!.join('-');
}

/**
 * What the user typed, as the canonical code, or null if it can't be one.
 * Ignores case, spaces and dashes; reads the look-alikes O as 0 and I/L as 1.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (code.length !== LENGTH) return null;
  return [...code].every(ch => ALPHABET.includes(ch)) ? code : null;
}

/** HMAC-SHA256 with a server-side key: a stolen database alone can't be used to test guesses. */
export function hashRecoveryCode(code: string, key: string): string {
  return createHmac('sha256', key).update(code).digest('hex');
}

/** Constant-time comparison of two hex hashes. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
