// @ts-self-types="./auto.d.ts"
// a leading tab cannot collide with a real cache key, which is always "<METHOD> <url>"
const PROBE = '\tauto-storage probe';

const probeEntry = () => ({
  status: 200,
  statusText: 'OK',
  headers: [],
  body: new ArrayBuffer(8),
  expiresAt: 0 // already expired: a concurrent sweep would drop it anyway
});

// presence is not availability — Safari's private mode throws on a localStorage that is right there,
// and Deno ships a Cache API with no keys(), which sweep and remove need
const works = async storage => {
  try {
    await storage.set(PROBE, probeEntry());
    const got = await storage.get(PROBE);
    await storage.keys();
    await storage.delete(PROBE);
    return !!got && got.body.byteLength === 8;
  } catch {
    try {
      await storage.delete(PROBE);
    } catch {}
    return false;
  }
};

export const autoStorage = (candidates, options = {}) => {
  const {onPick} = options;
  let resolved;

  const pick = async () => {
    for (let i = 0; i < candidates.length; ++i) {
      let storage;
      try {
        storage = await candidates[i]();
      } catch {
        continue; // the factory itself is unusable here
      }
      if (!storage || !(await works(storage))) continue;
      if (onPick) onPick(storage, i);
      return storage;
    }
    throw new Error(
      'io.autoStorage: no candidate worked — end the list with memoryStorage to guarantee one does'
    );
  };

  const resolve = () => (resolved ||= pick());

  return {
    get: async key => (await resolve()).get(key),
    set: async (key, entry) => (await resolve()).set(key, entry),
    delete: async key => (await resolve()).delete(key),
    clear: async () => (await resolve()).clear(),
    keys: async () => (await resolve()).keys(),
    /** The backend that won the ladder, chosen on first use. */
    chosen: () => resolve()
  };
};
