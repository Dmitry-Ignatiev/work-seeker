import { comparable, paragraphText, type CvLayout } from '@/server/cv/layout';

/**
 * Keeps a tailored CV to its original page count: each bullet (and the summary) may grow only while it
 * still fits the lines it already takes up in the original layout. Pure, unit tested.
 */

/** Characters each text may have, keyed by id. Texts not found in the layout get no limit. */
export function lengthLimits(
  layout: CvLayout,
  texts: { id: string; text: string }[],
  normalize: (text: string) => string = t => t,
): Map<string, number> {
  const keys = layout.paragraphs.map(p => comparable(normalize(paragraphText(p))));
  const limits = new Map<string, number>();
  for (const { id, text } of texts) {
    const wanted = comparable(text);
    if (!wanted) continue;
    for (let i = 0; i < keys.length; i++) {
      let joined = '';
      let capacity = 0;
      for (let j = i; j < keys.length && joined.length < wanted.length; j++) {
        joined += keys[j];
        const p = layout.paragraphs[j];
        capacity += p.lineCapacity * p.lines;
        if (joined === wanted) {
          // 3% headroom for the estimate; never below what the text already has.
          limits.set(id, Math.max(text.trim().length, Math.floor(capacity * 0.97)));
          break;
        }
        if (!wanted.startsWith(joined)) break;
      }
      if (limits.has(id)) break;
    }
  }
  return limits;
}

const STOPWORDS = new Set([
  'with', 'that', 'this', 'from', 'into', 'over', 'using', 'used', 'have', 'been', 'were', 'their', 'there', 'they',
  'also', 'such', 'than', 'then', 'when', 'where', 'which', 'while', 'both', 'each', 'more', 'most', 'very', 'well',
  'including', 'across', 'within', 'through', 'about', 'among', 'upon', 'your', 'ours',
]);

/** "applications" and "application", "building" and "build" count as the same word. */
function stem(word: string): string {
  return word.replace(/(ies|es|s|ing|ed)$/, '').replace(/e$/, '');
}

const wordsOf = (text: string) =>
  (text.toLowerCase().replace(/\[[A-Z]+\]/gi, ' ').match(/\p{L}[\p{L}\p{N}+#.]*/gu) ?? [])
    .map(w => w.replace(/\.+$/, ''))
    .filter(w => w.length >= 4 && !STOPWORDS.has(w));

/** Meaningful words of `before` that `after` no longer has (case, plurals and -ing/-ed don't matter). */
export function droppedWords(before: string, after: string): string[] {
  const kept = new Set(wordsOf(after).map(stem));
  const dropped: string[] = [];
  for (const word of wordsOf(before)) if (!kept.has(stem(word)) && !dropped.includes(word)) dropped.push(word);
  return dropped;
}
