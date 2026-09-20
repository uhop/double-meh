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

import {bodyKeyOf, normalizeTarget, safeMethods} from '../key.js';

export const installTrack = io => {
  const deferred = {};

  const flyByKey = key => {
    let entry = deferred[key];
    if (entry && entry.retainUntil !== undefined && Date.now() > entry.retainUntil) {
      delete deferred[key];
      entry = undefined;
    }
    if (!entry) {
      entry = deferred[key] = makeDeferred();
      const cleanup = () => {
        entry.settled = true;
        // a held hand-over outlives its own promise only while nobody has taken it: the
        // response can land before the application loads, and a non-GET has no cache behind
        // it to keep the value
        if (entry.retainUntil !== undefined && !entry.takers) return;
        if (deferred[key] === entry) delete deferred[key];
      };
      entry.promise.then(cleanup, cleanup);
    }
    return entry;
  };

  const keyOf = options => io.makeKey(normalizeTarget(options));

  // the cache is the durable copy wherever it will take the entry, and a second store in front
  // of it would shadow its expiry; hold exactly what it will not keep — every non-GET, and a GET
  // whose cache is detached or declines it
  const cacheKeeps = target => !!io.cache && io.cache.isActive && io.cache.optIn(target);
  const hold = (entry, target) => {
    if (!cacheKeeps(target)) entry.retainUntil = Date.now() + io.track.retainMs;
  };

  // GET-only by design: sharing one decoded envelope is only sound for safe reads
  const optIn = options => {
    if (options.stream) return false;
    // the envelope is decoded once, with the leader's decode — a custom decode must not be shared
    if (options.decode !== undefined) return false;
    const method = (options.method || 'GET').toUpperCase();
    if (!safeMethods[method]) return false;
    // a safe method that carries its criteria in the body is identified by that body; with no
    // usable key it must not share a bodyless one, so it opts out instead
    if (method !== 'GET' && bodyKeyOf(options) === undefined) return false;
    if (options.track !== undefined) return !!options.track;
    const d = io.track.theDefault;
    return typeof d === 'function' ? !!d(options) : !!d;
  };

  io.track = {
    active: true,
    retainMs: 60000,
    theDefault: options => !options.transport,
    deferred,
    flyByKey,
    fly: options => {
      const target = normalizeTarget(options);
      const entry = flyByKey(io.makeKey(target));
      entry.flying = true; // the request is already under way elsewhere: adopt will fulfill it
      hold(entry, target);
      return entry;
    },
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
    const options = normalizeTarget(target);
    const entry = flyByKey(io.makeKey(options));
    entry.flying = true; // adopt fulfills the deferred; a real request must not also fire
    hold(entry, options);
    const work = Promise.resolve(source)
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
    // idle() tracks writes that have begun; the save below has not, so register the whole chain
    if (io.cache && typeof io.cache.watch === 'function') io.cache.watch(work);
    return entry.promise;
  };

  return io.track;
};
