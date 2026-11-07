import { Suspense } from 'react';
import { CvList } from '@/components/cv/cv-list';
import { CvUpload } from '@/components/cv/cv-upload';
import { Skeleton } from '@/components/ui/skeleton';
import { listCvs } from '@/server/services/cv';
import { requireUser } from '@/server/session';

export const metadata = { title: 'CVs' };

/** The heading and upload box are static; only the list reads the session, so it streams in. */
export default function CvsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Your CVs</h1>
        <p className="text-sm text-muted-foreground">Jobs are matched against your default CV.</p>
      </div>
      <CvUpload />
      <Suspense fallback={<Skeleton className="h-32 w-full rounded-xl" />}>
        <UserCvs />
      </Suspense>
    </div>
  );
}

async function UserCvs() {
  const user = await requireUser();
  const cvs = await listCvs(user.id);
  return <CvList cvs={cvs.map(cv => ({ ...cv, createdAt: cv.createdAt.toISOString() }))} />;
}
