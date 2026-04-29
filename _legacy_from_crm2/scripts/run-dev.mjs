import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const envPath = path.join(root, '.env.local');

if (!fs.existsSync(envPath)) {
  console.error('Missing .env.local. Run `npm run ports:select` first.');
  process.exit(1);
}

const envRaw = fs.readFileSync(envPath, 'utf-8');
const portMatch = envRaw.match(/^NEXT_PORT=(\d+)$/m);

if (!portMatch) {
  console.error('NEXT_PORT is not configured in .env.local');
  process.exit(1);
}

const nextPort = portMatch[1];

const child = spawn('npx', ['next', 'dev', '-p', nextPort], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: false
});

child.on('exit', (code) => process.exit(code ?? 0));
