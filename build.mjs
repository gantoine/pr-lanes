import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const root = import.meta.dirname;
const source = path.join(root, 'extension');
const dist = path.join(root, 'dist');

const GECKO_ID = 'pr-lanes@gantoine.com';

function firefoxManifest(manifest) {
  return {
    ...manifest,
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '115.0',
        data_collection_permissions: { required: ['none'] }
      }
    },
    options_ui: { ...manifest.options_ui, browser_style: false }
  };
}

async function build(name, transform) {
  const target = path.join(dist, name);
  await cp(source, target, { recursive: true });

  if (transform) {
    const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
    await writeFile(path.join(target, 'manifest.json'), JSON.stringify(transform(manifest), null, 2) + '\n');
  }

  await run('zip', ['-qr', `${target}.zip`, '.'], { cwd: target });
  return target;
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const built = await Promise.all([build('chrome'), build('firefox', firefoxManifest)]);

for (const target of built) {
  console.log(`built ${path.relative(root, target)} and ${path.relative(root, target)}.zip`);
}
