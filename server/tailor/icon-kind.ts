import type { LayoutRun } from '@/server/cv/layout';
import type { IconKind } from './icons';

/**
 * Which icon to draw for a run the PDF had an icon in front of, from the text it introduces: the run itself,
 * or the next one when the run is only a space. Unknown text gets none (an image used as a bullet, a logo).
 */
export function iconKind(runs: LayoutRun[], index: number): IconKind | null {
  const run = runs[index];
  const target = !run.text.trim() && runs[index + 1] ? runs[index + 1] : run;
  const text = target.text.trim();
  const url = target.url ?? '';
  if (/^mailto:/i.test(url) || /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text)) return 'email';
  if (/linkedin/i.test(url) || /linkedin/i.test(text)) return 'linkedin';
  if (/^\+?[\d()\-.]{7,}$/.test(text.replace(/[\s|]/g, ''))) return 'phone';
  if (/^https?:/i.test(url)) return 'link';
  return null;
}
