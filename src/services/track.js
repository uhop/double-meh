const makeDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
};

export const installTrack = io => {
  const deferred = {};

  const flyByKey = key => {
    let entry = deferred[key];
    if (!entry) {
      entry = deferred[key] = makeDeferred();
      const cleanup = () => {
        if (deferred[key] === entry) delete deferred[key];
      };
      entry.promise.then(cleanup, cleanup);
    }
    return entry;
  };

  const keyOf = options => io.makeKey(typeof options === 'string' ? {url: options} : options);

  const optIn = options => {
    if (options.stream) return false;
    if (options.track === false) return false;
    if (options.track === true) return true;
    if (options.transport) return false;
    return (options.method || 'GET').toUpperCase() === 'GET';
  };

  io.track = {
    active: true,
    deferred,
    flyByKey,
    fly: options => flyByKey(keyOf(options)),
    isFlying: options => deferred[keyOf(options)],
    optIn,
    attach: () => {
      io.track.active = true;
      return io;
    },
    detach: () => {
      io.track.active = false;
      return io;
    }
  };

  io.adopt = (target, source) => {
    const options = typeof target === 'string' ? {url: target} : target;
    const entry = flyByKey(io.makeKey(options));
    Promise.resolve(source)
      .then(async response => {
        const method = (options.method || 'GET').toUpperCase();
        if (io.cache && io.cache.isActive && method === 'GET' && options.cache !== false) {
          await io.cache.save(options, response.clone());
        }
        entry.resolve(await io.toEnvelope(response, options));
      })
      .catch(entry.reject);
    return entry.promise;
  };

  return io.track;
};
