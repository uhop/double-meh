// @ts-self-types="./cache.d.ts"
import {canonicalUrl} from '../key.js';
import {memoryStorage} from '../storage/memory.js';

// null = Vary: * (uncacheable); undefined = no Vary; else the selecting request-header snapshot
const varyOf = (response, requestHeaders) => {
  const vary = response.headers.get('vary');
  if (!vary) return undefined;
  const fields = {};
  for (const part of vary.split(',')) {
    const name = part.trim().toLowerCase();
    if (!name) continue;
    if (name === '*') return null;
    fields[name] = (requestHeaders && requestHeaders.get(name)) ?? null;
  }
  return fields;
};

const varyMatches = (entry, requestHeaders) => {
  if (!entry.vary) return true;
  for (const [name, value] of Object.entries(entry.vary)) {
    if (((requestHeaders && requestHeaders.get(name)) ?? null) !== value) return false;
  }
  return true;
};

const toEntry = async (response, ttl, requestHeaders) => ({
  status: response.status,
  statusText: response.statusText,
  headers: [...response.headers],
  body: await response.arrayBuffer(),
  etag: response.headers.get('etag') || undefined,
  lastModified: response.headers.get('last-modified') || undefined,
  expiresAt: ttl === Infinity ? Infinity : Date.now() + ttl,
  vary: varyOf(response, requestHeaders)
});

const toResponse = entry =>
  new Response(entry.body, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers
  });

export const installCache = io => {
  const storage = memoryStorage();

  const pending = new Set();
  const watch = promise => {
    const settled = promise.then(
      () => void pending.delete(settled),
      () => void pending.delete(settled)
    );
    pending.add(settled);
    return promise;
  };

  const ttlFor = options => {
    const c = options.cache;
    return c && typeof c === 'object' && typeof c.ttl === 'number' ? c.ttl : io.cache.defaultTtl;
  };

  const optIn = options => {
    if (options.stream || options.bust) return false;
    if ((options.method || 'GET').toUpperCase() !== 'GET') return false;
    if (options.cache !== undefined) return !!options.cache;
    const d = io.cache.theDefault;
    return typeof d === 'function' ? !!d(options) : !!d;
  };

  const refresh = (entry, response, ttl) => {
    const headers = new Headers(entry.headers);
    response.headers.forEach((value, key) => {
      if (key !== 'content-length') headers.set(key, value);
    });
    entry.headers = [...headers];
    entry.etag = headers.get('etag') || undefined;
    entry.lastModified = headers.get('last-modified') || undefined;
    entry.expiresAt = ttl === Infinity ? Infinity : Date.now() + ttl;
    return entry;
  };

  const handle = async (request, ctx, next) => {
    if (!optIn(ctx.options)) return null;
    const key = ctx.key;
    let entry = await io.cache.storage.get(key);
    if (entry && !varyMatches(entry, request.headers)) entry = undefined; // another variant: a miss
    if (entry && entry.expiresAt > Date.now()) return toResponse(entry);
    if (entry && entry.etag) request.headers.set('If-None-Match', entry.etag);
    else if (entry && entry.lastModified)
      request.headers.set('If-Modified-Since', entry.lastModified);
    const response = await next();
    if (entry && response.status === 304) {
      await io.cache.storage.set(key, refresh(entry, response, ttlFor(ctx.options)));
      return toResponse(entry);
    }
    if (response.ok) {
      const stored = await toEntry(response, ttlFor(ctx.options), request.headers);
      if (stored.vary !== null) await io.cache.storage.set(key, stored); // Vary: * is uncacheable
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
    theDefault: options => !options.transport,
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
          // an exact URL owns all of its accept variants
          const exact = io.makeKey({url: text});
          await evictBy(key => key === exact || key.startsWith(exact + ' accept='));
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
    save: (target, response, ttl) =>
      watch(
        (async () => {
          const bag = typeof target === 'string' ? {url: target} : target;
          const headers = new Headers(bag.headers || undefined);
          if (bag.accept) headers.set('accept', bag.accept);
          if (!headers.has('accept')) headers.set('accept', 'application/json'); // prepare's default
          const entry = await toEntry(response, ttl == null ? io.cache.defaultTtl : ttl, headers);
          if (entry.vary !== null) await io.cache.storage.set(keyOf(target), entry);
          return io;
        })()
      ),
    idle: async () => {
      while (pending.size) await Promise.all([...pending]);
    }
  };

  return io.cache;
};
