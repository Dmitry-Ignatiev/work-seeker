import { ExternalLinkIcon, MapPinIcon, WandSparklesIcon } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { JobSummary } from '@/server/services/jobs';

function postedLabel(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days) || days < 0) return null;
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return days < 60 ? `${days} days ago` : null;
}

/** A job from a search. The title opens the job's own page (with a chat about that job); "Tailor my CV" opens it and starts tailoring. */
export function JobCard({ job }: { job: JobSummary }) {
  const posted = postedLabel(job.postedAt);
  return (
    <article
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4 text-card-foreground transition-colors hover:border-input"
      aria-label={job.title}
    >
      <div className="flex flex-col gap-1">
        <h3 dir="auto" className="leading-snug font-semibold">
          <Link href={`/jobs/${job.id}`} className="hover:text-primary hover:underline underline-offset-4">
            {job.title}
          </Link>
        </h3>
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <span dir="auto" className="font-medium text-foreground">
            {job.company}
          </span>
          <span aria-hidden>·</span>
          <MapPinIcon className="size-3.5" aria-hidden />
          <span dir="auto">{job.location}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{job.source}</Badge>
        {job.remote && <Badge className="bg-accent text-accent-foreground">Remote</Badge>}
        {posted && <span className="text-xs text-muted-foreground">{posted}</span>}
      </div>
      {job.snippet && (
        <p dir="auto" className="line-clamp-2 text-sm text-muted-foreground">
          {job.snippet}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Link href={`/jobs/${job.id}?tailor=1`} className={cn(buttonVariants(), 'h-10 flex-1 rounded-lg')}>
          <WandSparklesIcon aria-hidden /> Tailor my CV
        </Link>
        {job.source === 'Demo listing' ? (
          // Offline-mode listings are made up: no dead link to click.
          <span className="text-xs text-muted-foreground">Demo listing, no real posting</span>
        ) : (
          job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: 'outline' }), 'h-10 rounded-lg')}
            >
              Open job <ExternalLinkIcon aria-hidden />
            </a>
          )
        )}
      </div>
    </article>
  );
}
