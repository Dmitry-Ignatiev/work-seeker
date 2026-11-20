import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { SignInForm } from '@/components/auth/sign-in-form';
import { safeNext } from '@/lib/safe-next';
import { authOptions } from '@/server/auth-options';
import { getCurrentUser } from '@/server/session';

export const metadata = { title: 'Sign in' };

async function SignInMethods({ searchParams }: Pick<PageProps<'/sign-in'>, 'searchParams'>) {
  // Read the enabled methods at request time, not at build time.
  await connection();
  // Already signed in (a valid session, not just a cookie): skip the form and go where they were heading.
  if (await getCurrentUser()) {
    const next = (await searchParams).next;
    redirect(safeNext(typeof next === 'string' ? next : null) ?? '/assistant');
  }
  return <SignInForm {...authOptions} />;
}

export default function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Sign in to Work Seeker</h1>
        <p className="text-sm text-muted-foreground">New here? Signing in creates your account.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <SignInMethods searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
