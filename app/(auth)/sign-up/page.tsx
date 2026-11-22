import { Suspense } from 'react';
import { AuthMethods } from '@/components/auth/auth-methods';

export const metadata = { title: 'Create an account' };

export default function SignUpPage({ searchParams }: PageProps<'/sign-up'>) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Create your Work Seeker account</h1>
        <p className="text-sm text-muted-foreground">Free. Find high-tech jobs in one chat and tailor your CV to each one.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <AuthMethods mode="sign-up" searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
