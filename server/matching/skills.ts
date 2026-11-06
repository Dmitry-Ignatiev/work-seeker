/** Pure skill-taxonomy helpers: alias normalization and seed-file parsing. No database access. */

export interface TaxonomyAlias {
  alias: string;
  /** False for aliases that are also common words: exact-name lookups only, no free-text scanning. */
  textScan: boolean;
}

export interface TaxonomySkill {
  canonicalName: string;
  category: string;
  aliases: TaxonomyAlias[];
}

/** Lowercase, trim, collapse inner whitespace, drop trailing punctuation. "  Node.JS. " → "node.js" */
export function normalizeSkillName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/, '')
    .trim();
}

const AMBIGUOUS_PREFIX = '~';

/**
 * Parses prisma/seed-data/skills.json: `{ category: [[canonical, ...aliases]] }`.
 * The canonical name is always an alias; a `~` prefix marks an alias as exact-match only.
 * Throws when one alias would point at two different skills.
 */
export function parseSkillTaxonomy(data: Record<string, unknown>): TaxonomySkill[] {
  const skills: TaxonomySkill[] = [];
  const owner = new Map<string, string>();

  for (const [category, entries] of Object.entries(data)) {
    if (category.startsWith('_')) continue;
    if (!Array.isArray(entries)) throw new Error(`Category "${category}" must be an array`);

    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length === 0 || entry.some(a => typeof a !== 'string')) {
        throw new Error(`Bad entry in "${category}": ${JSON.stringify(entry)}`);
      }
      const [rawCanonical, ...rawAliases] = entry as string[];
      const canonicalName = rawCanonical.replace(/^~/, '').trim();
      const aliases = new Map<string, boolean>();

      for (const raw of [rawCanonical, ...rawAliases]) {
        const textScan = !raw.startsWith(AMBIGUOUS_PREFIX);
        const alias = normalizeSkillName(raw.replace(/^~/, ''));
        if (!alias) continue;
        // If any spelling marks it ambiguous, it stays exact-match only.
        aliases.set(alias, (aliases.get(alias) ?? true) && textScan);
      }

      for (const alias of aliases.keys()) {
        const existing = owner.get(alias);
        if (existing && existing !== canonicalName) {
          throw new Error(`Alias "${alias}" maps to both "${existing}" and "${canonicalName}"`);
        }
        owner.set(alias, canonicalName);
      }

      skills.push({
        canonicalName,
        category,
        aliases: [...aliases].map(([alias, textScan]) => ({ alias, textScan })),
      });
    }
  }

  const names = new Set<string>();
  for (const s of skills) {
    if (names.has(s.canonicalName)) throw new Error(`Duplicate skill "${s.canonicalName}"`);
    names.add(s.canonicalName);
  }
  return skills;
}

/** alias → canonical name, for exact lookups. */
export function buildAliasIndex(skills: TaxonomySkill[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const s of skills) for (const a of s.aliases) index.set(a.alias, s.canonicalName);
  return index;
}
