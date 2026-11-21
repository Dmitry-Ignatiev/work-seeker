import { ArrowRightIcon } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { initials } from '@/components/auth/user-menu';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getCurrentUser } from '@/server/session';

function SignedOutHeader() {
  return (
    <>
      {/* On phones only the main button shows, so the header stays on one row; the sign-up page links to sign-in. */}
      <Link href="/sign-in" className={cn(buttonVariants({ variant: 'ghost' }), 'hidden h-11 px-3.5 text-[15px] sm:inline-flex')}>
        Sign in
      </Link>
      <Link href="/sign-up" className={cn(buttonVariants(), 'h-11 rounded-xl px-4 text-[15px]')}>
        Sign up free
      </Link>
    </>
  );
}

async function HeaderForUser() {
  const user = await getCurrentUser();
  if (!user) return <SignedOutHeader />;
  return (
    <>
      {/* Phones: the initials only, so the header stays on one row. */}
      <span className="flex items-center gap-2 rounded-full border bg-card p-1 text-sm sm:pr-3" title={user.name}>
        <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden>
          {initials(user.name)}
        </span>
        <span className="hidden max-w-40 truncate font-medium sm:inline" data-testid="landing-user">
          {user.name}
        </span>
      </span>
      <Link href="/assistant" className={cn(buttonVariants(), 'h-11 rounded-xl px-4 text-[15px]')}>
        Open my chat
      </Link>
    </>
  );
}

/** The homepage header's right side: Sign in / Sign up free, or the signed-in user and "Open my chat". */
export function LandingHeaderAuth() {
  return (
    <Suspense fallback={<SignedOutHeader />}>
      <HeaderForUser />
    </Suspense>
  );
}

const startButton = cn(buttonVariants({ size: 'lg' }), 'h-12 gap-2 rounded-xl px-5 text-base');

function StartLink({ signedIn }: { signedIn: boolean }) {
  return (
    <Link href={signedIn ? '/assistant' : '/sign-up'} className={startButton}>
      {signedIn ? 'Open my chat' : 'Start chatting'} <ArrowRightIcon aria-hidden />
    </Link>
  );
}

async function StartForUser() {
  return <StartLink signedIn={(await getCurrentUser()) !== null} />;
}

/** The homepage's main button: "Start chatting" (to sign-up) or, for someone signed in, "Open my chat". */
export function LandingStartButton() {
  return (
    <Suspense fallback={<StartLink signedIn={false} />}>
      <StartForUser />
    </Suspense>
  );
}
