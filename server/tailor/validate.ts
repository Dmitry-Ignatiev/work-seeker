import type { z } from 'zod';
import { containsTerm, isMostlyHebrew, isQuoteIn, keywordKey } from './text-match';
import { STRICT_KINDS, type cvStructureSchema, type CvStructure, type extractedKeywordsSchema, type JobKeyword } from './types';

/**
 * Pure checks on what the models return. Nothing invented survives: a keyword needs a verbatim quote
 * from the posting that mentions it; every piece of a CV structure must be verbatim CV text.
 */

export function validateKeywords(
  description: string,
  extracted: z.infer<typeof extractedKeywordsSchema>,
  synonyms: (term: string) => string[] = term => [term],
): JobKeyword[] {
  const seen = new Set<string>();
  const out: JobKeyword[] = [];
  for (const k of extracted.keywords) {
    const keyword = k.keyword.trim();
    const key = keywordKey(keyword);
    if (!keyword || seen.has(key)) continue;
    if (!isQuoteIn(description, k.quote)) continue; // the quote must really be in the posting
    if (![keyword, ...synonyms(keyword)].some(term => containsTerm(k.quote, term))) continue; // and name the keyword
    seen.add(key);
    out.push({ keyword, strict: STRICT_KINDS.has(k.kind), importance: k.importance, quote: k.quote.trim() });
  }
  return out;
}

const clean = (s: string | undefined) => s?.replace(/\s+/g, ' ').trim() || undefined;

/** Keeps only verbatim CV text and gives every bullet a stable id ("b<section>.<entry>.<bullet>"). */
export function buildStructure(cvText: string, parsed: z.infer<typeof cvStructureSchema>): CvStructure {
  const verbatim = (s: string | undefined) => {
    const value = clean(s);
    return value && isQuoteIn(cvText, value, 2) ? value : undefined;
  };
  const sections = parsed.sections
    .map((section, si) => ({
      kind: section.kind,
      heading: verbatim(section.heading) ?? section.kind.charAt(0) + section.kind.slice(1).toLowerCase(),
      entries: section.entries
        .map((entry, ei) => ({
          title: verbatim(entry.title),
          organization: verbatim(entry.organization),
          dates: verbatim(entry.dates),
          bullets: entry.bullets
            .map((text, bi) => ({ id: `b${si}.${ei}.${bi}`, text: verbatim(text) }))
            .filter((b): b is { id: string; text: string } => Boolean(b.text)),
        }))
        .filter(entry => entry.title || entry.organization || entry.bullets.length > 0),
    }))
    .filter(section => section.entries.length > 0);

  return {
    headline: verbatim(parsed.headline),
    summary: verbatim(parsed.summary),
    sections,
    skills: [...new Set(parsed.skills.map(verbatim).filter((s): s is string => Boolean(s)))],
    rtl: isMostlyHebrew(cvText),
  };
}

export function bulletCount(structure: CvStructure): number {
  return structure.sections.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.bullets.length, 0), 0);
}
