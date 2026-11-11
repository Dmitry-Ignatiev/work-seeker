'use client';

import { FileTextIcon, MessageSquareIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { cn } from '@/lib/utils';

export const NAV_ITEMS = [
  { href: '/assistant', label: 'Chat', icon: MessageSquareIcon },
  { href: '/my-cvs', label: 'CVs', icon: FileTextIcon },
] as const;

/**
 * On dynamic routes (/jobs/[id]) the path is only known at request time, so the active highlight
 * streams in; until then the same links show without it.
 */
export function AppNav() {
  return (
    <Suspense fallback={<NavLinks pathname={null} />}>
      <ActiveNav />
    </Suspense>
  );
}

function ActiveNav() {
  return <NavLinks pathname={usePathname()} />;
}

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main" className="flex shrink-0 gap-1 rounded-full bg-muted/70 p-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-all hover:text-foreground',
              active && 'bg-card font-medium text-primary shadow-sm',
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
