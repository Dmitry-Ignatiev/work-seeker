import Link from 'next/link';
import { Suspense } from 'react';
import { AppNav } from '@/components/app-nav';
import { UserMenu } from '@/components/auth/user-menu';
import { LogoMark } from '@/components/brand/logo-mark';

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b bg-card/80 shadow-[0_1px_12px_-6px_rgb(15_23_42/0.12)] backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6">
          <Link href="/assistant" className="flex shrink-0 items-center gap-2.5 font-heading text-[17px] font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-500 text-primary-foreground shadow-sm shadow-primary/30">
              <LogoMark className="size-5" />
            </span>
            <span className="hidden sm:inline">Work Seeker</span>
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
