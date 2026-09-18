import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = [16, 32, 48, 128];

const HUMAN = '#2da44e';
const BOT = '#bf8700';

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="100%" height="100%">
  <defs><clipPath id="rounded"><rect width="128" height="128" rx="26" /></clipPath></defs>
  <g clip-path="url(#rounded)">
    <rect width="64" height="128" fill="${HUMAN}" />
    <rect x="64" width="64" height="128" fill="${BOT}" />

    <g fill="#ffffff">
      <circle cx="32" cy="46" r="15" />
      <path d="M32 67c-14 0-25 9-25 20v14h50V87c0-11-11-20-25-20Z" />
    </g>

    <g fill="#ffffff">
      <rect x="93" y="26" width="6" height="14" rx="3" />
      <rect x="74" y="38" width="44" height="42" rx="13" />
      <rect x="80" y="86" width="32" height="16" rx="6" />
    </g>
    <g fill="${BOT}">
      <circle cx="87" cy="57" r="6" />
      <circle cx="105" cy="57" r="6" />
    </g>
  </g>
</svg>`;

const workdir = await mkdtemp(path.join(tmpdir(), 'prlanes-icons-'));

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(CHROME, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`chrome exited with ${code}`))));
  });
}

try {
  for (const size of SIZES) {
    const page = path.join(workdir, `icon-${size}.html`);
    await writeFile(page, `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px">${icon}</body></html>`);
    await run([
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--default-background-color=00000000',
      `--window-size=${size},${size}`,
      `--screenshot=${path.join(root, 'extension', 'icons', `icon-${size}.png`)}`,
      `file://${page}`
    ]);
    console.log(`icon-${size}.png`);
  }
} finally {
  await rm(workdir, { recursive: true, force: true });
}
