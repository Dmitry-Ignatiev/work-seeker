const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, m => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Strip HTML tags (handles entity-encoded HTML too) and collapse whitespace. */
export function htmlToText(html: string | undefined | null): string {
  if (!html) return '';
  // Some feeds entity-encode their HTML, so decode once before stripping tags.
  const decoded = decodeEntities(html);
  return decodeEntities(
    decoded
      .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Repair UTF-8 text that was decoded as Latin-1 ("MÃ¼nchen" -> "München"). */
export function fixMojibake(s: string): string {
  if (!/[ÃÂ][\u0080-\u00ff]/.test(s)) return s;
  try {
    const bytes = Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
    const fixed = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return fixed;
  } catch {
    return s;
  }
}

export function formatSalary(
  min?: number | null,
  max?: number | null,
  currency = '$',
): string | undefined {
  const fmt = (n: number) =>
    n >= 1000 ? `${currency}${Math.round(n / 1000)}k` : `${currency}${n}`;
  if (min && max && min !== max) return `${fmt(min)}–${fmt(max)}`;
  if (min || max) return fmt((min || max)!);
  return undefined;
}

const STOP = new Set(['and', 'or', 'the', 'a', 'an', 'in', 'for', 'of', 'to', 'job', 'jobs', 'role', 'roles', 'remote', 'position']);

export function keywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#.]+/u)
    .map(w => w.replace(/^\.+|\.+$/g, ''))
    .filter(w => w.length > 1 && !STOP.has(w));
}

/**
 * Score how well a job matches the query keywords (0 = no match).
 * Title hits weigh more than tag hits, which weigh more than description hits.
 */
export function keywordScore(
  job: { title: string; tags: string[]; description: string },
  words: string[],
): number {
  if (words.length === 0) return 1;
  const title = job.title.toLowerCase();
  const tags = job.tags.join(' ').toLowerCase();
  const desc = job.description.toLowerCase();
  let score = 0;
  for (const w of words) {
    if (title.includes(w)) score += 3;
    else if (tags.includes(w)) score += 2;
    else if (desc.includes(w)) score += 1;
  }
  return score;
}
