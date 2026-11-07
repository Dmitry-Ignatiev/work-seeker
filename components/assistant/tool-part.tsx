'use client';

import { CheckCircle2Icon, FileSearchIcon, Loader2Icon, SearchIcon, TriangleAlertIcon } from 'lucide-react';
import type { AssistantMessage } from '@/server/ai/assistant/agent';
import { JobCard } from './job-card';

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

/** Renders one tool call: progress while it runs, then cards or a short status. */
export function ToolPart({ part, onAsk, busy }: { part: Part; onAsk: (text: string) => void; busy: boolean }) {
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
      return <JobCard job={part.output.job} />;
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
