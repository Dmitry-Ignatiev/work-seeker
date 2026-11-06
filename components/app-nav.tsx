'use client';

import { BriefcaseIcon, FileTextIcon, KanbanSquareIcon, MessageSquareIcon, SearchIcon, UserIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export const NAV_ITEMS = [
  { href: '/jobs', label: 'Jobs', icon: BriefcaseIcon },
  { href: '/applications', label: 'Applications', icon: KanbanSquareIcon },
  { href: '/profile', label: 'Profile', icon: UserIcon },
  { href: '/cvs', label: 'CVs', icon: FileTextIcon },
  { href: '/searches', label: 'Searches', icon: SearchIcon },
  { href: '/assistant', label: 'Assistant', icon: MessageSquareIcon },
] as const;

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              active && 'bg-muted font-medium text-foreground',
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
