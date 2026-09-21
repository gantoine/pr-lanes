import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const envPath = path.join(import.meta.dirname, '.env');

export async function loadEnvFile() {
  if (!existsSync(envPath)) return;

  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
    return;
  }

  for (const line of (await readFile(envPath, 'utf8')).split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}
