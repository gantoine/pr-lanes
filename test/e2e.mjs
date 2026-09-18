import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.E2E_PORT || 8745);
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT || 9322);
const PAGE_PATH = '/PostHog/posthog/pull/30000/';
const STUB = 'test/extension-stub.js';

const TYPES = { '.js': 'text/javascript', '.css': 'text/css' };

async function contentScripts() {
  const manifest = JSON.parse(await readFile(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  const [entry] = manifest.content_scripts;
  return [STUB, ...entry.js.map((file) => `extension/${file}`), ...entry.css.map((file) => `extension/${file}`)];
}

async function buildPage(assets) {
  const html = await readFile(path.join(root, 'test', 'e2e-page.html'), 'utf8');
  const tags = assets.map((asset) =>
    asset.endsWith('.css')
      ? `<link rel="stylesheet" href="/${asset}" />`
      : `<script src="/${asset}"></script>`
  );
  return html.replace('</body>', tags.join('') + '</body>');
}

async function startServer(assets, page) {
  const server = createServer(async (request, response) => {
    const asset = new URL(request.url, 'http://localhost').pathname.slice(1);
    if (assets.includes(asset)) {
      response.writeHead(200, { 'content-type': TYPES[path.extname(asset)] });
      response.end(await readFile(path.join(root, asset)));
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
      actor: row.dataset.prlanesActor,
      form: row.dataset.prlanesForm,
      pinned: row.dataset.prlanesPin === '1',
      visible: getComputedStyle(row).display !== 'none'
    };
  }
  const bar = document.querySelector('.prlanes-bar');
  if (!bar) return { rows, hasBar: false };
  return {
    rows,
    hasBar: true,
    active: bar.querySelector('.prlanes-tab--active').dataset.lane,
    humanDotOn: bar.querySelector('.prlanes-dot--human').classList.contains('prlanes-dot--on'),
    botDotOn: bar.querySelector('.prlanes-dot--bot').classList.contains('prlanes-dot--on'),
    gearIcon: Boolean(bar.querySelector('.prlanes-settings .prlanes-gear')),
    barText: bar.textContent.trim(),
    barBeforeTimeline: bar.nextElementSibling === document.querySelector('.js-discussion'),
    slot: bar.classList.contains('prlanes-bar--tabs') ? 'tabs' : (bar.classList.contains('prlanes-bar--header') ? 'header' : 'timeline'),
    slotParent: String(bar.parentElement.className)
  };
})()`;

const assets = await contentScripts();
const page = await buildPage(assets);

if (process.argv.includes('--serve')) {
  await startServer(assets, page);
  console.log(`serving the extension against the test timeline at http://localhost:${PORT}${PAGE_PATH}`);
} else {
  const workdir = await mkdtemp(path.join(tmpdir(), 'prlanes-e2e-'));
  const server = await startServer(assets, page);
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
      if (result.exceptionDetails) {
        const details = result.exceptionDetails;
        throw new Error(`${details.text}: ${(details.exception && (details.exception.description || details.exception.value)) || expression.slice(0, 80)}`);
      }
      return result.result.value;
    };

    const clickLane = (name) => evaluate(`document.querySelector('.prlanes-tab[data-lane="${name}"]').click()`);

    await waitFor(() => evaluate('Boolean(document.querySelector(".prlanes-bar"))'), 15000, 'lane bar injection');

    const humans = await evaluate(SNAPSHOT);

    assert.equal(humans.active, 'human', 'default lane is Humans');
    assert.equal(humans.slot, 'tabs', 'lane bar sits in the tab row at rest');
    assert.match(humans.slotParent, /TabNavList/, 'lane bar sits next to the tabs themselves');

    assert.deepEqual(humans.rows['pr-body'], { actor: 'human', form: 'comment', pinned: true, visible: true });
    assert.deepEqual(humans.rows['bot-comment'], { actor: 'bot', form: 'comment', pinned: false, visible: false });
    assert.deepEqual(humans.rows['avatar-bot'], { actor: 'bot', form: 'comment', pinned: false, visible: false });
    assert.deepEqual(humans.rows['spoof-comment'], { actor: 'human', form: 'comment', pinned: false, visible: true });
    assert.deepEqual(humans.rows['bot-review'], { actor: 'bot', form: 'comment', pinned: false, visible: false });
    assert.deepEqual(humans.rows['human-thread'], { actor: 'human', form: 'comment', pinned: false, visible: true });
    assert.deepEqual(humans.rows['human-event'], { actor: 'human', form: 'event', pinned: false, visible: true });
    assert.deepEqual(humans.rows['bot-event'], { actor: 'bot', form: 'event', pinned: false, visible: false });
    assert.deepEqual(humans.rows['composer'], { actor: 'none', form: 'chrome', pinned: false, visible: true });
    assert.deepEqual(humans.rows['resolved-thread-review'], { actor: 'bot', form: 'comment', pinned: false, visible: false });
    assert.deepEqual(humans.rows['ai-review'], { actor: 'bot', form: 'comment', pinned: false, visible: false });
    assert.deepEqual(humans.rows['human-event-with-bot'], { actor: 'human', form: 'event', pinned: false, visible: true });

    assert.equal(humans.humanDotOn, true, 'the human dot lights up when there are human comments');
    assert.equal(humans.botDotOn, true, 'the bot dot lights up when there are bot comments');
    assert.equal(humans.gearIcon, true, 'settings is a gear icon');
    assert.doesNotMatch(humans.barText, /hidden/i, 'the bar carries no hidden-count text');
    assert.equal(humans.barText, 'LanesHumansBotsAll', 'the bar carries no counts');
    assert.deepEqual(humans.rows['reviewer-bot'], { actor: 'bot', form: 'reviewer', pinned: false, visible: false });
    assert.deepEqual(humans.rows['reviewer-human'], { actor: 'human', form: 'reviewer', pinned: false, visible: true });
    assert.deepEqual(humans.rows['reviewer-team'], { actor: 'human', form: 'reviewer', pinned: false, visible: true });

    await clickLane('bot');
    const bots = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.active === 'bot' ? state : null;
    }, 5000, 'lane switch to Bots');

    assert.equal(bots.rows['bot-comment'].visible, true, 'bot comment visible in Bots lane');
    assert.equal(bots.rows['bot-event'].visible, true, 'bot event visible in Bots lane');
    assert.equal(bots.rows['human-thread'].visible, false, 'human thread hidden in Bots lane');
    assert.equal(bots.rows['human-event'].visible, false, 'human event hidden in Bots lane');
    assert.equal(bots.rows['pr-body'].visible, true, 'pull request body stays pinned in Bots lane');
    assert.equal(bots.rows['composer'].visible, true, 'comment composer is never hidden');
    assert.equal(bots.rows['reviewer-bot'].visible, true, 'bot reviewers show in the Bots lane');
    assert.equal(bots.rows['reviewer-human'].visible, false, 'human reviewers hide in the Bots lane');
    assert.equal(bots.rows['ai-review'].visible, true, 'AI-badged review visible in Bots lane');

    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', code: 'Digit3', altKey: true, bubbles: true }))");
    const all = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.active === 'all' ? state : null;
    }, 5000, 'Alt+3 switch to All');

    assert.ok(Object.values(all.rows).every((row) => row.visible), 'every row visible in All');

    await evaluate(`(() => {
      const timeline = document.querySelector('.js-discussion rails-partial');
      const row = document.createElement('div');
      row.className = 'js-timeline-item';
      row.dataset.row = 'late-bot';
      row.innerHTML = '<div class="TimelineItem"><div class="timeline-comment"><div class="timeline-comment-header"><a class="author" href="/codecov">codecov</a></div><div class="comment-body">Coverage dropped.</div></div></div>';
      timeline.appendChild(row);
    })()`);

    await clickLane('human');
    const late = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.rows['late-bot'] && state.rows['late-bot'].actor === 'bot' ? state : null;
    }, 5000, 'lazily loaded bot comment to be classified');

    assert.equal(late.rows['late-bot'].visible, false, 'lazily loaded bot comment hidden in Humans lane');
    assert.equal(late.botDotOn, true, 'the bot dot stays lit for a lazily loaded bot comment');

    const settings = async (values) => {
      await evaluate(`globalThis.prLanesStorage.sync.set(${JSON.stringify(values)})`);
    };

    await settings({ showActivity: false });
    const noEvents = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.rows['human-event'].visible === false ? state : null;
    }, 5000, 'timeline events to hide when "show timeline events" is off');
    assert.equal(noEvents.rows['pr-body'].visible, true, 'comments stay when events are hidden');
    await settings({ showActivity: true });
    await waitFor(async () => (await evaluate(SNAPSHOT)).rows['human-event'].visible, 5000, 'events to come back');

    await settings({ pinPrBody: false });
    const unpinned = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.rows['pr-body'].pinned === false ? state : null;
    }, 5000, 'the description to stop being pinned');
    await clickLane('bot');
    const unpinnedInBots = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.active === 'bot' ? state : null;
    }, 5000, 'the Bots lane');
    assert.equal(unpinnedInBots.rows['pr-body'].visible, false, 'an unpinned description hides in the Bots lane');
    assert.equal(unpinned.rows['pr-body'].pinned, false);
    await settings({ pinPrBody: true });
    await clickLane('human');
    await waitFor(async () => (await evaluate(SNAPSHOT)).rows['pr-body'].pinned, 5000, 'the description to be pinned again');

    await settings({ showBar: false });
    await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.hasBar === false ? state : null;
    }, 5000, 'the switcher to disappear when turned off');
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', altKey: true, bubbles: true }))");
    const keyboardOnly = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.rows['bot-comment'].visible ? state : null;
    }, 5000, 'Alt+2 to still switch lanes with the switcher hidden');
    assert.equal(keyboardOnly.hasBar, false);
    await settings({ showBar: true });
    const barBack = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.hasBar ? state : null;
    }, 5000, 'the switcher to come back');
    assert.equal(barBack.active, 'bot', 'the keyboard switch survived the switcher being hidden');
    await clickLane('human');
    await waitFor(async () => (await evaluate(SNAPSHOT)).active === 'human', 5000, 'back to the Humans lane');

    await settings({ rememberPerPr: true });
    await clickLane('all');
    const remembered = await waitFor(
      () => evaluate('globalThis.prLanesStorage.local.data["lane:PostHog/posthog#30000"] || null'),
      5000,
      'the lane to be remembered against this pull request'
    );
    assert.equal(remembered, 'all', 'the per-pull-request lane is stored under its own key');
    await settings({ rememberPerPr: false });
    await clickLane('human');
    await waitFor(async () => (await evaluate(SNAPSHOT)).active === 'human', 5000, 'back to the Humans lane');


    await evaluate(`(() => {
      document.querySelector('[data-role="sticky"]').style.display = 'flex';
      window.dispatchEvent(new Event('scroll'));
    })()`);
    const sticky = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.slot === 'header' ? state : null;
    }, 5000, 'lane bar to follow the sticky header');
    assert.match(sticky.slotParent, /TitleArea/, 'lane bar rides the sticky header title row');

    await evaluate(`(() => {
      document.querySelector('[data-role="sticky"]').style.display = 'none';
      window.dispatchEvent(new Event('scroll'));
    })()`);
    const unstuck = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.slot === 'tabs' ? state : null;
    }, 5000, 'lane bar to return to the tab row');
    assert.match(unstuck.slotParent, /TabNavList/);

    await evaluate('document.querySelector(\'[data-role="header"]\').remove()');
    const headerless = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.barBeforeTimeline ? state : null;
    }, 5000, 'lane bar to fall back above the timeline when there is no header');
    assert.equal(headerless.slot, 'timeline', 'the bar falls back to its own row above the timeline');

    await evaluate(`(() => {
      const timeline = document.querySelector('.js-discussion rails-partial');
      const row = document.createElement('div');
      row.className = 'js-timeline-item';
      row.dataset.row = 'late-human';
      row.innerHTML = '<div class="TimelineItem"><div class="timeline-comment"><div class="timeline-comment-header"><a class="author" href="/marius">marius</a></div><div class="comment-body">Landing this now.</div></div></div>';
      timeline.appendChild(row);
    })()`);

    const liveHuman = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.rows['late-human'] && state.rows['late-human'].actor ? state : null;
    }, 5000, 'a comment that arrives live to be classified');
    assert.equal(liveHuman.rows['late-human'].actor, 'human');
    assert.equal(liveHuman.rows['late-human'].visible, true, 'a comment that arrives live shows in the Humans lane');
    assert.equal(liveHuman.humanDotOn, true);

    await evaluate(`(() => {
      for (const row of document.querySelectorAll('[data-row]')) {
        if (row.dataset.prlanesActor === 'human' && row.dataset.prlanesForm === 'comment') row.remove();
      }
    })()`);
    const noHumans = await waitFor(async () => {
      const state = await evaluate(SNAPSHOT);
      return state.humanDotOn === false ? state : null;
    }, 5000, 'the human dot to go dark when the last human comment goes away');
    assert.equal(noHumans.botDotOn, true, 'the bot dot stays lit');

    await evaluate(`(() => {
      window.__mutations = 0;
      window.__mutationLog = [];
      const observer = new MutationObserver((records) => {
        window.__mutations += records.length;
        for (const record of records.slice(0, 4)) {
          const target = record.target.nodeType === 1 ? record.target.tagName.toLowerCase() + '.' + String(record.target.className || '').slice(0, 30) : String(record.target.nodeValue).slice(0, 30);
          window.__mutationLog.push(record.type + ' ' + (record.attributeName || '') + ' on ' + target);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      window.__stopCounting = () => observer.disconnect();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const idle = await evaluate('(() => { window.__stopCounting(); return { count: window.__mutations, log: window.__mutationLog }; })()');
    assert.equal(idle.count, 0, `extension is idle when nothing changes (saw ${idle.count}: ${idle.log.join('; ')})`);

    console.log('e2e: bar injected, rows classified, three lanes filter, keyboard switch, lazy rows handled, idle after settling');
  } catch (error) {
    failure = error;
  } finally {
    chrome.kill('SIGKILL');
    server.close();
    await rm(workdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  }

  if (failure) {
    console.error(`e2e failed: ${failure.message}`);
    process.exit(1);
  }
}
