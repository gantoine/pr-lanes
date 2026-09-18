(function () {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  const sync = api.storage.sync || api.storage.local;

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

  const fields = Object.keys(DEFAULTS).map((key) => ({ key, element: document.getElementById(key) }));
  const status = document.getElementById('status');

  function read(defaults) {
    try {
      const result = sync.get(defaults);
      if (result && typeof result.then === 'function') return result.catch(() => defaults);
    } catch (error) {
      /* fall through to callback form */
    }
    return new Promise((resolve) => sync.get(defaults, (value) => resolve(value || defaults)));
  }

  function write(values) {
    try {
      const result = sync.set(values);
      if (result && typeof result.then === 'function') return result;
    } catch (error) {
      /* fall through to callback form */
    }
    return new Promise((resolve) => sync.set(values, resolve));
  }

  function render(values) {
    for (const { key, element } of fields) {
      if (!element) continue;
      if (element.type === 'checkbox') element.checked = Boolean(values[key]);
      else element.value = values[key];
    }
  }

  function collect() {
    const values = {};
    for (const { key, element } of fields) {
      if (!element) continue;
      values[key] = element.type === 'checkbox' ? element.checked : element.value;
    }
    return values;
  }

  function flash(message) {
    status.textContent = message;
    setTimeout(() => {
      status.textContent = '';
    }, 2000);
  }

  document.getElementById('save').addEventListener('click', async () => {
    await write(collect());
    flash('Saved');
  });

  document.getElementById('reset').addEventListener('click', async () => {
    render(DEFAULTS);
    await write(DEFAULTS);
    flash('Reset');
  });

  const known = document.getElementById('defaults');
  if (known && globalThis.PRLanes) known.textContent = globalThis.PRLanes.DEFAULT_BOT_LOGINS.join(', ');

  read(DEFAULTS).then((values) => render(Object.assign({}, DEFAULTS, values)));
})();
