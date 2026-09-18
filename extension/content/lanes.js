(function () {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  const lanes = globalThis.PRLanes;
  if (!api || !lanes) return;

  const LANES = ['human', 'bot', 'all'];
  const DEFAULTS = lanes.DEFAULTS;
  const REVISION_KEYS = lanes.CLASSIFICATION_KEYS.concat('pinPrBody');

  const sync = api.storage.sync || api.storage.local;
  const local = api.storage.local || api.storage.sync;

  let settings = Object.assign({}, DEFAULTS);
  let rules;
  let rulesRevision = 1;
  let lane;
  let bar = null;
  let barParts = null;
  let targets = null;
  let scanHandle = 0;
  let lastUrl = location.href;

  const read = (area, defaults) => Promise.resolve().then(() => area.get(defaults)).catch(() => defaults);
  const write = (area, values) => Promise.resolve().then(() => area.set(values)).catch(() => {});

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
    return lane === 'all' || settings.showActivity;
  }

  function isHidden(actor, form, pinned) {
    if (pinned || lane === 'all') return false;
    if (lane === 'human' && actor === 'bot') return true;
    if (lane === 'bot' && actor === 'human') return true;
    return form === 'event' && !activityVisible();
  }

  function collectTargets() {
    if (targets && targets.every((target) => target.root.isConnected)) return targets;

    const found = [];
    const timeline = lanes.findTimelineRoot(document);
    if (timeline) found.push({ root: timeline, rowsOf: lanes.timelineRows });
    const files = lanes.findFilesRoot(document);
    if (files) found.push({ root: files, rowsOf: lanes.threadRows });

    targets = found.length ? found : null;
    return found;
  }

  function setData(element, key, value) {
    if (element.dataset[key] !== value) element.dataset[key] = value;
  }

  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function setAttr(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  function classifyRows(target) {
    const revision = String(rulesRevision);
    const counts = { human: 0, bot: 0, hidden: 0 };

    for (const row of target.rowsOf(target.root)) {
      if (row.dataset.prlanesRev !== revision) {
        const kind = lanes.classifyRow(row, rules);
        setData(row, 'prlanesActor', kind.actor);
        setData(row, 'prlanesForm', kind.form);
        setData(row, 'prlanesRev', revision);
        if (settings.pinPrBody && lanes.isPrBody(row)) setData(row, 'prlanesPin', '1');
        else delete row.dataset.prlanesPin;
      }

      const actor = row.dataset.prlanesActor;
      if (counts[actor] !== undefined) counts[actor] += 1;
      if (isHidden(actor, row.dataset.prlanesForm, row.dataset.prlanesPin === '1')) counts.hidden += 1;
    }

    setData(target.root, 'prlanesLane', lane);
    setData(target.root, 'prlanesActivity', activityVisible() ? 'show' : 'hide');

    return counts;
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

    barParts = {
      tabs: Array.from(element.querySelectorAll('.prlanes-tab')),
      human: element.querySelector('[data-count="human"]'),
      bot: element.querySelector('[data-count="bot"]'),
      note: element.querySelector('[data-note]')
    };

    return element;
  }

  function placeBar(target) {
    if (!settings.showBar) {
      if (bar && bar.isConnected) bar.remove();
      return;
    }
    if (!bar) bar = buildBar();
    if (bar.nextElementSibling !== target.root && target.root.parentElement) {
      target.root.parentElement.insertBefore(bar, target.root);
    }
  }

  function updateBar(counts) {
    if (!bar || !bar.isConnected) return;

    for (const button of barParts.tabs) {
      const active = button.dataset.lane === lane;
      button.classList.toggle('prlanes-tab--active', active);
      setAttr(button, 'aria-pressed', String(active));
    }

    setText(barParts.human, String(counts.human));
    setText(barParts.bot, String(counts.bot));
    setText(barParts.note, counts.hidden ? `${counts.hidden} item${counts.hidden === 1 ? '' : 's'} hidden` : '');
  }

  function scan() {
    if (!isThreadPage()) {
      if (bar && bar.isConnected) bar.remove();
      return;
    }

    const found = collectTargets();
    if (!found.length) return;

    const totals = { human: 0, bot: 0, hidden: 0 };
    for (const target of found) {
      const counts = classifyRows(target);
      totals.human += counts.human;
      totals.bot += counts.bot;
      totals.hidden += counts.hidden;
    }

    placeBar(found[0]);
    updateBar(totals);
  }

  function queueScan() {
    if (location.href !== lastUrl) {
      navigate();
      return;
    }
    if (scanHandle) return;
    scanHandle = setTimeout(() => {
      scanHandle = 0;
      scan();
    }, 100);
  }

  function navigate() {
    lastUrl = location.href;
    targets = null;
    loadLane().then((value) => {
      lane = value;
      scan();
    });
  }

  function setLane(next) {
    const value = normalizeLane(next);
    if (value === lane) return;
    lane = value;
    write(local, settings.rememberPerPr ? { [threadKey()]: lane } : { lane });
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
    const key = settings.rememberPerPr ? threadKey() : 'lane';
    const stored = await read(local, { [key]: settings.defaultLane });
    return normalizeLane(stored[key]);
  }

  async function start() {
    settings = Object.assign({}, DEFAULTS, await read(sync, DEFAULTS));
    invalidateRules();
    lane = await loadLane();

    scan();

    const observer = new MutationObserver((mutations) => {
      if (!isThreadPage()) return;
      if (bar && mutations.every((mutation) => bar.contains(mutation.target))) return;
      queueScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    for (const event of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate', 'pageshow']) {
      window.addEventListener(event, queueScan);
    }

    document.addEventListener('keydown', onKeydown, true);

    if (api.storage.onChanged) {
      api.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          if (!settings.rememberPerPr && changes.lane) {
            lane = normalizeLane(changes.lane.newValue);
            scan();
          }
          return;
        }
        if (area !== 'sync' || !Object.keys(DEFAULTS).some((key) => key in changes)) return;

        read(sync, DEFAULTS).then((next) => {
          settings = Object.assign({}, DEFAULTS, next);
          if (REVISION_KEYS.some((key) => key in changes)) invalidateRules();
          scan();
        });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
