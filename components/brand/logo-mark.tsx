import type { SVGProps } from 'react';

/**
 * Work Seeker's mark: a compass ring with a gap at the top right, its needle breaking out through it.
 * Uses the text color.
 */
export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M19.7 8.41A8.5 8.5 0 1 1 15.59 4.3" />
      <path d="M21 3 13.4 13.4 10.6 10.6Z" fill="currentColor" />
      <path d="M7.6 16.4 10.6 10.6 13.4 13.4Z" strokeWidth={1.6} opacity={0.7} />
    </svg>
  );
}
