// @ts-self-types="./web-storage.d.ts"
// Web Storage holds strings only, so the entry is JSON with the body base64'd and Infinity as null
const CHUNK = 0x8000; // apply() on the whole array overflows the stack on a large body

const encodeBody = buffer => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

const decodeBody = text => Uint8Array.from(atob(text), c => c.charCodeAt(0)).buffer;

export const webStorage = (options = {}) => {
  const {store = globalThis.sessionStorage, name = 'double-meh'} = options;
  const prefix = name + ':';

  // snapshot before removing: store.removeItem during an index walk shifts every later index
  const own = () => {
    const keys = [];
    for (let i = 0; i < store.length; ++i) {
      const key = store.key(i);
      if (key !== null && key.startsWith(prefix)) keys.push(key);
    }
    return keys;
  };

  return {
    get: key => {
      const text = store.getItem(prefix + key);
      if (text == null) return undefined;
      let record;
      try {
        record = JSON.parse(text);
      } catch {
        return undefined; // corrupt or foreign → a miss
      }
      if (!record || record.v !== 1 || record.enc !== 'base64') return undefined;
      return {
        status: record.status,
        statusText: record.statusText,
        headers: record.headers,
        etag: record.etag ?? undefined,
        lastModified: record.lastModified ?? undefined,
        // JSON has no Infinity: null marks "never expires"
        expiresAt: record.expiresAt == null ? Infinity : record.expiresAt,
        vary: record.vary,
        body: decodeBody(record.body)
      };
    },
    set: (key, entry) => {
      store.setItem(
        prefix + key,
        JSON.stringify({
          v: 1,
          enc: 'base64',
          status: entry.status,
          statusText: entry.statusText,
          headers: entry.headers,
          etag: entry.etag,
          lastModified: entry.lastModified,
          expiresAt: entry.expiresAt === Infinity ? null : entry.expiresAt,
          vary: entry.vary,
          body: encodeBody(entry.body)
        })
      );
    },
    delete: key => void store.removeItem(prefix + key),
    clear: () => {
      for (const key of own()) store.removeItem(key);
    },
    keys: () => own().map(key => key.slice(prefix.length))
  };
};
