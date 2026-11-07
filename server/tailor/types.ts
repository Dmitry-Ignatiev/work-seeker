import { z } from 'zod';

/** Shapes shared by the AI calls, the guard, the service and the UI. */

/** Strict kinds must already be in the CV (or confirmed). Descriptive kinds need CV evidence. */
export const KEYWORD_KINDS = ['TECH', 'TOOL', 'LANGUAGE', 'CERTIFICATION', 'DEGREE', 'RESPONSIBILITY', 'DOMAIN', 'SOFT'] as const;
export type KeywordKind = (typeof KEYWORD_KINDS)[number];
export const STRICT_KINDS = new Set<KeywordKind>(['TECH', 'TOOL', 'LANGUAGE', 'CERTIFICATION', 'DEGREE']);

export interface JobKeyword {
  keyword: string;
  strict: boolean;
  importance: 'MUST' | 'NICE';
  /** Where the posting says it (verbatim). */
  quote: string;
}

export interface CvBullet {
  id: string;
  text: string;
}

export interface CvEntry {
  title?: string;
  organization?: string;
  dates?: string;
  bullets: CvBullet[];
}

export interface CvSection {
  kind: 'EXPERIENCE' | 'EDUCATION' | 'PROJECTS' | 'OTHER';
  heading: string;
  entries: CvEntry[];
}

/** A CV split into parts. Every string is a verbatim piece of the CV text (checked in code). */
export interface CvStructure {
  headline?: string;
  /** The profile paragraph; tailoring may rewrite it (id "summary"). */
  summary?: string;
  sections: CvSection[];
  skills: string[];
  rtl: boolean;
}

/** One accepted edit, shown as before → after. */
export interface TailorChange {
  bulletId: string;
  before: string;
  after: string;
  /** Job keywords this edit added. */
  keywords: string[];
  /** A descriptive keyword with different wording than the CV: ask the user to check it. */
  reworded: boolean;
}

export interface TailorRejection {
  bulletId: string;
  before: string;
  proposed: string;
  reason: string;
}

// ───────────────────────── AI output schemas ─────────────────────────

export const extractedKeywordsSchema = z.object({
  keywords: z
    .array(
      z.object({
        keyword: z.string().min(1).max(60),
        kind: z.enum(KEYWORD_KINDS),
        importance: z.enum(['MUST', 'NICE']),
        quote: z.string().min(2).max(300),
      }),
    )
    .max(30),
});

const entrySchema = z.object({
  title: z.string().max(200).optional(),
  organization: z.string().max(200).optional(),
  dates: z.string().max(80).optional(),
  bullets: z.array(z.string().max(1_000)).max(40),
});

export const cvStructureSchema = z.object({
  headline: z.string().max(200).optional(),
  summary: z.string().max(2_000).optional(),
  sections: z
    .array(
      z.object({
        kind: z.enum(['EXPERIENCE', 'EDUCATION', 'PROJECTS', 'OTHER']),
        heading: z.string().max(100),
        entries: z.array(entrySchema).max(30),
      }),
    )
    .max(15),
  skills: z.array(z.string().max(80)).max(80),
});

export const tailorOutputSchema = z.object({
  summary: z
    .object({
      text: z.string().min(1).max(1_500),
      evidence: z.array(z.string().max(400)).max(10),
    })
    .nullable(),
  edits: z
    .array(
      z.object({
        bulletId: z.string().max(40),
        text: z.string().min(1).max(1_200),
        evidence: z.array(z.string().max(400)).max(10),
      }),
    )
    .max(12),
});

export type TailorOutput = z.infer<typeof tailorOutputSchema>;
