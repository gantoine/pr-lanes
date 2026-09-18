(function () {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  const lanes = globalThis.PRLanes;
  if (!api || !lanes) return;

  const LANES = ['human', 'bot', 'all'];

  const DEFAULTS = {
    defaultLane: 'human',
    rememberPerPr: false,
    activityLane: 'both',
    extraBots: '',
    forceHumans: '',
    heuristics: true,
    pinPrBody: true,
    showBar: true
  };

  let settings = Object.assign({}, DEFAULTS);
  let rules = lanes.buildRules(settings);
  let rulesRevision = 1;
  let lane = DEFAULTS.defaultLane;
  let bar = null;
  let scanHandle = 0;
  let lastUrl = location.href;

  const sync = api.storage.sync || api.storage.local;
  const local = api.storage.local || api.storage.sync;

  function read(area, defaults) {
    try {
      const result = area.get(defaults);
      if (result && typeof result.then === 'function') return result.catch(() => defaults);
    } catch (error) {
      /* fall through to callback form */
    }
    return new Promise((resolve) => {
      try {
        area.get(defaults, (value) => resolve(value || defaults));
      } catch (error) {
        resolve(defaults);
      }
    });
  }

  function write(area, values) {
    try {
      const result = area.set(values);
      if (result && typeof result.then === 'function') result.catch(() => {});
    } catch (error) {
      try {
        area.set(values, () => {});
      } catch (ignored) {
        /* storage unavailable */
      }
    }
  }

  function isThreadPage() {
    return /^\/[^/]+\/[^/]+\/(pull|issues)\/\d+/.test(location.pathname);
  }

  function threadKey() {
    const match = location.pathname.match(/^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/);
    return match ? `lane:${match[1]}/${match[2]}#${match[4]}` : 'lane:unknown';
  }

  function normalizeLane(value) {
    return LANES.indexOf(value) === -1 ? DEFAULTS.defaultLane : value;
  }

  function activityVisible() {
    if (lane === 'all') return true;
    if (settings.activityLane === 'both') return true;
    if (settings.activityLane === 'none') return false;
    return settings.activityLane === lane;
  }

  function collectTargets() {
    const targets = [];

    const timeline = lanes.findTimelineRoot(document);
    if (timeline) {
      targets.push({ root: timeline, rows: lanes.timelineRows(timeline), pinFirstComment: settings.pinPrBody });
    }

    const files = lanes.findFilesRoot(document);
    if (files) {
      targets.push({ root: files, rows: lanes.threadRows(files), pinFirstComment: false });
    }

    return targets;
  }

  function classifyRows(target) {
    const counts = { human: 0, bot: 0, activity: 0 };
    let pinnedFirstComment = false;

    for (const row of target.rows) {
      if (row.dataset.prlanesRev !== String(rulesRevision)) {
        setData(row, 'prlanesKind', lanes.classifyRow(row, rules));
        setData(row, 'prlanesRev', String(rulesRevision));
        if (lanes.isPinned(row)) setData(row, 'prlanesPin', '1');
        else delete row.dataset.prlanesPin;
      }

      const kind = row.dataset.prlanesKind;
      if (counts[kind] !== undefined) counts[kind] += 1;

      if (target.pinFirstComment && !pinnedFirstComment && (kind === 'human' || kind === 'bot')) {
        setData(row, 'prlanesPin', '1');
        pinnedFirstComment = true;
      }
    }

    return counts;
  }

  function setData(element, key, value) {
    if (element.dataset[key] !== value) element.dataset[key] = value;
  }

  function applyLane(target) {
    setData(target.root, 'prlanesLane', lane);
    setData(target.root, 'prlanesActivity', activityVisible() ? 'show' : 'hide');
  }

  function hiddenCount(counts) {
    if (lane === 'all') return 0;
    let hidden = lane === 'human' ? counts.bot : counts.human;
    if (!activityVisible()) hidden += counts.activity;
    return hidden;
  }

  function buildBar() {
    const element = document.createElement('div');
    element.className = 'prlanes-bar';
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', 'Conversation lanes');
    element.innerHTML = [
      '<span class="prlanes-brand">Lanes</span>',
      '<div class="prlanes-tabs">',
      '<button type="button" class="prlanes-tab" data-lane="human"><span class="prlanes-dot prlanes-dot--human"></span>Humans<span class="prlanes-count" data-count="human">0</span></button>',
      '<button type="button" class="prlanes-tab" data-lane="bot"><span class="prlanes-dot prlanes-dot--bot"></span>Bots<span class="prlanes-count" data-count="bot">0</span></button>',
      '<button type="button" class="prlanes-tab" data-lane="all">All</button>',
      '</div>',
      '<span class="prlanes-note" data-note></span>',
      '<a class="prlanes-settings" target="_blank" rel="noreferrer">Settings</a>'
    ].join('');

    element.addEventListener('click', (event) => {
      const button = event.target.closest('.prlanes-tab');
      if (!button) return;
      event.preventDefault();
      setLane(button.dataset.lane);
    });

    const settingsLink = element.querySelector('.prlanes-settings');
    try {
      settingsLink.href = api.runtime.getURL('options/options.html');
    } catch (error) {
      settingsLink.remove();
    }

    return element;
  }

  function placeBar(target) {
    if (!settings.showBar) {
      if (bar && bar.isConnected) bar.remove();
      return;
    }
    const parent = target.root.parentElement;
    if (!parent) return;
    if (!bar) bar = buildBar();
    if (bar.parentElement !== parent || bar.nextElementSibling !== target.root) {
      parent.insertBefore(bar, target.root);
    }
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function updateBar(counts) {
    if (!bar || !bar.isConnected) return;

    for (const button of bar.querySelectorAll('.prlanes-tab')) {
      const active = button.dataset.lane === lane;
      if (button.classList.contains('prlanes-tab--active') !== active) {
        button.classList.toggle('prlanes-tab--active', active);
      }
      if (button.getAttribute('aria-pressed') !== String(active)) {
        button.setAttribute('aria-pressed', String(active));
      }
    }

    setText(bar.querySelector('[data-count="human"]'), String(counts.human));
    setText(bar.querySelector('[data-count="bot"]'), String(counts.bot));

    const hidden = hiddenCount(counts);
    setText(bar.querySelector('[data-note]'), hidden ? `${hidden} item${hidden === 1 ? '' : 's'} hidden` : '');
  }

  function scan() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      loadLane().then((value) => {
        if (value === lane) return;
        lane = value;
        scan();
      });
    }

    if (!isThreadPage()) {
      if (bar && bar.isConnected) bar.remove();
      return;
    }

    const targets = collectTargets();
    if (!targets.length) return;

    const totals = { human: 0, bot: 0, activity: 0 };
    for (const target of targets) {
      const counts = classifyRows(target);
      totals.human += counts.human;
      totals.bot += counts.bot;
      totals.activity += counts.activity;
      applyLane(target);
    }

    placeBar(targets[0]);
    updateBar(totals);
  }

  function queueScan() {
    if (scanHandle) return;
    scanHandle = setTimeout(() => {
      scanHandle = 0;
      scan();
    }, 100);
  }

  function setLane(next) {
    const value = normalizeLane(next);
    if (value === lane) return;
    lane = value;
    if (settings.rememberPerPr) write(local, { [threadKey()]: lane });
    else write(local, { lane });
    scan();
  }

  function invalidateRules() {
    rules = lanes.buildRules(settings);
    rulesRevision += 1;
  }

  function onKeydown(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const active = document.activeElement;
    if (active && (active.isContentEditable || /^(input|textarea|select)$/i.test(active.tagName))) return;

    if (event.code === 'Digit1') setLane('human');
    else if (event.code === 'Digit2') setLane('bot');
    else if (event.code === 'Digit3') setLane('all');
    else if (event.code === 'KeyL') setLane(LANES[(LANES.indexOf(lane) + 1) % LANES.length]);
    else return;

    event.preventDefault();
  }

  async function loadLane() {
    if (settings.rememberPerPr) {
      const key = threadKey();
      const stored = await read(local, { [key]: settings.defaultLane });
      return normalizeLane(stored[key]);
    }
    const stored = await read(local, { lane: settings.defaultLane });
    return normalizeLane(stored.lane);
  }

  async function start() {
    settings = Object.assign({}, DEFAULTS, await read(sync, DEFAULTS));
    invalidateRules();
    lane = await loadLane();

    scan();

    const observer = new MutationObserver((mutations) => {
      if (bar && mutations.every((mutation) => bar.contains(mutation.target))) return;
      queueScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    for (const event of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate', 'pageshow']) {
      window.addEventListener(event, () => {
        lastUrl = location.href;
        loadLane().then((value) => {
          lane = value;
          scan();
        });
      });
    }

    document.addEventListener('keydown', onKeydown, true);

    if (api.storage.onChanged) {
      api.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.lane && !settings.rememberPerPr) {
          lane = normalizeLane(changes.lane.newValue);
          scan();
          return;
        }
        if (area !== 'sync' && area !== 'local') return;
        const relevant = Object.keys(DEFAULTS).some((key) => key in changes);
        if (!relevant) return;
        read(sync, DEFAULTS).then((next) => {
          settings = Object.assign({}, DEFAULTS, next);
          invalidateRules();
          scan();
        });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
