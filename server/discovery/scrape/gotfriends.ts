import 'server-only';
import { cached } from '../http';
import { extractJobPostings, jobLocationText, str } from '../jsonld';
import { isRemoteLocation } from '../location';
import { politeFetch } from '../net/polite-fetch';
import { htmlToText } from '../text';
import type { Job, SourceAdapter } from '../types';

/**
 * GotFriends (Israeli high-tech recruiter). robots.txt allows the job lobby; listing pages carry
 * schema.org JobPosting JSON-LD. We read at most 2 category pages per search, politely.
 * Kill switch: SCRAPE_GOTFRIENDS=false.
 */
export const GOTFRIENDS_ORIGIN = 'https://www.gotfriends.co.il';
const LISTING_TTL_MS = 30 * 60 * 1000;
const MAX_PAGES_PER_SEARCH = 2;
export const GOTFRIENDS_COMPANY = 'Confidential company (via GotFriends)';

/** Role pages from the site's own navigation, with the words that point to each. */
export const ROLE_PAGES: { path: string; words: string[] }[] = [
  { path: '/jobslobby/software/backend-developer/', words: ['backend', 'back-end', 'back end', 'server', 'בקאנד', 'צד שרת'] },
  { path: '/jobslobby/software/frontend-developer/', words: ['frontend', 'front-end', 'front end', 'פרונט', 'ui developer'] },
  { path: '/jobslobby/software/full-stack-developer/', words: ['fullstack', 'full-stack', 'full stack', 'פולסטאק'] },
  { path: '/jobslobby/software/react-developer/', words: ['react'] },
  { path: '/jobslobby/software/angular-developer/', words: ['angular'] },
  { path: '/jobslobby/software/nodejs-developer/', words: ['node', 'nodejs', 'node.js'] },
  { path: '/jobslobby/software/python-developer/', words: ['python', 'django', 'fastapi', 'פייתון'] },
  { path: '/jobslobby/software/java-developer/', words: ['java', 'spring', "ג'אווה"] },
  { path: '/jobslobby/software/kotlin-developer/', words: ['kotlin'] },
  { path: '/jobslobby/software/net-developer/', words: ['.net', 'dotnet', 'c#', 'csharp'] },
  { path: '/jobslobby/software/cplusplus-programmer/', words: ['c++', 'cpp'] },
  { path: '/jobslobby/software/go-developer/', words: ['golang', 'go developer', 'go engineer', ' go '] },
  { path: '/jobslobby/software/scala-developer/', words: ['scala'] },
  { path: '/jobslobby/software/ruby-programmer/', words: ['ruby', 'rails'] },
  { path: '/jobslobby/software/php-developer/', words: ['php', 'laravel'] },
  { path: '/jobslobby/software/mobile-programmer/', words: ['mobile', 'מובייל', 'flutter', 'react native'] },
  { path: '/jobslobby/software/ios-developer/', words: ['ios', 'swift'] },
  { path: '/jobslobby/software/android-developer/', words: ['android'] },
  { path: '/jobslobby/software/real-time-engineerembedded-engineer/', words: ['embedded', 'real-time', 'real time', 'firmware', 'אמבדד'] },
  { path: '/jobslobby/software/data-engineer/', words: ['data engineer', 'דאטה', 'etl', 'spark', 'airflow'] },
  { path: '/jobslobby/software/big-data-developer/', words: ['big data'] },
  { path: '/jobslobby/software/head-of-development-team/', words: ['team lead', 'tech lead', 'ראש צוות'] },
  { path: '/jobslobby/software/graduate-with-high-honors/', words: ['junior', 'graduate', 'entry', 'student', "ג'וניור", 'בוגר', 'סטודנט'] },
  { path: '/jobslobby/software/tech-relocation-positions/', words: ['relocation', 'רילוקיישן'] },
  { path: '/jobslobby/ai/ai-engineer/', words: ['ai engineer', 'ai developer', 'genai', 'gen ai', 'בינה מלאכותית'] },
  { path: '/jobslobby/ai/llm-engineer/', words: ['llm', 'prompt', 'rag', 'agents'] },
  { path: '/jobslobby/ai/solution-architect/', words: ['solution architect', 'solutions architect'] },
  { path: '/jobslobby/algorithm/machine-learning/', words: ['machine learning', 'ml engineer', 'mlops', 'deep learning'] },
  { path: '/jobslobby/algorithm/data-scientist/', words: ['data scientist', 'data science'] },
  { path: '/jobslobby/algorithm/algorithm-engineer/', words: ['algorithm', 'אלגוריתם'] },
  { path: '/jobslobby/algorithm/computer-vision/', words: ['computer vision', 'cv engineer', 'image'] },
  { path: '/jobslobby/qa/automation-developer/', words: ['automation', 'אוטומציה', 'sdet', 'test automation'] },
  { path: '/jobslobby/qa/qa-positions/', words: ['qa', 'manual test', 'tester', 'בדיקות'] },
  { path: '/jobslobby/system/devops-positions/', words: ['devops', 'דבאופס', 'platform engineer', 'kubernetes', 'k8s'] },
  { path: '/jobslobby/system/sre/', words: ['sre', 'site reliability'] },
  { path: '/jobslobby/system/support-engineer/', words: ['support', 'תמיכה', 'customer success engineer'] },
  { path: '/jobslobby/system/it-manager/', words: ['it manager', 'it ', 'helpdesk', 'help desk'] },
  { path: '/jobslobby/system/linux-system/', words: ['linux', 'system admin', 'sysadmin'] },
  { path: '/jobslobby/system/network-manager/', words: ['network', 'רשתות', 'תקשורת'] },
  { path: '/jobslobby/datasecurity/security-researcher/', words: ['security researcher', 'vulnerability', 'חוקר'] },
  { path: '/jobslobby/datasecurity/security-analyst/', words: ['security analyst', 'cyber', 'סייבר', 'אבטחת מידע', 'appsec', 'security'] },
  { path: '/jobslobby/datasecurity/soc-analyst/', words: ['soc'] },
  { path: '/jobslobby/hardware/hardware-engineer/', words: ['hardware', 'חומרה', 'asic', 'fpga', 'vlsi', 'chip'] },
  { path: '/jobslobby/projects/product-manager/', words: ['product manager', 'product owner', 'מנהל מוצר', 'pm '] },
  { path: '/jobslobby/executive-position/development-manager-jobs/', words: ['engineering manager', 'r&d manager', 'מנהל פיתוח', 'group manager'] },
  { path: '/jobslobby/executive-position/vp-rd/', words: ['vp r&d', 'vp engineering', 'cto'] },
];
const FALLBACK_PAGE = '/jobslobby/software/';

/** Picks the most relevant role pages for a free-text query (pure). */
export function pagesForQuery(query: string): string[] {
  const q = ` ${query.toLowerCase()} `;
  const scored = ROLE_PAGES.map(page => ({
    path: page.path,
    score: page.words.reduce((sum, word) => sum + (q.includes(word) ? word.trim().length : 0), 0),
  }))
    .filter(page => page.score > 0)
    .sort((a, b) => b.score - a.score);
  const paths = scored.slice(0, MAX_PAGES_PER_SEARCH).map(page => page.path);
  return paths.length > 0 ? paths : [FALLBACK_PAGE];
}

const JOB_LINK = /href="(\/jobslobby\/[a-z0-9/-]*?\/(\d+)\/)"/i;
const textOf = (html: string | undefined) => htmlToText(html ?? '').replace(/\s+/g, ' ').trim();

function toJob(id: string, path: string, title: string, location: string, description: string, postedAt?: string, tags: string[] = []): Job {
  return {
    id: `gotfriends:${id}`,
    source: 'gotfriends',
    title,
    company: GOTFRIENDS_COMPANY,
    location: location || 'Israel',
    remote: isRemoteLocation(`${title} ${location}`),
    tags,
    url: new URL(path, GOTFRIENDS_ORIGIN).toString(),
    postedAt,
    description,
  };
}

/**
 * Listing page → jobs (pure). The job cards (`<div class="item">`) are the source of truth:
 * each holds the link, title, location and the full description. Some pages also carry JobPosting
 * JSON-LD, but on role pages those entries describe categories, so JSON-LD is only a fallback
 * and only for entries that link to an actual job.
 */
export function parseGotFriendsListing(html: string): Job[] {
  const jobs: Job[] = [];
  for (const card of html.split(/<div class="item">/i).slice(1)) {
    const link = card.match(JOB_LINK);
    const title = textOf(card.match(/<h2 class="title">([\s\S]*?)<\/h2>/i)?.[1]);
    if (!link || !title) continue;
    const location = textOf(card.match(/מיקום:\s*<\/span>\s*<span class="info-data">([\s\S]*?)<\/span>/)?.[1]);
    const descStart = card.indexOf('class="desc"');
    let description = '';
    if (descStart >= 0) {
      const rest = card.slice(descStart + 'class="desc">'.length);
      // Stop at the element holding "מס' משרה" (its attribute contains a stray ">"), or the buttons.
      const end = rest.search(/<div[^<]*מס(?:&#x27;|&#39;|')\s*משרה|<div class="bottom">/);
      description = htmlToText(end >= 0 ? rest.slice(0, end) : rest.slice(0, 8000))
        .replace(/^תיאור המשרה:\s*/, '')
        .trim();
    }
    jobs.push(toJob(link[2], link[1], title, location, description));
  }
  if (jobs.length > 0) return jobs;
  return parseJsonLdListing(html);
}

function parseJsonLdListing(html: string): Job[] {
  return extractJobPostings(html).flatMap(posting => {
    const url = str(posting.url);
    const title = str(posting.title);
    // Only entries that link to an actual job (…/<number>/); others describe categories.
    const id = url?.match(/\/(\d+)\/?$/)?.[1];
    if (!url || !title || !id) return [];
    const tags = [str(posting.employmentType)].filter((t): t is string => Boolean(t));
    return [
      toJob(id, url, title, jobLocationText(posting.jobLocation) ?? 'Israel', htmlToText(str(posting.description)), str(posting.datePosted), tags),
    ];
  });
}

/** Job page → location and the full description including requirements (pure). */
export function parseGotFriendsJobPage(html: string): { title?: string; location?: string; description?: string } {
  const text = htmlToText(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''));
  const location = text.match(/מיקום:\s*\n?\s*([^\n]+)/)?.[1]?.trim();
  const start = text.indexOf('תיאור המשרה:');
  let description: string | undefined;
  if (start >= 0) {
    const rest = text.slice(start + 'תיאור המשרה:'.length);
    const end = rest.search(/מס['’]? משרה|שלחו קורות חיים|\.Id"/);
    description = (end >= 0 ? rest.slice(0, end) : rest.slice(0, 4000)).trim();
  }
  const posting = extractJobPostings(html)[0];
  return {
    title: posting ? str(posting.title) : undefined,
    location,
    description: description || (posting ? htmlToText(str(posting.description)) : undefined),
  };
}

export async function fetchGotFriendsJob(url: string) {
  const page = await politeFetch(url);
  return parseGotFriendsJobPage(page.text);
}

export const gotfriends: SourceAdapter = {
  name: 'gotfriends',
  label: 'GotFriends',
  enabled: () => process.env.SCRAPE_GOTFRIENDS !== 'false',
  async search({ query }) {
    const pages = await Promise.all(
      pagesForQuery(query).map(path =>
        cached(`gotfriends:${path}`, LISTING_TTL_MS, async () =>
          parseGotFriendsListing((await politeFetch(`${GOTFRIENDS_ORIGIN}${path}`)).text),
        ),
      ),
    );
    return pages.flat();
  },
};
