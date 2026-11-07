/**
 * `npm run dev:offline`: the app with no outside calls at all. A scripted model replaces Claude
 * (AI_MOCK=1) and demo listings replace the job sites (E2E=1). For UI work without an API key,
 * and as a Demo Day fallback when the network is down.
 *
 * `npm run dev:live-jobs`: scripted model, but REAL job sources (GotFriends, company boards,
 * remote boards). Tests the real job pipeline end to end without an API key.
 * Note: the job sites see this machine's IP.
 */
import { spawn } from 'node:child_process';

const liveJobs = process.argv.includes('--live-jobs');
const nextArgs = process.argv.slice(2).filter(arg => arg !== '--live-jobs');

const env = { ...process.env, AI_MOCK: '1' };
if (liveJobs) delete env.E2E;
else env.E2E = '1';

const child = spawn(`npx next dev ${nextArgs.join(' ')}`.trim(), {
  stdio: 'inherit',
  shell: true,
  env,
});
child.on('exit', code => process.exit(code ?? 0));
