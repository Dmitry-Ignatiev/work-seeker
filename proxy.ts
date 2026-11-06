import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic redirect only: checks that a session cookie exists, not that it is valid.
 * Real checks happen in server/session.ts (requireUser) for every data access.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL('/sign-in', request.url);
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/jobs/:path*',
    '/applications/:path*',
    '/profile/:path*',
    '/cvs/:path*',
    '/searches/:path*',
    '/assistant/:path*',
    '/onboarding/:path*',
  ],
};
