/**
 * Removes contact details before any text reaches an LLM. Contact fields are filled
 * deterministically from the returned matches, never by a model.
 */
export interface RedactionResult {
  text: string;
  emails: string[];
  phones: string[];
  urls: string[];
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+|\b(?:linkedin\.com|github\.com|gitlab\.com|t\.me)\/[^\s<>()[\]{}"']+/gi;
// Digit runs with phone-like separators; filtered to 9–15 digits so dates and year ranges survive.
const PHONE_CANDIDATE = /(?<![\p{L}\p{N}])\+?\(?\d[\d\s().-]{6,}\d(?![\p{L}\p{N}])/gu;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, '');
}

export function redactPii(input: string, opts: { names?: string[] } = {}): RedactionResult {
  const emails: string[] = [];
  const phones: string[] = [];
  const urls: string[] = [];

  let text = input.replace(EMAIL, m => {
    emails.push(m);
    return '[EMAIL]';
  });

  text = text.replace(URL, m => {
    const url = trimUrl(m);
    urls.push(url);
    return `[URL]${m.slice(url.length)}`;
  });

  text = text.replace(PHONE_CANDIDATE, m => {
    const digits = m.replace(/\D/g, '').length;
    if (digits < 9 || digits > 15) return m;
    phones.push(m.trim());
    return '[PHONE]';
  });

  // Full names first, then individual parts of 3+ letters ("Dana", "Levi").
  const nameParts = (opts.names ?? [])
    .flatMap(n => [n.trim(), ...n.trim().split(/\s+/)])
    .filter(p => p.length >= 3);
  const uniqueParts = [...new Set(nameParts)].sort((a, b) => b.length - a.length);
  for (const part of uniqueParts) {
    const re = new RegExp(`(?<![\\p{L}])${escapeRegExp(part)}(?![\\p{L}])`, 'giu');
    text = text.replace(re, '[CANDIDATE]');
  }

  return { text, emails, phones, urls };
}
