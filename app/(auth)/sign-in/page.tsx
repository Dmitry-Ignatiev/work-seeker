import { connection } from 'next/server';
import { Suspense } from 'react';
import { SignInForm } from '@/components/auth/sign-in-form';
import { authOptions } from '@/server/auth-options';

export const metadata = { title: 'Sign in' };

async function SignInMethods() {
  // Read the enabled methods at request time, not at build time.
  await connection();
  return <SignInForm {...authOptions} />;
}

export default function SignInPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Sign in to Work Seeker</h1>
        <p className="text-sm text-muted-foreground">New here? Signing in creates your account.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <SignInMethods />
      </Suspense>
    </main>
  );
}
