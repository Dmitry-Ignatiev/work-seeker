/** Pure JSON-LD extraction, tolerant of real-world markup. No dependencies. */

export type JsonObject = Record<string, unknown>;

/**
 * Splits text into top-level JSON objects by scanning balanced braces (outside strings).
 * Handles blocks that hold several objects back to back ("{...},{...}"), which some sites emit.
 */
function topLevelObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) out.push(text.slice(start, i + 1));
    }
  }
  return out;
}

function parseBlock(raw: string): unknown[] {
  const text = raw.trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [value];
  } catch {
    const parsed: unknown[] = [];
    for (const chunk of topLevelObjects(text)) {
      try {
        parsed.push(JSON.parse(chunk));
      } catch {
        // Skip the broken object, keep the rest.
      }
    }
    return parsed;
  }
}

/** Every JSON-LD object on the page, with arrays and @graph flattened. */
export function extractJsonLd(html: string): JsonObject[] {
  const objects: JsonObject[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      const obj = value as JsonObject;
      objects.push(obj);
      if (Array.isArray(obj['@graph'])) obj['@graph'].forEach(visit);
    }
  };
  for (const match of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    parseBlock(match[1]).forEach(visit);
  }
  return objects;
}

const hasType = (obj: JsonObject, type: string) =>
  obj['@type'] === type || (Array.isArray(obj['@type']) && obj['@type'].includes(type));

export function extractJobPostings(html: string): JsonObject[] {
  return extractJsonLd(html).filter(obj => hasType(obj, 'JobPosting'));
}

/** Reads a string-ish field: strings, numbers, or { name } / { value } objects. */
export function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const obj = value as JsonObject;
    return str(obj.name) ?? str(obj.value);
  }
  return undefined;
}

/** "City, Region, Country" from a schema.org jobLocation (object or array). */
export function jobLocationText(value: unknown): string | undefined {
  const places = Array.isArray(value) ? value : value ? [value] : [];
  const names = places
    .map(place => {
      const address = (place as JsonObject)?.address as JsonObject | string | undefined;
      if (typeof address === 'string') return address;
      if (!address) return str(place);
      const country = str(address.addressCountry);
      const parts = [str(address.addressLocality), str(address.addressRegion), country === 'IL' ? 'Israel' : country];
      return [...new Set(parts.filter(Boolean))].join(', ');
    })
    .filter(Boolean);
  return names.length > 0 ? names.join(' · ') : undefined;
}
