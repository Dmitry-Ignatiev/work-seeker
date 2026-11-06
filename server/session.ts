import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { auth } from './auth';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

/** Reads and validates the session once per request. Returns null when signed out. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, name, email, image } = session.user;
  return { id, name, email, image: image ?? null };
});

/**
 * The real authorization check (proxy.ts only does an optimistic cookie check).
 * Call it in every page, Server Action and Route Handler that touches user data.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  return user;
}
