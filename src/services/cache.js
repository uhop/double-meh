// @ts-self-types="./cache.d.ts"
import {CacheFull, nullBodyStatus} from '../envelope.js';
import {bodyKeyOf, canonicalUrl, safeMethods} from '../key.js';
import {autoStorage} from '../storage/auto.js';
import {defaultCandidates} from '../storage/candidates.js';
// static, unlike the ladder's rungs: the volatile tier has to exist the moment the cache does
import {memoryStorage} from '../storage/memory.js';

// null = Vary: * (uncacheable); undefined = no Vary; else the selecting request-header snapshot
// Positive freshness only. `max-age=900` or an `Expires` in the future is the server stating a
// fact about its own schedule -- a nightly total really does expire at midnight. `no-cache`,
// `must-revalidate` and `max-age=0` say the opposite: not "it is good until X" but "I have no
// idea", which is the absence of knowledge rather than a schedule, and the application's TTL is
// a better answer than a shrug. `s-maxage` is for shared caches, so a page cache ignores it.
const NEGATIVE = /(?:^|,)\s*(?:no-cache|no-store|must-revalidate|proxy-revalidate)\s*(?:,|$)/i;
const MAX_AGE = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i;
// `no-store` is the one directive worth honouring, and not as written: confidentiality is policy
// and procedure, and the response is on the screen either way. What it can mean here is narrower
// and real -- do not write this to disk -- so such an entry goes to a volatile tier instead of
// the configured backend, and dies with the page.
const NO_STORE = /(?:^|,)\s*no-store\s*(?:,|$)/i;

const freshnessOf = response => {
  const control = response.headers.get('cache-control');
  if (control) {
    if (NEGATIVE.test(control)) return undefined;
    const found = MAX_AGE.exec(control);
    if (found) {
      const seconds = Number(found[1]);
      return seconds > 0 ? seconds * 1000 : undefined;
    }
  }
  const expires = response.headers.get('expires');
  if (!expires) return undefined;
  const at = Date.parse(expires);
  if (Number.isNaN(at)) return undefined;
  const ms = at - Date.now();
  return ms > 0 ? ms : undefined;
};

const varyOf = (response, requestHeaders, useVary) => {
  if (!useVary) return undefined;
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

const toEntry = async (response, ttl, requestHeaders, useVary) => ({
  status: response.status,
  statusText: response.statusText,
  headers: [...response.headers],
  body: await response.arrayBuffer(),
  etag: response.headers.get('etag') || undefined,
  lastModified: response.headers.get('last-modified') || undefined,
  expiresAt: ttl === Infinity ? Infinity : Date.now() + ttl,
  vary: varyOf(response, requestHeaders, useVary)
});

const toResponse = entry =>
  new Response(nullBodyStatus[entry.status] ? null : entry.body, {
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
  // lazy, so a page that never caches never probes; the choice is reported both ways, because an
  // application expecting persistence that silently lands on memory has a cold cache and no other
  // symptom. io.cache.backend answers after the fact; the event needs a listener registered before
  // the first cached request, which a code-forward setup callback is early enough for.
  const storage = autoStorage(defaultCandidates, {
    onPick: (chosen, index) => {
      const backend = defaultCandidates[index].name || String(index);
      io.cache.backend = backend;
      io.emit('cache-backend', {backend, index, storage: chosen});
    }
  });

  // always memory, whatever io.cache.storage is set to
  const volatileTier = memoryStorage();

  const tiers = () =>
    io.cache.volatile === io.cache.storage
      ? [io.cache.storage]
      : [io.cache.volatile, io.cache.storage];

  const readAcross = async key => {
    for (const tier of tiers()) {
      const found = await tier.get(key);
      if (found) return {entry: found, tier};
    }
    return {entry: undefined, tier: io.cache.storage};
  };

  const pending = new Set();
  const watch = promise => {
    const settled = promise.then(
      () => void pending.delete(settled),
      () => void pending.delete(settled)
    );
    pending.add(settled);
    return promise;
  };

  // a per-call cache bag overrides the service-wide setting for the same name
  const setting = (options, name) => {
    const c = options.cache;
    const own = c && typeof c === 'object' ? c[name] : undefined;
    return own === undefined ? io.cache[name] : own;
  };

  // the application's decision beats the server's knowledge beats the application's guess
  const ttlFor = (options, response) => {
    const c = options.cache;
    if (c && typeof c === 'object' && typeof c.ttl === 'number') return c.ttl;
    if (response && setting(options, 'fromHeaders')) {
      const served = freshnessOf(response);
      if (served !== undefined) return served;
    }
    return io.cache.defaultTtl;
  };

  const optIn = options => {
    if (options.stream || options.bust) return false;
    const method = (options.method || 'GET').toUpperCase();
    if (!safeMethods[method]) return false;
    // a safe method that carries its criteria in the body is identified by that body; with no
    // usable key it must not share a bodyless one, so it opts out instead
    if (method !== 'GET' && bodyKeyOf(options) === undefined) return false;
    if (options.cache !== undefined) return !!options.cache;
    const d = io.cache.theDefault;
    return typeof d === 'function' ? !!d(options) : !!d;
  };

  const tierFor = response =>
    NO_STORE.test(response.headers.get('cache-control') || '')
      ? io.cache.volatile
      : io.cache.storage;

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

  // every loop below finishes what it started: a failing entry is collected, never a reason to stop
  const sweepExpired = async (target = io.cache.storage) => {
    const cutoff = Date.now();
    const failures = [];
    let removed = 0;
    for (const key of await target.keys()) {
      try {
        const entry = await target.get(key);
        if (entry && entry.expiresAt <= cutoff) {
          await target.delete(key);
          ++removed;
        }
      } catch (error) {
        failures.push(error);
      }
    }
    return {removed, failures};
  };

  // nearest-to-expiry first: a TTL cache knows when an entry dies, never when it was last read
  const evictSoonest = async (needed, target = io.cache.storage) => {
    const all = [];
    for (const key of await target.keys()) {
      const entry = await target.get(key);
      if (entry) all.push({key, expiresAt: entry.expiresAt, bytes: entry.body.byteLength});
    }
    all.sort((a, b) => a.expiresAt - b.expiresAt);
    const failures = [];
    let freed = 0,
      removed = 0;
    for (const item of all) {
      if (freed >= needed) break;
      try {
        await target.delete(item.key);
        freed += item.bytes;
        ++removed;
      } catch (error) {
        failures.push(error);
      }
    }
    return {removed, failures};
  };

  const report = async (key, bytes, reason, error, extra) => {
    const {quota, usage} = (await estimate()) || {};
    io.emit('cache-skip', {key, bytes, reason, quota, usage, error, ...extra});
  };

  const refuse = async (key, bytes, reason, error, extra) => {
    await report(key, bytes, reason, error, extra);
    throw new CacheFull(key, reason, undefined, error ? {cause: error} : undefined);
  };

  // a backend that failed for some cause of its own is reported, then propagated as itself
  const passThrough = async (key, bytes, error, extra) => {
    await report(key, bytes, 'error', error, extra);
    throw error;
  };

  const store = async (key, entry, target = io.cache.storage) => {
    let bytes = 0;
    try {
      bytes = entry.body.byteLength;
      if (bytes > io.cache.maxEntryBytes) return await refuse(key, bytes, 'too-large');
      return await target.set(key, entry);
    } catch (error) {
      if (error instanceof CacheFull) throw error; // already reported
      if (!isQuota(error)) return passThrough(key, bytes, error);
      let expired = 0,
        evicted = 0,
        partial = 0;
      try {
        ({
          removed: expired,
          failures: {length: partial}
        } = await sweepExpired(target));
        if (expired) {
          try {
            return await target.set(key, entry);
          } catch (again) {
            if (!isQuota(again)) throw again;
          }
        }
        const swept = await evictSoonest(bytes, target);
        evicted = swept.removed;
        partial += swept.failures.length;
        if (evicted) {
          try {
            return await target.set(key, entry);
          } catch (again) {
            if (!isQuota(again)) throw again;
          }
        }
      } catch (during) {
        return passThrough(key, bytes, during, {expired, evicted, partial});
      }
      return refuse(key, bytes, 'quota', error, {expired, evicted, partial});
    }
  };

  // the response is already in the caller's hands, and store() reports every failure on 'cache-skip'
  const storeQuietly = async (key, entry, target) => {
    try {
      await store(key, entry, target);
    } catch {}
  };

  const handle = async (request, ctx, next) => {
    if (!optIn(ctx.options)) return null;
    const key = ctx.key;
    let {entry, tier} = await readAcross(key);
    if (entry && !varyMatches(entry, request.headers)) entry = undefined; // another variant: a miss
    if (entry && entry.expiresAt > Date.now()) return toResponse(entry);
    if (entry && entry.etag) request.headers.set('If-None-Match', entry.etag);
    else if (entry && entry.lastModified)
      request.headers.set('If-Modified-Since', entry.lastModified);
    const response = await next();
    if (entry && response.status === 304) {
      await storeQuietly(key, refresh(entry, response, ttlFor(ctx.options, response)), tier);
      return toResponse(entry);
    }
    if (response.ok) {
      const stored = await toEntry(
        response,
        ttlFor(ctx.options, response),
        request.headers,
        setting(ctx.options, 'vary')
      );
      // Vary: * is uncacheable; no-store is storable but not durably
      if (stored.vary !== null) await storeQuietly(key, stored, tierFor(response));
      return toResponse(stored);
    }
    return response;
  };

  const service = {name: 'cache', priority: 50, handle};

  const keyOf = target => io.makeKey(typeof target === 'string' ? {url: target} : target);

  const matcherFor = target => {
    if (typeof target === 'function') return target;
    if (target instanceof RegExp) return key => target.test(key);
    const text = String(target);
    if (text.endsWith('*')) {
      const prefix = 'GET ' + canonicalUrl(text.slice(0, -1));
      return key => key.startsWith(prefix);
    }
    // an exact URL owns all of its accept variants
    const exact = io.makeKey({url: text});
    return key => key === exact || key.startsWith(exact + ' accept=');
  };

  const evictBy = async match => {
    const failures = [];
    let removed = 0;
    for (const tier of tiers()) {
      for (const key of await tier.keys()) {
        if (!match(key)) continue;
        try {
          await tier.delete(key);
          ++removed;
        } catch (error) {
          failures.push(error);
        }
      }
    }
    return {removed, failures};
  };

  const orThrow = ({failures}, where) => {
    if (failures.length) {
      throw new AggregateError(failures, where + ': ' + failures.length + ' entries failed');
    }
  };

  io.cache = {
    storage,
    /** Which rung of the default ladder won, once one has. */
    backend: undefined,
    defaultTtl: 5 * 60 * 1000,
    /** Take a TTL from a positive `max-age` or `Expires` when the response carries one. */
    fromHeaders: true,
    /** Let `Vary` decide identity, and `Vary: *` decide cacheability. */
    vary: true,
    /** Where a `no-store` response goes: memory, whatever `storage` is set to. */
    volatile: volatileTier,
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
      orThrow(await evictBy(matcherFor(target)), 'io.cache.remove');
      return io;
    },
    clear: async () => {
      for (const tier of tiers()) await tier.clear();
      return io;
    },
    sweep: async () => {
      const total = {removed: 0, failures: []};
      for (const tier of tiers()) {
        const one = await sweepExpired(tier);
        total.removed += one.removed;
        total.failures.push(...one.failures);
      }
      orThrow(total, 'io.cache.sweep');
      return io;
    },
    save: (target, response, ttl) =>
      watch(
        (async () => {
          const bag = typeof target === 'string' ? {url: target} : target;
          const headers = new Headers(bag.headers || undefined);
          if (bag.accept) headers.set('accept', bag.accept);
          if (!headers.has('accept')) headers.set('accept', 'application/json'); // prepare's default
          const entry = await toEntry(
            response,
            ttl == null ? ttlFor(bag, response) : ttl,
            headers,
            setting(bag, 'vary')
          );
          if (entry.vary !== null) await store(keyOf(target), entry);
          return io;
        })()
      ),
    /**
     * Register a promise with `idle()`. `io.adopt` uses it so that a hand-over whose save has not
     * started yet is still waited for: `idle()` sees only work already begun otherwise.
     */
    watch: promise => watch(promise),
    idle: async () => {
      while (pending.size) await Promise.all([...pending]);
    }
  };

  return io.cache;
};
