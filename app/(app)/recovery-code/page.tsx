import { Suspense } from 'react';
import { RecoveryCodePanel } from '@/components/auth/recovery-code-panel';
import { Skeleton } from '@/components/ui/skeleton';
import { hasRecoveryCode } from '@/server/services/recovery';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Recovery code' };

/** The heading is static; the panel reads the session and the URL, so it streams in. */
export default function RecoveryCodePage({ searchParams }: PageProps<'/recovery-code'>) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">Recovery code</h1>
      <Suspense fallback={<Skeleton className="h-24 w-full rounded-xl" />}>
        <UserRecoveryCode searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function UserRecoveryCode({ searchParams }: Pick<PageProps<'/recovery-code'>, 'searchParams'>) {
  const user = await requireUser();
  const welcome = (await searchParams).welcome === '1';
  const hasCode = await hasRecoveryCode(user.id);
  return (
    <>
      {welcome && <p className="text-sm font-medium">Welcome! One more step before the chat: save your recovery code.</p>}
      <RecoveryCodePanel hasCode={hasCode} welcome={welcome} />
    </>
  );
}
