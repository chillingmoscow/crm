import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const envPath = path.join(root, '.env.local');
const supabaseEnvPath = path.join(root, 'supabase', '.env.ports');
const templatePath = path.join(root, 'supabase', 'config.template.toml');
const supabaseConfigPath = path.join(root, 'supabase', 'config.toml');
const projectId = 'crm2-platform-core';

const ranges = {
  NEXT_PORT: [3400, 3499],
  SUPABASE_API_PORT: [55000, 55099],
  SUPABASE_DB_PORT: [55100, 55199],
  SUPABASE_SHADOW_PORT: [55200, 55299],
  SUPABASE_STUDIO_PORT: [55300, 55399],
  SUPABASE_INBUCKET_PORT: [55400, 55499],
  SUPABASE_ANALYTICS_PORT: [55500, 55599]
};

function isPortFree(port) {
  try {
    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN || true`, {
      encoding: 'utf-8'
    }).trim();
    return output.length === 0;
  } catch {
    return false;
  }
}

function pickPort(name, [start, end]) {
  for (let p = start; p <= end; p += 1) {
    if (isPortFree(p)) {
      return p;
    }
  }

  let diag = '';
  try {
    diag = execSync(`lsof -nP -iTCP:${start}-${end} -sTCP:LISTEN || true`, {
      encoding: 'utf-8'
    }).trim();
  } catch {
    diag = 'Unable to collect lsof diagnostics.';
  }

  throw new Error(
    `No free ports for ${name} in range ${start}-${end}.\n` +
      (diag || 'No listener details found, but range appears exhausted.')
  );
}

function renderTemplate(template, values) {
  return template
    .replaceAll('__NEXT_PORT__', String(values.NEXT_PORT))
    .replaceAll('__SUPABASE_API_PORT__', String(values.SUPABASE_API_PORT))
    .replaceAll('__SUPABASE_DB_PORT__', String(values.SUPABASE_DB_PORT))
    .replaceAll('__SUPABASE_SHADOW_PORT__', String(values.SUPABASE_SHADOW_PORT))
    .replaceAll('__SUPABASE_STUDIO_PORT__', String(values.SUPABASE_STUDIO_PORT))
    .replaceAll('__SUPABASE_INBUCKET_PORT__', String(values.SUPABASE_INBUCKET_PORT))
    .replaceAll('__SUPABASE_ANALYTICS_PORT__', String(values.SUPABASE_ANALYTICS_PORT));
}

function getRunningSupabasePorts() {
  try {
    const output = execSync("docker ps --format '{{.Names}}\t{{.Ports}}' || true", {
      encoding: 'utf-8'
    }).trim();
    if (!output) return null;

    const rows = output.split('\n');
    const byName = new Map();

    for (const row of rows) {
      const [name, ports = ''] = row.split('\t');
      if (!name.includes(`_${projectId}`)) continue;
      byName.set(name, ports);
    }

    if (byName.size === 0) return null;

    const extract = (namePart, targetPort) => {
      const matchName = [...byName.keys()].find((name) => name.startsWith(`supabase_${namePart}_`));
      if (!matchName) return null;
      const ports = byName.get(matchName) ?? '';
      const regex = new RegExp(`(?:0\\.0\\.0\\.0|\\[::\\]):(\\d+)->${targetPort}/tcp`);
      const match = ports.match(regex);
      return match ? Number(match[1]) : null;
    };

    const found = {
      SUPABASE_API_PORT: extract('kong', 8000),
      SUPABASE_DB_PORT: extract('db', 5432),
      SUPABASE_STUDIO_PORT: extract('studio', 3000),
      SUPABASE_INBUCKET_PORT: extract('inbucket', 8025),
      SUPABASE_ANALYTICS_PORT: extract('analytics', 4000)
    };

    if (
      found.SUPABASE_API_PORT &&
      found.SUPABASE_DB_PORT &&
      found.SUPABASE_STUDIO_PORT &&
      found.SUPABASE_INBUCKET_PORT &&
      found.SUPABASE_ANALYTICS_PORT
    ) {
      return found;
    }
  } catch {
    return null;
  }

  return null;
}

function readExistingEnvValues() {
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, 'utf-8');
  const map = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1);
    map[key] = value;
  }
  return map;
}

function pickStableNextPort(range) {
  const existing = readExistingEnvValues();
  const existingPort = Number(existing.NEXT_PORT ?? '');
  if (Number.isInteger(existingPort) && existingPort >= range[0] && existingPort <= range[1]) {
    // Keep previously assigned app port when possible for a stable local URL.
    if (isPortFree(existingPort)) return existingPort;
  }
  return pickPort('NEXT_PORT', range);
}

function getRunningSupabaseKeys() {
  try {
    const output = execSync('supabase status -o env || true', { encoding: 'utf-8' }).trim();
    if (!output) return null;

    const values = new Map();
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes('=')) continue;
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx);
      const value = trimmed.slice(idx + 1).replace(/^"|"$/g, '');
      values.set(key, value);
    }

    const publishable = values.get('PUBLISHABLE_KEY') ?? '';
    const serviceRole = values.get('SECRET_KEY') ?? '';

    if (!publishable || !serviceRole) return null;
    return { publishable, serviceRole };
  } catch {
    return null;
  }
}

function writeEnvFiles(values) {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  const statusKeys = getRunningSupabaseKeys();
  const existingAnonKeyMatch = existing.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m);
  const existingServiceRoleMatch = existing.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);

  const envLines = [
    `NEXT_PORT=${values.NEXT_PORT}`,
    `SUPABASE_API_PORT=${values.SUPABASE_API_PORT}`,
    `SUPABASE_DB_PORT=${values.SUPABASE_DB_PORT}`,
    `SUPABASE_SHADOW_PORT=${values.SUPABASE_SHADOW_PORT}`,
    `SUPABASE_STUDIO_PORT=${values.SUPABASE_STUDIO_PORT}`,
    `SUPABASE_INBUCKET_PORT=${values.SUPABASE_INBUCKET_PORT}`,
    `SUPABASE_ANALYTICS_PORT=${values.SUPABASE_ANALYTICS_PORT}`,
    `SUPABASE_URL=http://127.0.0.1:${values.SUPABASE_API_PORT}`,
    `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${values.SUPABASE_API_PORT}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${statusKeys?.publishable ?? existingAnonKeyMatch?.[1] ?? '<set-from-supabase-start-output>'}`,
    `SUPABASE_SERVICE_ROLE_KEY=${statusKeys?.serviceRole ?? existingServiceRoleMatch?.[1] ?? '<set-from-supabase-start-output>'}`
  ];

  fs.writeFileSync(envPath, `${envLines.join('\n')}\n`, 'utf-8');
  fs.writeFileSync(supabaseEnvPath, `${envLines.join('\n')}\n`, 'utf-8');
}

async function main() {
  const runningPorts = getRunningSupabasePorts();
  const values = {};
  for (const [name, range] of Object.entries(ranges)) {
    if (name === 'NEXT_PORT') {
      values[name] = pickStableNextPort(range);
      continue;
    }

    if (runningPorts?.[name]) {
      values[name] = runningPorts[name];
      continue;
    }

    values[name] = pickPort(name, range);
  }

  writeEnvFiles(values);

  if (fs.existsSync(templatePath)) {
    const template = fs.readFileSync(templatePath, 'utf-8');
    const rendered = renderTemplate(template, values);
    fs.writeFileSync(supabaseConfigPath, rendered, 'utf-8');
  }

  const printOrder = [
    'NEXT_PORT',
    'SUPABASE_API_PORT',
    'SUPABASE_DB_PORT',
    'SUPABASE_SHADOW_PORT',
    'SUPABASE_STUDIO_PORT',
    'SUPABASE_INBUCKET_PORT',
    'SUPABASE_ANALYTICS_PORT'
  ];

  console.log(runningPorts ? 'Assigned ports (reusing running Supabase where possible):' : 'Assigned free ports:');
  for (const key of printOrder) {
    console.log(`- ${key}=${values[key]}`);
  }
  console.log(`Updated ${path.relative(root, envPath)} and ${path.relative(root, supabaseConfigPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
