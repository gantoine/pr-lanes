import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = import.meta.dirname;
const envPath = path.join(root, '.env');
const sourceDir = path.join(root, 'dist', 'firefox');
const artifactsDir = path.join(root, 'signed');
const dryRun = process.argv.includes('--dry-run');

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function loadEnvFile() {
  if (!existsSync(envPath)) {
    fail('No .env found. Copy .env.example to .env and fill in your addons.mozilla.org API credentials.');
  }

  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
    return;
  }

  for (const line of (await readFile(envPath, 'utf8')).split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

await loadEnvFile();

const apiKey = process.env.WEB_EXT_API_KEY || process.env.AMO_JWT_ISSUER;
const apiSecret = process.env.WEB_EXT_API_SECRET || process.env.AMO_JWT_SECRET;

if (!apiKey || !apiSecret) {
  fail('.env is missing WEB_EXT_API_KEY or WEB_EXT_API_SECRET. Get them from https://addons.mozilla.org/developers/addon/api/key/');
}

const manifest = JSON.parse(await readFile(path.join(root, 'extension', 'manifest.json'), 'utf8'));
const signed = async () => (await readdir(artifactsDir).catch(() => [])).filter((file) => file.endsWith('.xpi'));
const already = (await signed()).filter((file) => file.endsWith(`-${manifest.version}.xpi`));

if (already.length) {
  fail(`signed/${already[0]} already exists, and addons.mozilla.org rejects a version it has already signed.\nBump "version" in extension/manifest.json first.`);
}

const args = [
  '--yes',
  'web-ext',
  'sign',
  '--source-dir',
  sourceDir,
  '--artifacts-dir',
  artifactsDir,
  '--channel',
  'unlisted'
];

if (dryRun) {
  console.log(`version ${manifest.version}, signing ${path.relative(root, sourceDir)} as an unlisted add-on`);
  console.log(`would run: npx ${args.join(' ')}`);
  console.log(`credentials: WEB_EXT_API_KEY=${apiKey.slice(0, 6)}… (${apiSecret.length}-character secret)`);
  console.log(`artifacts:  signed/`);
  process.exit(0);
}

await run('node', ['build.mjs']);
await run('npx', args, { env: { ...process.env, WEB_EXT_API_KEY: apiKey, WEB_EXT_API_SECRET: apiSecret } });

const produced = await signed();
console.log(`\nSigned: ${produced.map((file) => `signed/${file}`).join(', ')}`);
console.log('Host that file anywhere and open the link in Firefox to install it.');
