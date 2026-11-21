import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { safeNext } from '@/lib/safe-next';
import { authOptions } from '@/server/auth-options';
import { getCurrentUser } from '@/server/session';
import { SignInForm } from './sign-in-form';

/**
 * The sign-in or sign-up form, read at request time. Someone already signed in (a valid session, not just a
 * cookie) skips it and goes where they were heading. Reads the session, so it must render inside <Suspense>.
 */
export async function AuthMethods({
  mode,
  searchParams,
}: {
  mode: 'sign-in' | 'sign-up';
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Read the enabled methods at request time, not at build time.
  await connection();
  if (await getCurrentUser()) {
    const next = (await searchParams).next;
    redirect(safeNext(typeof next === 'string' ? next : null) ?? '/assistant');
  }
  return <SignInForm mode={mode} {...authOptions} />;
}
