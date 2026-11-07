import { containsTerm, containsTermExact, isQuoteIn, keywordKey, numbersIn } from './text-match';
import type { CvStructure, JobKeyword, TailorChange, TailorOutput, TailorRejection } from './types';

/**
 * The truthfulness guard (pure). The model only proposes; this decides. An edit is accepted only if:
 * - it targets an existing bullet (or the summary) and keeps a sane length;
 * - every number in it was already in that bullet (summary: anywhere in the CV): no invented metrics;
 * - it doesn't remove a job keyword the bullet already had;
 * - every job keyword it adds is backed by the CV:
 *     strict kinds (tech, tool, language, certification, degree): written in the CV (or a taxonomy synonym)
 *     or confirmed by the user;
 *     descriptive kinds (responsibility, domain, soft skill): as above, or supported by a verbatim CV quote,
 *     in which case the edit is flagged "reworded, please check";
 * - it mentions no other technology the CV doesn't have.
 * A failing edit is dropped whole: the original bullet stays.
 */

export interface GuardInput {
  /** The CV text the structure was read from (same text the quotes are checked against). */
  cvText: string;
  structure: CvStructure;
  keywords: JobKeyword[];
  /** Keywords the user confirmed having, with their own description. */
  confirmed: string[];
  /** Taxonomy spellings of a term, including the term itself ("k8s" → Kubernetes, kubernetes, k8s). */
  synonyms: (term: string) => string[];
  /** Canonical names of the known technologies mentioned in a text. */
  skillsIn: (text: string) => Set<string>;
  /** Terms that are also everyday words ("Go"): matched case-sensitively. */
  ambiguous?: (term: string) => boolean;
  output: TailorOutput;
}

export interface GuardResult {
  structure: CvStructure;
  changes: TailorChange[];
  rejected: TailorRejection[];
  skillsAdded: string[];
  missing: string[];
  keywordTotal: number;
  coverageBefore: number;
  coverageAfter: number;
}

export const SUMMARY_ID = 'summary';

/** Every piece of text in a structured CV, for coverage counting. */
export function structureText(structure: CvStructure): string {
  return [
    structure.headline,
    structure.summary,
    ...structure.sections.flatMap(section => [
      section.heading,
      ...section.entries.flatMap(entry => [entry.title, entry.organization, ...entry.bullets.map(b => b.text)]),
    ]),
    ...structure.skills,
  ]
    .filter(Boolean)
    .join('\n');
}

export function applyGuard(input: GuardInput): GuardResult {
  const { cvText, structure, keywords, synonyms, skillsIn, output } = input;
  const ambiguous = input.ambiguous ?? (() => false);
  const has = (text: string, term: string) => (ambiguous(term) ? containsTermExact(text, term) : containsTerm(text, term));

  const confirmedKeys = new Set(input.confirmed.flatMap(c => [keywordKey(c), ...synonyms(c).map(keywordKey)]));
  const isConfirmed = (term: string) => [term, ...synonyms(term)].some(t => confirmedKeys.has(keywordKey(t)));
  const inCv = (term: string) => [term, ...synonyms(term)].some(t => has(cvText, t));
  const evidenced = (k: JobKeyword) => inCv(k.keyword) || isConfirmed(k.keyword);
  const literal = (text: string, k: JobKeyword) => has(text, k.keyword);
  const cvSkills = skillsIn(cvText);

  const bullets = new Map<string, string>();
  for (const section of structure.sections) for (const entry of section.entries) for (const b of entry.bullets) bullets.set(b.id, b.text);

  const changes: TailorChange[] = [];
  const rejected: TailorRejection[] = [];

  const check = (bulletId: string, before: string, after: string, evidence: string[]): string | TailorChange => {
    const proposed = after.trim();
    if (proposed.length > Math.max(before.length * 2, before.length + 250)) return 'the rewrite is much longer than the original';

    const pool = bulletId === SUMMARY_ID ? numbersIn(cvText) : numbersIn(before);
    const newNumber = [...numbersIn(proposed)].find(n => !pool.has(n));
    if (newNumber) return `adds the number "${newNumber}", which your CV doesn't state`;

    const dropped = keywords.find(k => literal(before, k) && !literal(proposed, k));
    if (dropped) return `would remove "${dropped.keyword}" from your CV`;

    const added = keywords.filter(k => literal(proposed, k) && !literal(before, k));
    let reworded = false;
    for (const k of added) {
      if (evidenced(k)) continue;
      if (k.strict) return `"${k.keyword}" isn't in your CV`;
      if (evidence.some(quote => isQuoteIn(cvText, quote, 8))) reworded = true;
      else return `nothing in your CV backs "${k.keyword}"`;
    }

    const unknownSkill = [...skillsIn(proposed)].find(skill => !cvSkills.has(skill) && !isConfirmed(skill));
    if (unknownSkill) return `mentions ${unknownSkill}, which isn't in your CV`;

    return { bulletId, before, after: proposed, keywords: added.map(k => k.keyword), reworded };
  };

  const decide = (bulletId: string, before: string, after: string, evidence: string[]) => {
    if (after.trim() === before.trim()) return;
    const result = check(bulletId, before, after, evidence);
    if (typeof result === 'string') rejected.push({ bulletId, before, proposed: after.trim(), reason: result });
    else changes.push(result);
  };

  if (output.summary) decide(SUMMARY_ID, structure.summary ?? '', output.summary.text, output.summary.evidence);
  const seen = new Set<string>();
  for (const edit of output.edits) {
    const before = bullets.get(edit.bulletId);
    if (before === undefined || seen.has(edit.bulletId)) continue; // unknown or duplicate bullet ids are ignored
    seen.add(edit.bulletId);
    decide(edit.bulletId, before, edit.text, edit.evidence);
  }

  // Build the tailored structure from the accepted changes only.
  const accepted = new Map(changes.map(c => [c.bulletId, c.after]));
  const tailored: CvStructure = {
    ...structure,
    summary: accepted.get(SUMMARY_ID) ?? structure.summary,
    sections: structure.sections.map(section => ({
      ...section,
      entries: section.entries.map(entry => ({
        ...entry,
        bullets: entry.bullets.map(b => ({ ...b, text: accepted.get(b.id) ?? b.text })),
      })),
    })),
    skills: [...structure.skills],
  };

  // Strict keywords the CV backs (e.g. "k8s" for "Kubernetes", or confirmed) but never names exactly:
  // add the job's exact term to the skills list, so applicant-tracking systems find it.
  const skillsAdded: string[] = [];
  for (const k of keywords) {
    if (!k.strict || !evidenced(k)) continue;
    if (literal(structureText(tailored), k) || literal(cvText, k)) continue;
    tailored.skills.push(k.keyword);
    skillsAdded.push(k.keyword);
  }

  const tailoredText = `${cvText}\n${structureText(tailored)}`;
  return {
    structure: tailored,
    changes,
    rejected,
    skillsAdded,
    missing: keywords
      .filter(k => !evidenced(k) && !changes.some(c => c.keywords.includes(k.keyword)))
      .sort((a, b) => (a.importance === b.importance ? 0 : a.importance === 'MUST' ? -1 : 1))
      .map(k => k.keyword),
    keywordTotal: keywords.length,
    coverageBefore: keywords.filter(k => literal(cvText, k)).length,
    coverageAfter: keywords.filter(k => literal(tailoredText, k)).length,
  };
}
