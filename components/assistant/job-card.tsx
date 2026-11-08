import { ExternalLinkIcon, MapPinIcon, WandSparklesIcon } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import type { JobSummary } from '@/server/services/jobs';

function postedLabel(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days) || days < 0) return null;
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return days < 60 ? `${days} days ago` : null;
}

/** A job from a search. "Tailor my CV" and "Details" open the job's own page, with a chat about that job. */
export function JobCard({ job }: { job: JobSummary }) {
  const posted = postedLabel(job.postedAt);
  return (
    <article className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground" aria-label={job.title}>
      <div className="flex flex-col gap-1">
        <h3 dir="auto" className="font-medium leading-snug">
          {job.title}
        </h3>
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <span dir="auto">{job.company}</span>
          <span aria-hidden>·</span>
          <MapPinIcon className="size-3.5" aria-hidden />
          <span dir="auto">{job.location}</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">{job.source}</Badge>
        {job.remote && <Badge variant="outline">Remote</Badge>}
        {posted && <Badge variant="ghost">{posted}</Badge>}
      </div>
      {job.snippet && (
        <p dir="auto" className="line-clamp-2 text-sm text-muted-foreground">
          {job.snippet}
        </p>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Link href={`/jobs/${job.id}?tailor=1`} className={buttonVariants({ size: 'sm' })}>
          <WandSparklesIcon aria-hidden /> Tailor my CV
        </Link>
        {job.source === 'Demo listing' ? (
          // Offline-mode listings are made up: no dead link to click.
          <span className="self-center text-xs text-muted-foreground">Demo listing, no real posting</span>
        ) : (
          job.url && (
            <a href={job.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Open job <ExternalLinkIcon aria-hidden />
            </a>
          )
        )}
        <Link href={`/jobs/${job.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Details
        </Link>
      </div>
    </article>
  );
}
