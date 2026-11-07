/**
 * `npm run dev:offline`: the app with no outside calls at all. A scripted model replaces Claude
 * (AI_MOCK=1) and demo listings replace the job sites (E2E=1). For UI work without an API key,
 * and as a Demo Day fallback when the network is down.
 */
import { spawn } from 'node:child_process';

const child = spawn('npx', ['next', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, AI_MOCK: '1', E2E: '1' },
});
child.on('exit', code => process.exit(code ?? 0));
