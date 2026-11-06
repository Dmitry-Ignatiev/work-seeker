import { getCurrentUser } from '@/server/session';
import { SignOutButton } from './sign-out-button';

/** Reads the session, so it must render inside a <Suspense> boundary. */
export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="hidden max-w-40 truncate text-muted-foreground md:inline" data-testid="user-name">
        {user.name}
      </span>
      <SignOutButton />
    </div>
  );
}
