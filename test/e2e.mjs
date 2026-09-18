import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.E2E_PORT || 8745);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT || 9322);
const PAGE_PATH = '/PostHog/posthog/pull/30000/';

const files = {
  '/extension/content/classify.js': ['extension/content/classify.js', 'text/javascript'],
  '/extension/content/lanes.js': ['extension/content/lanes.js', 'text/javascript'],
  '/extension/content/lanes.css': ['extension/content/lanes.css', 'text/css'],
  '/test/extension-stub.js': ['test/extension-stub.js', 'text/javascript']
};

async function buildPage() {
  const html = await readFile(path.join(root, 'test', 'e2e-page.html'), 'utf8');
  const injected = [
    '<link rel="stylesheet" href="/extension/content/lanes.css" />',
    '<script src="/test/extension-stub.js"></script>',
    '<script src="/extension/content/classify.js"></script>',
    '<script src="/extension/content/lanes.js"></script>'
  ].join('');
  return html.replace('</body>', injected + '</body>');
}

async function startServer(page) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const file = files[url.pathname];
    if (file) {
      response.writeHead(200, { 'content-type': file[1] });
      response.end(await readFile(path.join(root, file[0])));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
  });
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  return server;
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('cdp connection failed')), { once: true });
  });
  return new Cdp(socket);
}

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for ${label}: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
}

const SNAPSHOT = `(() => {
  const rows = {};
  for (const row of document.querySelectorAll('[data-row]')) {
    rows[row.dataset.row] = {
      kind: row.dataset.prlanesKind,
      pinned: row.dataset.prlanesPin === '1',
      visible: getComputedStyle(row).display !== 'none'
    };
  }
  const bar = document.querySelector('.prlanes-bar');
  return {
    rows,
    active: bar.querySelector('.prlanes-tab--active').dataset.lane,
    humanCount: bar.querySelector('[data-count="human"]').textContent,
    botCount: bar.querySelector('[data-count="bot"]').textContent,
    note: bar.querySelector('[data-note]').textContent,
    barBeforeTimeline: bar.nextElementSibling === document.querySelector('.js-discussion'),
    composerVisible: getComputedStyle(document.querySelector('.discussion-timeline-actions')).display !== 'none'
  };
})()`;

const workdir = await mkdtemp(path.join(tmpdir(), 'prlanes-e2e-'));
const server = await startServer(await buildPage());
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${path.join(workdir, 'profile')}`,
  'about:blank'
], { stdio: 'ignore' });

let failure = null;

try {
  const version = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    return response.ok ? response.json() : null;
  }, 20000, 'devtools endpoint');

  const browser = await connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: `http://localhost:${PORT}${PAGE_PATH}` });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  await browser.send('Runtime.enable', {}, sessionId);

  const evaluate = async (expression) => {
    const result = await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };

  await waitFor(() => evaluate('Boolean(document.querySelector(".prlanes-bar"))'), 15000, 'lane bar injection');

  const humans = await evaluate(SNAPSHOT);

  assert.equal(humans.active, 'human', 'default lane is Humans');
  assert.equal(humans.barBeforeTimeline, true, 'lane bar sits above the timeline');
  assert.equal(humans.rows['pr-body'].kind, 'human');
  assert.equal(humans.rows['bot-comment'].kind, 'bot');
  assert.equal(humans.rows['bot-review'].kind, 'bot');
  assert.equal(humans.rows['human-thread'].kind, 'human');
  assert.equal(humans.rows['human-event'].kind, 'activity');
  assert.equal(humans.rows['bot-event'].kind, 'bot');
  assert.equal(humans.rows['pr-body'].visible, true, 'human comment visible in Humans lane');
  assert.equal(humans.rows['human-thread'].visible, true, 'bot thread with a human reply stays in Humans lane');
  assert.equal(humans.rows['human-event'].visible, true, 'human timeline event visible by default');
  assert.equal(humans.rows['bot-comment'].visible, false, 'bot comment hidden in Humans lane');
  assert.equal(humans.rows['bot-review'].visible, false, 'bot review hidden in Humans lane');
  assert.equal(humans.rows['bot-event'].visible, false, 'bot timeline event hidden in Humans lane');
  assert.equal(humans.composerVisible, true, 'comment composer always visible');
  assert.equal(humans.humanCount, '2');
  assert.equal(humans.botCount, '3');
  assert.equal(humans.note, '3 items hidden');

  await evaluate('document.querySelector(".prlanes-tab[data-lane=\\"bot\\"]").click()');
  const bots = await waitFor(async () => {
    const state = await evaluate(SNAPSHOT);
    return state.active === 'bot' ? state : null;
  }, 5000, 'lane switch to Bots');

  assert.equal(bots.rows['bot-comment'].visible, true, 'bot comment visible in Bots lane');
  assert.equal(bots.rows['bot-review'].visible, true, 'bot review visible in Bots lane');
  assert.equal(bots.rows['human-thread'].visible, false, 'human thread hidden in Bots lane');
  assert.equal(bots.rows['pr-body'].visible, true, 'pull request body stays pinned in Bots lane');
  assert.equal(bots.composerVisible, true, 'comment composer still visible');

  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', altKey: true, bubbles: true }))");
  const all = await waitFor(async () => {
    const state = await evaluate(SNAPSHOT);
    return state.active === 'all' ? state : null;
  }, 5000, 'Alt+3 switch to All');

  assert.ok(Object.values(all.rows).every((row) => row.visible), 'every row visible in All');
  assert.equal(all.note, '');

  await evaluate(`(() => {
    const timeline = document.querySelector('.js-discussion rails-partial');
    const row = document.createElement('div');
    row.className = 'js-timeline-item';
    row.dataset.row = 'late-bot';
    row.innerHTML = '<div class="TimelineItem"><div class="timeline-comment"><div class="timeline-comment-header"><a class="author" href="/codecov">codecov</a></div><div class="comment-body">Coverage dropped.</div></div></div>';
    timeline.appendChild(row);
  })()`);

  await evaluate('document.querySelector(".prlanes-tab[data-lane=\\"human\\"]").click()');
  const late = await waitFor(async () => {
    const state = await evaluate(SNAPSHOT);
    return state.rows['late-bot'] && state.rows['late-bot'].kind === 'bot' ? state : null;
  }, 5000, 'lazily loaded bot comment to be classified');

  assert.equal(late.rows['late-bot'].visible, false, 'lazily loaded bot comment hidden in Humans lane');
  assert.equal(late.botCount, '4', 'counts include lazily loaded rows');

  await evaluate(`(() => {
    window.__mutations = 0;
    const observer = new MutationObserver((records) => { window.__mutations += records.length; });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    window.__stopCounting = () => observer.disconnect();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const idleMutations = await evaluate('(() => { window.__stopCounting(); return window.__mutations; })()');
  assert.equal(idleMutations, 0, `extension is idle when nothing changes (saw ${idleMutations} mutations)`);

  console.log('e2e: bar injected, rows classified, three lanes filter, keyboard switch, lazy rows handled, idle after settling');
} catch (error) {
  failure = error;
} finally {
  chrome.kill('SIGKILL');
  server.close();
  await rm(workdir, { recursive: true, force: true });
}

if (failure) {
  console.error(`e2e failed: ${failure.message}`);
  process.exit(1);
}
