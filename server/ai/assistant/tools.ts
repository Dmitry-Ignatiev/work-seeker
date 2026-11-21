import { JOB_SITES } from '@/server/discovery/publisher';
import 'server-only';
import { tool } from 'ai';
import { z } from 'zod';
import { NotFoundError } from '@/server/errors';
import {
  addJobFromText,
  addJobFromUrl,
  followCompany,
  loadFullJob,
  searchJobs,
  type JobSummary,
  type SearchDeps,
} from '@/server/services/jobs';
import { confirmExperience, tailorCvForJob } from '@/server/services/tailor';

/**
 * The assistant's tools. Each one is a thin wrapper over a service. The user id comes from the
 * session through `toolsContext` (validated by `contextSchema`), never from the model.
 * Job text the model sees is truncated and wrapped in <untrusted_job_content>.
 */
const userContext = z.object({ userId: z.string().min(1) });

const MODEL_SNIPPET = 160;
const MODEL_DESCRIPTION = 6_000;

const untrusted = (text: string) => `<untrusted_job_content>\n${text}\n</untrusted_job_content>`;

function jobLine(job: JobSummary, index: number): string {
  const flags = [job.remote ? 'remote' : null, job.postedAt ? `posted ${job.postedAt.slice(0, 10)}` : null].filter(Boolean);
  return `${index + 1}. [jobId ${job.id}] ${job.title} · ${job.company} · ${job.location}${flags.length ? ` (${flags.join(', ')})` : ''} · via ${job.source}\n   ${untrusted(job.snippet.slice(0, MODEL_SNIPPET))}`;
}

export interface AssistantToolDeps {
  /** Overrides job sources (tests and E2E use fixtures). */
  search?: SearchDeps;
}

export function createAssistantTools(deps: AssistantToolDeps = {}) {
  return {
    searchJobs: tool({
      description:
        'Search high-tech job listings in Israel and remote (Israeli company careers pages, remote job boards). ' +
        'Returns up to 12 jobs with ids. The user sees them as cards.',
      inputSchema: z.object({
        query: z.string().min(2).max(120).describe('Role and key technologies in English, e.g. "senior backend engineer node.js"'),
        location: z.string().max(60).optional().describe('City or "Israel". Omit for anywhere in Israel'),
        remoteOnly: z.boolean().optional(),
        seniority: z.enum(['junior', 'mid', 'senior', 'lead']).optional(),
        site: z
          .enum(JOB_SITES)
          .optional()
          .describe('Only when the user asks for jobs from one job site (LinkedIn, Glassdoor, GotFriends…); omit to search everywhere'),
      }),
      contextSchema: userContext,
      execute: async input => searchJobs(input, deps.search),
      toModelOutput: ({ output }) => ({
        type: 'text',
        value: [
          ...(output.widenedFrom
            ? [`No jobs in "${output.widenedFrom}" right now. These are elsewhere in Israel: say so in one short sentence.`]
            : []),
          output.jobs.length ? output.jobs.map(jobLine).join('\n') : 'No matching jobs.',
          `Sources: ${output.sources.map(s => (s.ok ? `${s.source} ok (${s.found})` : `${s.source} FAILED: ${s.error}`)).join('; ')}`,
        ].join('\n'),
      }),
    }),

    addJob: tool({
      description:
        'Add one job from a link (company careers page or any job page) or from pasted description text. ' +
        'LinkedIn, Indeed and Glassdoor links return NEEDS_PASTE: then ask the user to paste the description.',
      inputSchema: z
        .object({
          url: z.string().url().max(2000).optional(),
          text: z.string().min(1).max(30_000).optional().describe('The pasted job description, verbatim'),
          title: z.string().max(200).optional(),
          company: z.string().max(200).optional(),
        })
        .refine(input => Boolean(input.url) !== Boolean(input.text), 'Give either url or text'),
      contextSchema: userContext,
      execute: async ({ url, text, title, company }, { context }) =>
        url ? addJobFromUrl(context.userId, url) : addJobFromText(context.userId, { text: text!, title, company }),
      toModelOutput: ({ output }) => ({
        type: 'text',
        value: output.status === 'OK' ? `OK\n${jobLine(output.job, 0)}` : `${output.status}: ${output.reason}`,
      }),
    }),

    getJob: tool({
      description: "Read one job's full posting (requirements, responsibilities) by its jobId.",
      inputSchema: z.object({ jobId: z.string().min(1).max(100) }),
      contextSchema: userContext,
      execute: async ({ jobId }, { context }) => {
        try {
          const job = await loadFullJob(context.userId, jobId);
          return {
            found: true as const,
            id: job.id,
            title: job.title,
            company: job.company,
            location: job.location ?? '',
            url: job.canonicalUrl,
            description: job.descriptionText,
          };
        } catch (error) {
          if (error instanceof NotFoundError) return { found: false as const };
          throw error;
        }
      },
      toModelOutput: ({ output }) => ({
        type: 'text',
        value: output.found
          ? `${output.title} · ${output.company} · ${output.location}\n${untrusted(output.description.slice(0, MODEL_DESCRIPTION))}`
          : 'Job not found.',
      }),
    }),

    tailorCv: tool({
      description:
        "Tailor the user's CV to one job (by jobId): the job's keywords go into the summary and bullets only where the CV " +
        'backs them; code verifies every change. Takes 20–40 seconds. The user sees a before/after card with a DOCX download. ' +
        'Returns NEEDS_CV if the user has no CV yet (they then see an upload box).',
      inputSchema: z.object({ jobId: z.string().min(1).max(100) }),
      // The CV comes from the page (the user's pick), never from the model.
      contextSchema: userContext.extend({ cvId: z.string().min(1).max(100).optional() }),
      execute: async ({ jobId }, { context }) => tailorCvForJob(context.userId, jobId, context.cvId),
      toModelOutput: ({ output }) => ({
        type: 'text',
        value:
          output.status === 'OK'
            ? [
                `Tailored CV saved for "${output.job.title}" at ${output.job.company}.`,
                `Job keywords written in the CV: ${output.coverageBefore}/${output.keywordTotal} before, ${output.coverageAfter}/${output.keywordTotal} after.`,
                `Accepted edits: ${output.changes.length}${output.changes.length ? ` (added: ${[...new Set(output.changes.flatMap(c => c.keywords))].join(', ') || 'wording only'})` : ''}.`,
                output.skillsAdded.length ? `Added to skills (the CV already shows them): ${output.skillsAdded.join(', ')}.` : '',
                output.rejected.length ? `Refused by the truth check: ${output.rejected.map(r => r.reason).join('; ')}.` : '',
                output.missing.length
                  ? `Missing from the CV (never added): ${output.missing.join(', ')}. Ask the user if any of these are true for them; if they say yes and describe it, use confirmExperience, then tailor again.`
                  : '',
                'The user sees all of this in a card with a download button: summarise it in 2–3 sentences, no lists of every change.',
              ]
                .filter(Boolean)
                .join('\n')
            : output.status === 'NEEDS_CV'
              ? 'NEEDS_CV: the user has no CV yet. They now see an upload box under your message; ask them to upload their CV (PDF or Word .docx). After the upload, tailoring continues automatically.'
              : output.status === 'CV_UNREADABLE'
                ? `CV_UNREADABLE: ${output.reason}`
                : 'Job not found.',
      }),
    }),

    confirmExperience: tool({
      description:
        'Record experience the user has said they really have but their CV does not mention (e.g. "I used Terraform for 2 years"). ' +
        'Only call it after the user states it in their own words. The user must approve it with a button.',
      inputSchema: z.object({
        keyword: z.string().min(1).max(60).describe('The skill or experience, e.g. "Terraform"'),
        detail: z.string().min(3).max(500).describe("The user's own description of that experience"),
      }),
      contextSchema: userContext,
      execute: async ({ keyword, detail }, { context }) => confirmExperience(context.userId, keyword, detail),
    }),

    followCompany: tool({
      description: "Follow a company's careers page hosted on Greenhouse, Lever or Ashby, so its jobs appear in searches.",
      inputSchema: z.object({
        careersUrl: z.string().url().max(500),
        companyName: z.string().max(100).optional(),
      }),
      contextSchema: userContext,
      execute: async ({ careersUrl, companyName }, { context }) => followCompany(context.userId, careersUrl, companyName),
    }),
  };
}

export type AssistantTools = ReturnType<typeof createAssistantTools>;
