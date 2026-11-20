/**
 * Only same-site relative redirects: "/path" yes; "//host", "/\host" (browsers treat both as another site) and
 * absolute URLs no. Shared by the sign-in form and the sign-in page.
 */
export function safeNext(next: string | null | undefined): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : null;
}
