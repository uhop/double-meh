// @ts-self-types="./code-forward.d.ts"
import {normalizeTarget} from './key.js';

const KEY = '__doubleMeh';

export const installCodeForward = io => {
  const root = globalThis;
  let dm = root[KEY];
  if (!dm && typeof window === 'undefined') return io;
  if (!dm || typeof dm !== 'object') dm = root[KEY] = {};

  const use = fn => fn(io);
  const fly = target => {
    io.track.fly(target);
    return io.makeKey(normalizeTarget(target));
  };
  const arrived = (target, response) => io.adopt(target, response);

  const pending = Array.isArray(dm.arrived) ? dm.arrived : [];
  const inFlight = Array.isArray(dm.inFlight) ? dm.inFlight : [];
  const staged = (Array.isArray(dm.setup) ? dm.setup : []).map(use);
  delete dm.setup;
  delete dm.inFlight;

  // the global stays a small protocol marker: queue arrays pre-load, these three post-load
  dm.use = use;
  dm.fly = fly;
  dm.arrived = arrived;

  const drain = () => {
    inFlight.forEach(fly);
    pending.forEach(entry => arrived(entry[0], entry[1]));
    io.emit('ready');
  };
  // a setup callback that returns a promise — importing a cache backend, say — is waited on before
  // anything is adopted, so the hand-over lands in the store the page asked for. allSettled: a
  // failed setup must not wedge the prefetch it was configuring.
  const waiting = staged.filter(result => result && typeof result.then === 'function');
  if (waiting.length) Promise.allSettled(waiting).then(drain);
  else drain();
  return io;
};
