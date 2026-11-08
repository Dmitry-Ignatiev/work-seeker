import { ExternalLinkIcon, MapPinIcon } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { JobWorkspace, RequirementChips } from '@/components/jobs/job-workspace';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { NotFoundError } from '@/server/errors';
import { listCvs } from '@/server/services/cv';
import { getJobSummary, loadFullJob } from '@/server/services/jobs';
import { jobRequirementsForCvs } from '@/server/services/tailor';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Job' };

const PREVIEW_CHARS = 600;

/** A job's own page: details and requirements on the left, a chat about this job on the right. */
export default function JobPage({ params, searchParams }: PageProps<'/jobs/[id]'>) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <JobPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function JobPageContent({ params, searchParams }: Pick<PageProps<'/jobs/[id]'>, 'params' | 'searchParams'>) {
  const user = await requireUser();
  const { id } = await params;
  const autoTailor = (await searchParams).tailor === '1';

  let summary: Awaited<ReturnType<typeof getJobSummary>>;
  let description: string;
  try {
    summary = await getJobSummary(user.id, id);
    description = (await loadFullJob(user.id, id)).descriptionText;
  } catch (error) {
    if (error instanceof NotFoundError) notFound(); // another user's private job looks exactly like a missing one
    throw error;
  }
  const cvs = (await listCvs(user.id)).map(({ id: cvId, label, isDefault }) => ({ id: cvId, label, isDefault }));
  const preview = description.slice(0, PREVIEW_CHARS);
  const rest = description.slice(PREVIEW_CHARS);

  return (
    <JobWorkspace
      job={{ id: summary.id, title: summary.title, company: summary.company }}
      cvs={cvs}
      autoTailor={autoTailor}
      details={
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h1 dir="auto" className="font-heading text-xl font-semibold leading-snug">
              {summary.title}
            </h1>
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <span dir="auto">{summary.company}</span>
              <span aria-hidden>·</span>
              <MapPinIcon className="size-3.5" aria-hidden />
              <span dir="auto">{summary.location}</span>
              {summary.remote && <Badge variant="outline">Remote</Badge>}
            </p>
            {summary.url && summary.source !== 'Demo listing' && (
              <a
                href={summary.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 self-start text-sm text-primary underline-offset-4 hover:underline"
              >
                Open original posting <ExternalLinkIcon className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
          {description && (
            <div
              dir="auto"
              className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground"
              data-testid="job-description"
            >
              {preview}
              {rest && (
                <details>
                  <summary className="cursor-pointer text-primary">Show full description</summary>
                  {rest}
                </details>
              )}
            </div>
          )}
        </div>
      }
      requirements={
        <Suspense fallback={<Skeleton className="h-16 w-full rounded-lg" />}>
          <Requirements userId={user.id} jobId={summary.id} />
        </Suspense>
      }
    />
  );
}

/** Reads the job's keywords (an AI call the first time, cached after); the page works without them. */
async function Requirements({ userId, jobId }: { userId: string; jobId: string }) {
  let data: Awaited<ReturnType<typeof jobRequirementsForCvs>>;
  try {
    data = await jobRequirementsForCvs(userId, jobId);
  } catch (error) {
    console.error('job requirements failed:', error instanceof Error ? error.name : 'unknown');
    return null;
  }
  return <RequirementChips requirements={data.requirements} have={data.have} />;
}
