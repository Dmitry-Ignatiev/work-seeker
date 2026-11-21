import { Suspense } from 'react';
import { AuthMethods } from '@/components/auth/auth-methods';

export const metadata = { title: 'Sign in' };

export default function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Sign in to Work Seeker</h1>
        <p className="text-sm text-muted-foreground">Welcome back. Pick up where you left off.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <AuthMethods mode="sign-in" searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
