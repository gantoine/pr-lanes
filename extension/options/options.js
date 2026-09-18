(function () {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  const sync = api.storage.sync || api.storage.local;
  const DEFAULTS = globalThis.PRLanes.DEFAULTS;

  const fields = Object.keys(DEFAULTS).map((key) => ({ key, element: document.getElementById(key) }));
  const status = document.getElementById('status');

  const read = () => Promise.resolve().then(() => sync.get(DEFAULTS)).catch(() => DEFAULTS);
  const write = (values) => Promise.resolve().then(() => sync.set(values));

  function render(values) {
    for (const { key, element } of fields) {
      if (element.type === 'checkbox') element.checked = Boolean(values[key]);
      else element.value = values[key];
    }
  }

  function collect() {
    const values = {};
    for (const { key, element } of fields) {
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

  document.getElementById('defaults').textContent = globalThis.PRLanes.DEFAULT_BOT_LOGINS.join(', ');

  read().then((values) => render(Object.assign({}, DEFAULTS, values)));
})();
