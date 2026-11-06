import Link from 'next/link';
import { Suspense } from 'react';
import { CvUpload } from '@/components/cv/cv-upload';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { countCvs } from '@/server/services/cv';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Welcome' };

export default function OnboardingPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Welcome to Work Seeker</h1>
        <p className="text-sm text-muted-foreground">
          Start with your CV. Work Seeker checks every job&apos;s requirements against it and shows you the proof.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-36 w-full rounded-xl" />}>
        <FirstStep />
      </Suspense>
    </div>
  );
}

async function FirstStep() {
  const user = await requireUser();
  if ((await countCvs(user.id)) === 0) return <CvUpload nextHref="/cvs" />;
  return (
    <Link href="/cvs" className={buttonVariants({ className: 'self-start' })}>
      See your CVs
    </Link>
  );
}
