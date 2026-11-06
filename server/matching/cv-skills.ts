/** Pure, deterministic skill scan of free text (CVs). No database access. */

export interface ScanAlias {
  /** Lowercased, as stored in SkillAlias. Only aliases with textScan=true belong here. */
  alias: string;
  skillId: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Same normalization the aliases got (NFKC, lowercase, single spaces). */
function prepare(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Counts skill mentions in `text`. Returns skillId → mentions.
 *
 * - Whole-token matches only: "java" doesn't match inside "javascript", "c" doesn't match "c++".
 * - Longest alias wins: once "react native" matches, that span is blanked, so it isn't also counted as "react".
 */
export function scanSkills(text: string, aliases: ScanAlias[]): Map<string, number> {
  let haystack = prepare(text);
  const counts = new Map<string, number>();
  const ordered = aliases
    .filter(a => a.alias.length > 0)
    .sort((a, b) => b.alias.length - a.alias.length || a.alias.localeCompare(b.alias));

  for (const { alias, skillId } of ordered) {
    if (!haystack.includes(alias)) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(alias)}(?![\\p{L}\\p{N}+#])`, 'gu');
    let found = 0;
    haystack = haystack.replace(pattern, match => {
      found++;
      return ' '.repeat(match.length);
    });
    if (found > 0) counts.set(skillId, (counts.get(skillId) ?? 0) + found);
  }
  return counts;
}
