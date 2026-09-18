(function () {
  function area() {
    const data = {};
    return {
      get(defaults) {
        const keys = defaults && typeof defaults === 'object' ? Object.keys(defaults) : [];
        const result = Object.assign({}, defaults);
        for (const key of keys) {
          if (key in data) result[key] = data[key];
        }
        return Promise.resolve(result);
      },
      set(values) {
        Object.assign(data, values);
        return Promise.resolve();
      }
    };
  }

  globalThis.chrome = {
    runtime: { getURL: (relative) => '/extension/' + relative },
    storage: { local: area(), sync: area(), onChanged: { addListener() {} } }
  };
})();
