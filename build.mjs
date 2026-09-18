import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const root = path.dirname(new URL(import.meta.url).pathname);
const source = path.join(root, 'extension');
const dist = path.join(root, 'dist');

const GECKO_ID = 'pr-lanes@georges-antoine.local';

async function buildChrome(manifest) {
  const target = path.join(dist, 'chrome');
  await cp(source, target, { recursive: true });
  await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return target;
}

async function buildFirefox(manifest) {
  const target = path.join(dist, 'firefox');
  await cp(source, target, { recursive: true });

  const firefox = structuredClone(manifest);
  firefox.browser_specific_settings = {
    gecko: { id: GECKO_ID, strict_min_version: '115.0' }
  };
  firefox.options_ui = { page: manifest.options_ui.page, open_in_tab: true, browser_style: false };

  await writeFile(path.join(target, 'manifest.json'), JSON.stringify(firefox, null, 2) + '\n');
  return target;
}

async function zip(dir) {
  const archive = `${dir}.zip`;
  await rm(archive, { force: true });
  try {
    await run('zip', ['-qr', archive, '.'], { cwd: dir });
    return archive;
  } catch (error) {
    return null;
  }
}

const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const build of [buildChrome, buildFirefox]) {
  const target = await build(manifest);
  const archive = await zip(target);
  console.log(`built ${path.relative(root, target)}${archive ? ` and ${path.relative(root, archive)}` : ''}`);
}
