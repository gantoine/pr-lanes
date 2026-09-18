import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = [16, 32, 48, 128];

const BACKGROUND = '#0d1117';
const HUMAN = '#2da44e';
const BOT = '#bf8700';

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="100%" height="100%">
  <defs>
    <clipPath id="humanLane"><rect x="14" y="14" width="43" height="100" rx="9" /></clipPath>
    <clipPath id="botLane"><rect x="71" y="14" width="43" height="100" rx="9" /></clipPath>
  </defs>

  <rect width="128" height="128" rx="26" fill="${BACKGROUND}" />
  <rect x="14" y="14" width="43" height="100" rx="9" fill="${HUMAN}" />
  <rect x="71" y="14" width="43" height="100" rx="9" fill="${BOT}" />

  <g clip-path="url(#humanLane)" fill="#ffffff">
    <circle cx="57" cy="46" r="17" />
    <path d="M57 69c-17 0-31 11-31 25v14h62V94c0-14-14-25-31-25Z" />
  </g>

  <g clip-path="url(#botLane)">
    <g fill="#ffffff">
      <rect x="68" y="22" width="6" height="13" rx="3" />
      <rect x="43" y="34" width="56" height="50" rx="15" />
      <rect x="51" y="90" width="40" height="18" rx="7" />
    </g>
    <g fill="${BOT}">
      <circle cx="83" cy="56" r="7" />
      <rect x="77" y="70" width="16" height="6" rx="3" />
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
