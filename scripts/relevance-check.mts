/**
 * Search quality report: runs a fixed set of job searches against the REAL sources (the same code the chat
 * uses) and checks every result for the right role, place, level and age.
 *   npm run relevance:check            all cases
 *   npm run relevance:check -- qa      only cases whose name contains "qa"
 * Prints a table and writes reports/relevance-<date>.html. Exits 1 if overall precision is below --min (default 0).
 * Like a real search, it stores the jobs it finds in the database pointed to by DATABASE_URL (public job rows).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { config } from 'dotenv';
import { judgeJob, summarize, type CaseResult, type RelevanceCase } from '../server/discovery/relevance';

config({ path: ['.env.local', '.env'], quiet: true });
// After the env is loaded: the database client reads DATABASE_URL when its module loads.
const { searchJobs } = await import('../server/services/jobs');

const CASES: RelevanceCase[] = [
  {
    name: 'QA automation, Tel Aviv',
    search: { query: 'qa automation engineer', location: 'Tel Aviv' },
    roleTitle: [/\bqa\b|quality|automation|test|sdet/i],
    region: 'tel-aviv',
  },
  {
    name: 'Senior backend Node.js, Tel Aviv',
    search: { query: 'senior backend engineer node.js', location: 'Tel Aviv', seniority: 'senior' },
    roleTitle: [/back[\s-]?end|server|node|full[\s-]?stack|platform/i],
    region: 'tel-aviv',
    level: 'senior',
  },
  {
    name: 'Junior frontend React, Israel',
    search: { query: 'junior frontend developer react', seniority: 'junior' },
    roleTitle: [/front[\s-]?end|react|web|ui|full[\s-]?stack/i],
    region: 'israel',
    level: 'junior',
  },
  {
    name: 'DevOps, remote',
    search: { query: 'devops engineer kubernetes', remoteOnly: true },
    roleTitle: [/devops|sre|site reliability|platform|infrastructure|cloud/i],
    region: 'remote',
  },
  {
    name: 'Full stack, Jerusalem',
    search: { query: 'full stack developer', location: 'Jerusalem' },
    roleTitle: [/full[\s-]?stack|software (engineer|developer)/i],
    region: 'jerusalem',
  },
  {
    name: 'Data scientist, Haifa and North',
    search: { query: 'data scientist', location: 'Haifa' },
    roleTitle: [/data scien|machine learning|\bml\b|\bai\b|research/i],
    region: 'haifa-north',
  },
  {
    name: 'Machine learning engineer, Israel',
    search: { query: 'machine learning engineer' },
    roleTitle: [/machine learning|\bml\b|\bai\b|deep learning|computer vision|nlp|llm/i],
    region: 'israel',
  },
  {
    name: 'Product manager, Center',
    search: { query: 'product manager', location: 'Center' },
    roleTitle: [/product (manager|owner|lead)|\bpm\b/i],
    region: 'center',
  },
  {
    name: 'Security analyst, Israel',
    search: { query: 'cyber security analyst' },
    roleTitle: [/security|cyber|soc\b|threat|incident/i],
    region: 'israel',
  },
  {
    name: 'Data engineer, Center',
    search: { query: 'data engineer', location: 'Center' },
    roleTitle: [/data engineer|data platform|etl|analytics engineer|big data/i],
    region: 'center',
  },
];

const args = process.argv.slice(2);
const minArg = args.find(a => a.startsWith('--min='));
const min = minArg ? Number(minArg.slice(6)) : 0;
const filter = args.find(a => !a.startsWith('--'))?.toLowerCase();
const cases = filter ? CASES.filter(c => c.name.toLowerCase().includes(filter)) : CASES;

const pct = (n: number | null) => (n === null ? '  —' : `${Math.round(n * 100)}%`.padStart(4));
const escape = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

console.log(`Search quality report: ${cases.length} searches against the real sources…\n`);
const results: CaseResult[] = [];
for (const c of cases) {
  const start = Date.now();
  try {
    const { jobs, sources } = await searchJobs({ ...c.search, limit: 12 });
    const judged = jobs.map(job => judgeJob(c, job));
    const result: CaseResult = {
      case: c,
      jobs: judged,
      precision: judged.length ? judged.filter(j => j.relevant).length / judged.length : null,
      failedSources: sources.filter(s => !s.ok).map(s => s.source),
      ms: Date.now() - start,
    };
    results.push(result);
    // One line per search: group the ages (each job's exact age is in the HTML report).
    const problems = judged.flatMap(j => j.problems.map(p => (p.startsWith('posted ') ? 'older than 60 days' : p)));
    const top = [...new Set(problems)].map(p => `${p} ×${problems.filter(x => x === p).length}`).join(', ');
    console.log(
      `${pct(result.precision)}  ${c.name.padEnd(36)} ${String(judged.length).padStart(2)} jobs  ${String(result.ms).padStart(5)} ms` +
        (top ? `  · ${top}` : '') +
        (result.failedSources.length ? `  · failed: ${result.failedSources.join(', ')}` : ''),
    );
  } catch (error) {
    results.push({ case: c, jobs: [], precision: null, failedSources: ['search threw'], ms: Date.now() - start });
    console.log(`  ✗  ${c.name.padEnd(36)} ${(error as Error).message}`);
  }
}

const total = summarize(results);
console.log(
  `\nOverall: ${total.relevant} of ${total.jobs} jobs relevant (${pct(total.precision).trim()}), ` +
    `${total.empty} search${total.empty === 1 ? '' : 'es'} returned nothing.`,
);

// HTML report: one table per search, every job with its checks.
const date = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const mark = (v: boolean | null) => (v === null ? '<td class="na">—</td>' : v ? '<td class="ok">✓</td>' : '<td class="bad">✗</td>');
const sections = results
  .map(r => {
    const rows = r.jobs
      .map(
        j => `<tr class="${j.relevant ? '' : 'miss'}"><td>${escape(j.title)}</td><td>${escape(j.company)}</td><td>${escape(j.location)}${j.remote ? ' · remote' : ''}</td>
${mark(j.checks.role)}${mark(j.checks.place)}${mark(j.checks.level)}${mark(j.checks.fresh)}<td>${escape(j.problems.join(', '))}</td><td>${escape(j.source)}</td></tr>`,
      )
      .join('\n');
    const s = r.case.search;
    return `<section><h2>${escape(r.case.name)} <span>${pct(r.precision).trim()} relevant · ${r.jobs.length} jobs · ${r.ms} ms</span></h2>
<p class="q">query "${escape(s.query)}"${s.location ? ` · location "${escape(s.location)}"` : ''}${s.remoteOnly ? ' · remote only' : ''}${s.seniority ? ` · ${s.seniority}` : ''}${r.failedSources.length ? ` · <b>failed: ${escape(r.failedSources.join(', '))}</b>` : ''}</p>
${r.jobs.length ? `<table><tr><th>Title</th><th>Company</th><th>Location</th><th>Role</th><th>Place</th><th>Level</th><th>Fresh</th><th>Problems</th><th>Source</th></tr>${rows}</table>` : '<p class="empty">No jobs returned.</p>'}</section>`;
  })
  .join('\n');
const html = `<!doctype html><meta charset="utf-8"><title>Search quality ${date}</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#0f172a}h1{font-size:20px}h2{font-size:16px;margin:28px 0 4px}h2 span{font-weight:400;color:#64748b;font-size:13px}
.q{color:#64748b;margin:0 0 8px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e2e8f0;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#f8fafc;font-weight:600}tr.miss{background:#fff7ed}.ok{color:#15803d}.bad{color:#b91c1c;font-weight:600}.na{color:#94a3b8}.empty{color:#b91c1c}</style>
<h1>Search quality report · ${date}</h1>
<p><b>${total.relevant} of ${total.jobs}</b> jobs relevant (${pct(total.precision).trim()}) across ${total.cases} searches; ${total.empty} returned nothing.
Relevant = the title is the role asked for, the location is the place asked for (or open remote), the level fits, and it was posted within 60 days.</p>
${sections}`;
mkdirSync('reports', { recursive: true });
const file = `reports/relevance-${date}.html`;
writeFileSync(file, html);
console.log(`Report: ${file}`);

if (total.precision !== null && total.precision < min) {
  console.log(`Below the minimum of ${Math.round(min * 100)}%.`);
  process.exit(1);
}
process.exit(0);
