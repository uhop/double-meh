// @ts-self-types="./track.d.ts"
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

  // GET-only by design: sharing one decoded envelope is only sound for safe reads
  const optIn = options => {
    if (options.stream) return false;
    // the envelope is decoded once, with the leader's decode — a custom decode must not be shared
    if (options.decode !== undefined) return false;
    if ((options.method || 'GET').toUpperCase() !== 'GET') return false;
    if (options.track !== undefined) return !!options.track;
    const d = io.track.theDefault;
    return typeof d === 'function' ? !!d(options) : !!d;
  };

  io.track = {
    active: true,
    theDefault: options => !options.transport,
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
    entry.flying = true; // adopt fulfills the deferred; a real request must not also fire
    Promise.resolve(source)
      .then(async response => {
        if (io.cache && io.cache.isActive && io.cache.optIn(options)) {
          // Deno's clone() drops synthesized headers: rebuild the copy from the original's metadata
          const copy = new Response(response.clone().body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
          // decoupled: waiters get the envelope now; io.cache.idle() awaits the backend write
          io.cache.save(options, copy).catch(() => {});
        }
        entry.resolve(await io.toEnvelope(response, options));
      })
      .catch(entry.reject);
    return entry.promise;
  };

  return io.track;
};
