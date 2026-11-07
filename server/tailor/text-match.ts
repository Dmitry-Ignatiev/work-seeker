/** Pure text matching for keywords, quotes and numbers (English and Hebrew). */

const norm = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ');

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Normalized key for comparing keywords: "Node.JS " → "node.js". */
export function keywordKey(keyword: string): string {
  return norm(keyword).trim().replace(/[.,;:!?]+$/, '');
}

/** Spellings that count as the same term: "Node.js" ~ "NodeJS", "Full-Stack" ~ "full stack" ~ "fullstack". */
function variants(term: string): string[] {
  const t = keywordKey(term);
  return [...new Set([t, t.replace(/[.\-\s]/g, ''), t.replace(/-/g, ' '), t.replace(/\s+/g, '-')])].filter(v => v.length > 0);
}

// One or two Hebrew prefix letters (ו ה ב כ ל מ ש) glued to the term, optionally with a hyphen: "ב-React", "ובReact".
const HEBREW_PREFIX = '(?:[\\u05d5\\u05d4\\u05d1\\u05db\\u05dc\\u05de\\u05e9]{1,2}-?)?';

/**
 * Is `term` written in `text` as a whole word? Case-insensitive, tolerant of spelling variants and
 * Hebrew prefixes. "java" doesn't match "javascript"; "c" doesn't match "c++".
 */
export function containsTerm(text: string, term: string): boolean {
  const haystack = norm(text);
  return variants(term).some(v =>
    new RegExp(`(?<![\\p{L}\\p{N}])${HEBREW_PREFIX}${escapeRegExp(v)}(?![\\p{L}\\p{N}+#])`, 'u').test(haystack),
  );
}

/**
 * Case-sensitive whole-word match, for terms that are also everyday words ("Go", "R"):
 * "built services in Go" counts, "let's go" doesn't.
 */
export function containsTermExact(text: string, term: string): boolean {
  const t = term.trim();
  return t.length > 0 && new RegExp(`(?<![\\p{L}\\p{N}])${HEBREW_PREFIX}${escapeRegExp(t)}(?![\\p{L}\\p{N}+#])`, 'u').test(text);
}

/** Is `quote` (whitespace and case aside) really part of `text`? Short fragments don't count. */
export function isQuoteIn(text: string, quote: string, minLength = 3): boolean {
  const q = norm(quote).trim();
  return q.length >= minLength && norm(text).includes(q);
}

/** Numbers in a text ("40,000" → "40000", "60%" → "60%", years too). Used to forbid invented metrics. */
export function numbersIn(text: string): Set<string> {
  return new Set([...norm(text).matchAll(/\d+(?:[.,]\d+)*%?/g)].map(m => m[0].replace(/,/g, '')));
}

/** Text direction of a CV: Hebrew if it has more Hebrew letters than Latin ones. */
export function isMostlyHebrew(text: string): boolean {
  const hebrew = (text.match(/[֐-׿]/g) ?? []).length;
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  return hebrew > latin;
}
