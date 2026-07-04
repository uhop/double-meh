// @ts-self-types="./code-forward.d.ts"
const KEY = '__doubleMeh';

const normalize = target => (typeof target === 'string' ? {url: target} : target);

export const installCodeForward = io => {
  const root = globalThis;
  let dm = root[KEY];
  if (!dm && typeof window === 'undefined') return io;
  if (!dm || typeof dm !== 'object') dm = root[KEY] = {};

  const use = fn => fn(io);
  const fly = target => {
    io.track.fly(target);
    return io.makeKey(normalize(target));
  };
  const arrived = (target, response) => io.adopt(target, response);

  const pending = Array.isArray(dm.arrived) ? dm.arrived : [];
  dm.setup?.forEach(use);
  dm.inFlight?.forEach(fly);
  pending.forEach(entry => arrived(entry[0], entry[1]));
  delete dm.setup;
  delete dm.inFlight;

  // the global stays a small protocol marker: queue arrays pre-load, these three post-load
  dm.use = use;
  dm.fly = fly;
  dm.arrived = arrived;

  io.emit('ready');
  return io;
};
