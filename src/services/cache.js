import {canonicalUrl} from '../key.js';

const memoryStorage = () => {
  const map = new Map();
  return {
    get: key => map.get(key),
    set: (key, entry) => void map.set(key, entry),
    delete: key => void map.delete(key),
    clear: () => void map.clear(),
    keys: () => [...map.keys()]
  };
};

const toEntry = async (response, ttl) => ({
  status: response.status,
  statusText: response.statusText,
  headers: [...response.headers],
  body: await response.arrayBuffer(),
  etag: response.headers.get('etag') || undefined,
  lastModified: response.headers.get('last-modified') || undefined,
  expiresAt: ttl === Infinity ? Infinity : Date.now() + ttl
});

const toResponse = entry =>
  new Response(entry.body, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers
  });

export const installCache = io => {
  const storage = memoryStorage();

  const ttlFor = options => {
    const c = options.cache;
    return c && typeof c === 'object' && typeof c.ttl === 'number' ? c.ttl : io.cache.defaultTtl;
  };

  const optIn = options => {
    if (options.stream || !options.cache) return false;
    return (options.method || 'GET').toUpperCase() === 'GET';
  };

  const handle = async (request, ctx, next) => {
    if (!optIn(ctx.options)) return null;
    const key = ctx.key;
    const entry = await io.cache.storage.get(key);
    if (entry && entry.expiresAt > Date.now()) return toResponse(entry);
    if (entry && entry.etag) request.headers.set('If-None-Match', entry.etag);
    else if (entry && entry.lastModified)
      request.headers.set('If-Modified-Since', entry.lastModified);
    const response = await next();
    if (entry && response.status === 304) {
      const ttl = ttlFor(ctx.options);
      entry.expiresAt = ttl === Infinity ? Infinity : Date.now() + ttl;
      await io.cache.storage.set(key, entry);
      return toResponse(entry);
    }
    if (response.ok) {
      const stored = await toEntry(response, ttlFor(ctx.options));
      await io.cache.storage.set(key, stored);
      return toResponse(stored);
    }
    return response;
  };

  const service = {name: 'cache', priority: 50, handle};

  const keyOf = target => io.makeKey(typeof target === 'string' ? {url: target} : target);

  const evictBy = async match => {
    for (const key of await io.cache.storage.keys())
      if (match(key)) await io.cache.storage.delete(key);
  };

  io.cache = {
    storage,
    defaultTtl: 5 * 60 * 1000,
    isActive: false,
    optIn,
    attach: () => {
      io.attach(service);
      io.cache.isActive = true;
      return io;
    },
    detach: () => {
      io.detach('cache');
      io.cache.isActive = false;
      return io;
    },
    remove: async target => {
      if (typeof target === 'function') await evictBy(target);
      else if (target instanceof RegExp) await evictBy(key => target.test(key));
      else {
        const text = String(target);
        if (text.endsWith('*')) {
          const prefix = 'GET ' + canonicalUrl(text.slice(0, -1));
          await evictBy(key => key.startsWith(prefix));
        } else {
          await io.cache.storage.delete(io.makeKey({url: text}));
        }
      }
      return io;
    },
    clear: async () => {
      await io.cache.storage.clear();
      return io;
    },
    sweep: async () => {
      const cutoff = Date.now();
      for (const key of await io.cache.storage.keys()) {
        const entry = await io.cache.storage.get(key);
        if (entry && entry.expiresAt <= cutoff) await io.cache.storage.delete(key);
      }
      return io;
    },
    save: async (target, response, ttl) => {
      const entry = await toEntry(response, ttl == null ? io.cache.defaultTtl : ttl);
      await io.cache.storage.set(keyOf(target), entry);
      return io;
    }
  };

  return io.cache;
};
