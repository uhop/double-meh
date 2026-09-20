// @ts-self-types="./cache.d.ts"
import {CacheFull} from '../envelope.js';
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

// every backend reports a full store differently; code 22 is the legacy DOMException value
const QUOTA_NAMES = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);
const QUOTA_CODES = new Set(['ENOSPC', 'SQLITE_FULL']);
const isQuota = error =>
  !!error && (QUOTA_NAMES.has(error.name) || QUOTA_CODES.has(error.code) || error.code === 22);

const estimate = async () => {
  try {
    return typeof navigator === 'undefined' ? undefined : await navigator.storage?.estimate();
  } catch {
    return undefined;
  }
};

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

  const sweepExpired = async () => {
    const cutoff = Date.now();
    let removed = 0;
    for (const key of await io.cache.storage.keys()) {
      const entry = await io.cache.storage.get(key);
      if (entry && entry.expiresAt <= cutoff) {
        await io.cache.storage.delete(key);
        ++removed;
      }
    }
    return removed;
  };

  // nearest-to-expiry first: a TTL cache knows when an entry dies, never when it was last read
  const evictSoonest = async needed => {
    const all = [];
    for (const key of await io.cache.storage.keys()) {
      const entry = await io.cache.storage.get(key);
      if (entry) all.push({key, expiresAt: entry.expiresAt, bytes: entry.body.byteLength});
    }
    all.sort((a, b) => a.expiresAt - b.expiresAt);
    let freed = 0,
      removed = 0;
    for (const item of all) {
      if (freed >= needed) break;
      await io.cache.storage.delete(item.key);
      freed += item.bytes;
      ++removed;
    }
    return removed;
  };

  const refuse = async (key, bytes, reason, error, extra) => {
    const {quota, usage} = (await estimate()) || {};
    io.emit('cache-skip', {key, bytes, reason, quota, usage, error, ...extra});
    throw new CacheFull(key, reason, undefined, error ? {cause: error} : undefined);
  };

  const store = async (key, entry) => {
    const bytes = entry.body.byteLength;
    if (bytes > io.cache.maxEntryBytes) return refuse(key, bytes, 'too-large');
    try {
      return await io.cache.storage.set(key, entry);
    } catch (error) {
      if (!isQuota(error)) return refuse(key, bytes, 'error', error);
      let expired = 0,
        evicted = 0;
      try {
        expired = await sweepExpired();
        if (expired) {
          try {
            return await io.cache.storage.set(key, entry);
          } catch (again) {
            if (!isQuota(again)) throw again;
          }
        }
        evicted = await evictSoonest(bytes);
        if (evicted) {
          try {
            return await io.cache.storage.set(key, entry);
          } catch (again) {
            if (!isQuota(again)) throw again;
          }
        }
      } catch (during) {
        return refuse(key, bytes, 'error', during, {expired, evicted});
      }
      return refuse(key, bytes, 'quota', error, {expired, evicted});
    }
  };

  // the response is already in the caller's hands: a cache that cannot store it is not their problem
  const storeQuietly = async (key, entry) => {
    try {
      await store(key, entry);
    } catch (error) {
      if (!(error instanceof CacheFull)) throw error;
    }
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
      await storeQuietly(key, refresh(entry, response, ttlFor(ctx.options)));
      return toResponse(entry);
    }
    if (response.ok) {
      const stored = await toEntry(response, ttlFor(ctx.options), request.headers);
      if (stored.vary !== null) await storeQuietly(key, stored); // Vary: * is uncacheable
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
    maxEntryBytes: Infinity,
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
      await sweepExpired();
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
          if (entry.vary !== null) await store(keyOf(target), entry);
          return io;
        })()
      ),
    idle: async () => {
      while (pending.size) await Promise.all([...pending]);
    }
  };

  return io.cache;
};
