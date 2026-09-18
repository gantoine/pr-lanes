(function () {
  const listeners = [];

  function area(name) {
    const data = {};
    return {
      data,
      get(defaults) {
        const keys = defaults && typeof defaults === 'object' ? Object.keys(defaults) : [];
        const result = Object.assign({}, defaults);
        for (const key of keys) {
          if (key in data) result[key] = data[key];
        }
        return Promise.resolve(result);
      },
      set(values) {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          changes[key] = { oldValue: data[key], newValue: value };
          data[key] = value;
        }
        for (const listener of listeners) listener(changes, name);
        return Promise.resolve();
      }
    };
  }

  const sync = area('sync');
  const local = area('local');

  globalThis.chrome = {
    runtime: { getURL: (relative) => '/extension/' + relative },
    storage: { local, sync, onChanged: { addListener: (listener) => listeners.push(listener) } }
  };

  globalThis.prLanesStorage = { sync, local };
})();
