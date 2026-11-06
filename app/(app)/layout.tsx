import Link from 'next/link';
import { Suspense } from 'react';
import { AppNav } from '@/components/app-nav';
import { UserMenu } from '@/components/auth/user-menu';

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
          <Link href="/jobs" className="shrink-0 font-heading font-semibold">
            Work Seeker
          </Link>
          <AppNav />
          <div className="ml-auto shrink-0">
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>{children}</Suspense>
      </main>
    </div>
  );
}
