'use client';

import { CheckCircle2Icon, FileSearchIcon, Loader2Icon, SearchIcon, TriangleAlertIcon } from 'lucide-react';
import { CvUpload } from '@/components/cv/cv-upload';
import { Button } from '@/components/ui/button';
import type { AssistantMessage } from '@/server/ai/assistant/agent';
import { JobCard } from './job-card';
import { TailoredCvCard } from './tailored-cv-card';

type Part = AssistantMessage['parts'][number];

function Working({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" aria-hidden />
      {children}
    </p>
  );
}

function Failed({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-destructive">
      <TriangleAlertIcon className="size-4" aria-hidden />
      {children}
    </p>
  );
}

export interface ToolPartActions {
  /** Sends a message as the user. */
  onAsk: (text: string) => void;
  /** Puts text in the message box for the user to finish. */
  onPrefill: (text: string) => void;
  /** Answers a tool approval request. */
  onApproval: (approvalId: string, approved: boolean) => void;
  busy: boolean;
}

const tailorRequest = (job: { id: string; title: string; company: string }) =>
  `Tailor my CV for "${job.title}" at ${job.company} (jobId ${job.id}).`;

/** Renders one tool call: progress while it runs, then cards or a short status. */
export function ToolPart({ part, onAsk, onPrefill, onApproval, busy }: { part: Part } & ToolPartActions) {
  switch (part.type) {
    case 'tool-searchJobs': {
      if (part.state === 'output-error') return <Failed>The job search failed. Try again.</Failed>;
      if (part.state !== 'output-available') {
        return <Working>Searching job boards{part.input?.query ? ` for “${part.input.query}”` : ''}…</Working>;
      }
      const { jobs, sources } = part.output;
      return (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="search-sources">
            <SearchIcon className="size-3.5" aria-hidden />
            <span>
              {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} for “{part.input.query}”
            </span>
            {sources.map(source => (
              <span key={source.source} className={source.ok ? '' : 'text-destructive'}>
                · {source.source} {source.ok ? `(${source.found})` : `✗ ${source.error}`}
              </span>
            ))}
          </p>
          {jobs.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2" aria-label="Jobs found">
              {jobs.map(job => (
                <JobCard
                  key={job.id}
                  job={job}
                  disabled={busy}
                  onDetails={() => onAsk(`Tell me more about "${job.title}" at ${job.company} (jobId ${job.id}).`)}
                  onTailor={() => onAsk(tailorRequest(job))}
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    case 'tool-addJob': {
      if (part.state === 'output-error') return <Failed>Couldn&apos;t add that job.</Failed>;
      if (part.state !== 'output-available') return <Working>Reading the job…</Working>;
      if (part.output.status !== 'OK') return <Failed>{part.output.reason}</Failed>;
      const added = part.output.job;
      return <JobCard job={added} disabled={busy} onTailor={() => onAsk(tailorRequest(added))} />;
    }

    case 'tool-tailorCv': {
      if (part.state === 'output-error') return <Failed>Tailoring failed. Try again in a moment.</Failed>;
      if (part.state !== 'output-available') {
        return <Working>Reading the job and your CV, then checking every change against your CV (20–40 s)…</Working>;
      }
      const output = part.output;
      if (output.status === 'NEEDS_CV') {
        const jobId = part.input.jobId;
        return (
          <div className="flex flex-col gap-2" data-testid="cv-needed">
            <p className="text-sm">First, your CV: upload it here and I&apos;ll tailor it right after.</p>
            <CvUpload onUploaded={() => onAsk(`I uploaded my CV. Please tailor it now (jobId ${jobId}).`)} />
          </div>
        );
      }
      if (output.status === 'CV_UNREADABLE') return <Failed>{output.reason}</Failed>;
      if (output.status === 'JOB_NOT_FOUND') return <Failed>That job is no longer available.</Failed>;
      return <TailoredCvCard result={output} onHaveSkill={keyword => onPrefill(`I have real experience with ${keyword}: `)} />;
    }

    case 'tool-confirmExperience': {
      if (part.state === 'approval-requested') {
        return (
          <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4" data-testid="confirm-experience">
            <p className="text-sm" dir="auto">
              Add <strong>{part.input.keyword}</strong> to what I know about you: “{part.input.detail}”
            </p>
            <p className="text-xs text-muted-foreground">Only approve if it’s true. It can then be used when tailoring your CV.</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => onApproval(part.approval.id, true)}>
                Yes, it’s true
              </Button>
              <Button size="sm" variant="outline" onClick={() => onApproval(part.approval.id, false)}>
                No
              </Button>
            </div>
          </div>
        );
      }
      if (part.state === 'output-denied') return <p className="text-sm text-muted-foreground">Not added.</p>;
      if (part.state === 'output-error') return <Failed>Couldn&apos;t save that.</Failed>;
      if (part.state !== 'output-available') return <Working>Saving…</Working>;
      return (
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2Icon className="size-4 text-primary" aria-hidden />
          Saved: {part.output.keyword}
        </p>
      );
    }

    case 'tool-getJob': {
      if (part.state === 'output-error') return <Failed>Couldn&apos;t open that job.</Failed>;
      if (part.state !== 'output-available') return <Working>Reading the full posting…</Working>;
      if (!part.output.found) return <Failed>That job is no longer available.</Failed>;
      return (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileSearchIcon className="size-3.5" aria-hidden />
          <span dir="auto">
            Read the full posting: {part.output.title} · {part.output.company}
          </span>
        </p>
      );
    }

    case 'tool-followCompany': {
      if (part.state === 'output-error') return <Failed>Couldn&apos;t follow that company.</Failed>;
      if (part.state !== 'output-available') return <Working>Checking the careers page…</Working>;
      if (part.output.status !== 'OK') return <Failed>{part.output.reason}</Failed>;
      return (
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2Icon className="size-4 text-primary" aria-hidden />
          {part.output.alreadyFollowed ? 'Already following' : 'Now following'} {part.output.companyName}: {part.output.openRoles} open
          roles in Israel or remote.
        </p>
      );
    }

    default:
      return null;
  }
}
