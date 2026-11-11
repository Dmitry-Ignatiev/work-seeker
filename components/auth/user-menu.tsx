import { KeyRoundIcon } from 'lucide-react';
import Link from 'next/link';
import { getCurrentUser } from '@/server/session';
import { SignOutButton } from './sign-out-button';

/** "Dima Ignatiev" → "DI"; one word → its first letter. */
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words.at(-1)![0] : (words[0]?.[0] ?? '?')).toUpperCase();
}

/** Reads the session, so it must render inside a <Suspense> boundary. */
export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div className="flex items-center gap-1 text-sm sm:gap-2">
      <div className="flex items-center gap-2 rounded-full border bg-card py-1 pr-1 pl-1 md:pr-3" title={user.email}>
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
          aria-hidden
        >
          {initials(user.name)}
        </span>
        <span className="hidden max-w-40 truncate font-medium md:inline" data-testid="user-name">
          {user.name}
        </span>
      </div>
      <Link
        href="/recovery-code"
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Recovery code"
      >
        <KeyRoundIcon className="size-4" aria-hidden />
        <span className="hidden lg:inline">Recovery code</span>
      </Link>
      <SignOutButton />
    </div>
  );
}
