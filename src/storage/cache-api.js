// @ts-self-types="./cache-api.d.ts"
// entry metadata rides as synthetic x-io-* headers on the stored Response
const BASE = 'https://io-cache.invalid/';
const EXPIRES = 'x-io-expires-at';
const KEY = 'x-io-key';
const VARY = 'x-io-vary';

const urlOf = key => BASE + encodeURIComponent(key);

export const cacheApiStorage = ({name = 'double-meh'} = {}) => {
  let opened;
  const open = () => (opened ||= caches.open(name));

  return {
    get: async key => {
      const response = await (await open()).match(urlOf(key));
      if (!response) return undefined;
      const expires = response.headers.get(EXPIRES);
      const vary = response.headers.get(VARY);
      const headers = [...response.headers].filter(
        ([header]) => header !== EXPIRES && header !== KEY && header !== VARY
      );
      let varyFields;
      try {
        varyFields = vary == null ? undefined : JSON.parse(vary);
      } catch {
        varyFields = undefined;
      }
      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        etag: response.headers.get('etag') || undefined,
        lastModified: response.headers.get('last-modified') || undefined,
        expiresAt: expires == null || expires === 'infinity' ? Infinity : Number(expires),
        vary: varyFields,
        body: await response.arrayBuffer()
      };
    },
    set: async (key, entry) => {
      const headers = new Headers(entry.headers);
      headers.set(KEY, key);
      headers.set(EXPIRES, entry.expiresAt === Infinity ? 'infinity' : String(entry.expiresAt));
      if (entry.vary) headers.set(VARY, JSON.stringify(entry.vary));
      await (
        await open()
      ).put(
        urlOf(key),
        new Response(entry.body, {
          status: entry.status,
          statusText: entry.statusText,
          headers
        })
      );
    },
    delete: async key => void (await (await open()).delete(urlOf(key))),
    clear: async () => {
      const cache = await open();
      for (const request of await cache.keys()) await cache.delete(request);
    },
    keys: async () => {
      const requests = await (await open()).keys();
      return requests
        .map(request => request.url)
        .filter(url => url.startsWith(BASE))
        .map(url => decodeURIComponent(url.slice(BASE.length)));
    }
  };
};
