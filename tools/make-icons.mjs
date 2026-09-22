import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = [16, 32, 48, 128];

const BACKGROUND = '#0d1117';
const GLYPH = '#e6edf3';
const SLASH = '#d29922';

// The bot the extension strikes through in its own switch, redrawn heavier: whatever the toolbar
// shows should be the button you are about to press, and it has to survive 16 pixels.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="100%" height="100%">
  <rect width="128" height="128" rx="26" fill="${BACKGROUND}" />

  <g fill="${GLYPH}">
    <rect x="59" y="24" width="10" height="16" rx="5" />
    <rect x="29" y="38" width="70" height="62" rx="21" />
  </g>

  <g fill="${BACKGROUND}">
    <circle cx="50" cy="68" r="8" />
    <circle cx="78" cy="68" r="8" />
  </g>

  <g transform="rotate(-45 64 64)">
    <rect x="2" y="53" width="124" height="22" rx="11" fill="${BACKGROUND}" />
    <rect x="10" y="57" width="108" height="14" rx="7" fill="${SLASH}" />
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
