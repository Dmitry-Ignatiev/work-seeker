/** Pure robots.txt parsing and matching (RFC 9309: longest match wins, Allow wins ties). */

export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

/** Rules for our user agent: a group naming "workseekerbot" wins over "*". */
export function parseRobots(text: string, agent = 'workseekerbot'): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!match) continue;
    const [, field, value] = match;
    const key = field.toLowerCase();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.trim().toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' && value) current.allow.push(value.trim());
    if (key === 'disallow' && value) current.disallow.push(value.trim());
  }

  const own = groups.filter(g => g.agents.some(a => a !== '*' && agent.includes(a)));
  const chosen = own.length > 0 ? own : groups.filter(g => g.agents.includes('*'));
  return {
    allow: chosen.flatMap(g => g.allow),
    disallow: chosen.flatMap(g => g.disallow),
  };
}

/** Converts a robots pattern ("*" wildcard, "$" end anchor) to a RegExp. */
function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Is `pathWithQuery` (e.g. "/jobslobby/software/?page=2") allowed by these rules? */
export function isAllowedByRobots(rules: RobotsRules, pathWithQuery: string): boolean {
  let best: { length: number; allow: boolean } | null = null;
  const consider = (patterns: string[], allow: boolean) => {
    for (const pattern of patterns) {
      if (!patternToRegExp(pattern).test(pathWithQuery)) continue;
      const length = pattern.length;
      if (!best || length > best.length || (length === best.length && allow)) best = { length, allow };
    }
  };
  consider(rules.disallow, false);
  consider(rules.allow, true);
  return best === null ? true : (best as { allow: boolean }).allow;
}
