// @ts-self-types="./bundle.d.ts"

export const REQUEST_MIME = 'application/vnd.double-meh.bundle-request+json';
export const BUNDLE_MIME = 'application/vnd.double-meh.bundle+json';

// the whitelist that rides per part: identity + conditionals; auth/cookies stay on the outer request
const PART_HEADERS = ['accept', 'accept-language', 'if-none-match', 'if-modified-since'];

const matches = (match, url) =>
  match == null ||
  (typeof match === 'string'
    ? url.startsWith(match)
    : match instanceof RegExp
      ? match.test(url)
      : !!match(url));

const decodeBody = part => {
  if (part.body == null) return null;
  if (part.encoding === 'base64')
    return Uint8Array.from(atob(String(part.body)), c => c.charCodeAt(0));
  if (typeof part.body === 'string') return part.body;
  return JSON.stringify(part.body);
};

const toResponse = part => {
  const status = part.status || 200;
  const body = status === 204 || status === 304 ? null : decodeBody(part);
  return new Response(body, {
    status,
    statusText: part.statusText || '',
    headers: part.headers || {}
  });
};

export const installBundle = io => {
  let counter = 0;
  const byId = new Map();
  const pools = new Map();

  const bundlers = [];

  const configFor = bundler => ({
    url: bundler.url,
    waitTime: bundler.waitTime ?? io.bundle.waitTime,
    maxSize: bundler.maxSize ?? io.bundle.maxSize,
    minSize: bundler.minSize ?? io.bundle.minSize,
    maxWait: bundler.maxWait ?? io.bundle.maxWait
  });

  const selectBundler = url => {
    for (const bundler of bundlers) if (matches(bundler.match, url)) return bundler;
    return io.bundle.url ? io.bundle : null;
  };

  const poolOf = (bundler, name) => {
    let named = pools.get(bundler);
    if (!named) pools.set(bundler, (named = new Map()));
    let pool = named.get(name);
    if (!pool) {
      named.set(name, (pool = {bundler, name, waiters: [], timer: null}));
      const cfg = configFor(bundler);
      // a named bundle waits for an explicit flush; maxWait is the forgotten-flush safety net
      pool.timer = setTimeout(() => flushPool(pool), name ? cfg.maxWait : cfg.waitTime);
    }
    return pool;
  };

  const removePool = pool => {
    clearTimeout(pool.timer);
    const named = pools.get(pool.bundler);
    if (named) {
      named.delete(pool.name);
      if (!named.size) pools.delete(pool.bundler);
    }
  };

  const settle = (waiter, fn, value) => {
    if (waiter.settled) return;
    waiter.settled = true;
    byId.delete(waiter.id);
    if (waiter.cleanup) waiter.cleanup();
    fn(value);
  };

  const sendChunk = async (cfg, waiters) => {
    const parts = waiters.map(waiter => {
      const headers = {};
      for (const name of PART_HEADERS) {
        const value = waiter.request.headers.get(name);
        if (value != null) headers[name] = value;
      }
      return {id: waiter.id, url: waiter.request.url, method: 'GET', headers};
    });
    try {
      await io.put(
        cfg.url,
        {v: 1, parts},
        {bundle: false, cache: false, accept: BUNDLE_MIME, headers: {'Content-Type': REQUEST_MIME}}
      );
    } catch (error) {
      for (const waiter of waiters) {
        settle(
          waiter,
          waiter.reject,
          new io.FailedIO('io: bundle request failed', undefined, waiter.ctx.options, {
            cause: error
          })
        );
      }
      return;
    }
    // matched ids were resolved by the unbundling inspector during the PUT's own finalize
    for (const waiter of waiters) {
      if (!waiter.settled) {
        settle(
          waiter,
          waiter.reject,
          new io.FailedIO(
            'io: part missing from the bundle response',
            undefined,
            waiter.ctx.options
          )
        );
      }
    }
  };

  const flushPool = pool => {
    removePool(pool);
    const waiters = pool.waiters.filter(waiter => !waiter.settled);
    if (!waiters.length) return Promise.resolve();
    const cfg = configFor(pool.bundler);
    if (waiters.length < Math.max(Math.min(cfg.minSize, cfg.maxSize), 1)) {
      // a degenerate bundle is not worth the round-trip: each request continues down its own chain
      for (const waiter of waiters) {
        Promise.resolve()
          .then(waiter.next)
          .then(
            response => settle(waiter, waiter.resolve, response),
            error => settle(waiter, waiter.reject, error)
          );
      }
      return Promise.resolve();
    }
    const sends = [];
    for (let i = 0; i < waiters.length; i += cfg.maxSize) {
      sends.push(sendChunk(cfg, waiters.slice(i, i + cfg.maxSize)));
    }
    return Promise.all(sends).then(() => undefined);
  };

  const flush = name => {
    const target = name == null ? '' : String(name);
    const list = [];
    for (const named of pools.values()) {
      const pool = named.get(target);
      if (pool) list.push(pool);
    }
    return Promise.all(list.map(flushPool)).then(() => undefined);
  };

  const optIn = options => {
    if (options.stream || options.transport || options.bust) return false;
    if ((options.method || 'GET').toUpperCase() !== 'GET') return false;
    if (options.bundle !== undefined) return !!options.bundle;
    const d = io.bundle.theDefault;
    return typeof d === 'function' ? !!d(options) : !!d;
  };

  const handle = (request, ctx, next) => {
    const options = ctx.options;
    if (!optIn(options)) return null;
    const bundler = selectBundler(request.url);
    if (!bundler) {
      if (options.bundle) {
        throw new TypeError('io: bundling requires io.bundle.url or a matching registered bundler');
      }
      return null;
    }
    const name = typeof options.bundle === 'string' ? options.bundle : '';
    const pool = poolOf(bundler, name);
    return new Promise((resolve, reject) => {
      const waiter = {id: 'b' + ++counter, request, ctx, next, resolve, reject, settled: false};
      const signal = options.signal;
      if (signal) {
        const drop = () =>
          settle(
            waiter,
            reject,
            signal.reason != null
              ? signal.reason
              : new DOMException('This operation was aborted', 'AbortError')
          );
        if (signal.aborted) return void drop();
        signal.addEventListener('abort', drop, {once: true});
        waiter.cleanup = () => signal.removeEventListener('abort', drop);
      }
      byId.set(waiter.id, waiter);
      pool.waiters.push(waiter);
      const cfg = configFor(bundler);
      if (pool.waiters.filter(w => !w.settled).length >= cfg.maxSize) flushPool(pool);
    });
  };

  const service = {name: 'bundle', priority: 25, handle};

  const unbundle = envelope => {
    const response = envelope.response;
    const type = (response && response.headers.get('content-type')) || '';
    if (!type.startsWith(BUNDLE_MIME)) return;
    const doc = envelope.data;
    if (!doc || !Array.isArray(doc.parts)) return;
    const writeThrough = io.bundle.writeThrough;
    for (const part of doc.parts) {
      const waiter = part.id != null ? byId.get(part.id) : undefined;
      if (waiter) {
        if (part.synthetic) {
          settle(
            waiter,
            waiter.reject,
            new io.FailedIO(
              'io: the bundler failed the part: ' + (part.body || '(unspecified)'),
              undefined,
              waiter.ctx.options
            )
          );
        } else {
          settle(waiter, waiter.resolve, toResponse(part));
        }
      } else if (part.url && !part.synthetic) {
        // an unclaimed part is a prefetch by definition: adopt-seed it for a future request
        const target = {url: part.url};
        if (part.accept) target.accept = part.accept;
        io.adopt(target, toResponse(part)).catch(() => {});
      }
      const status = part.status || 200;
      if (
        writeThrough &&
        typeof caches !== 'undefined' &&
        part.url &&
        !part.synthetic &&
        status >= 200 &&
        status < 300
      ) {
        caches
          .open(writeThrough === true ? 'io-bundle' : String(writeThrough))
          .then(cache => cache.put(part.url, toResponse(part)))
          .catch(() => {});
      }
    }
  };

  const submit = (requests, opts) => {
    const name = (opts && opts.id) || ' submit-' + ++counter;
    const promises = requests.map(target =>
      io(typeof target === 'string' ? {url: target, bundle: name} : {...target, bundle: name})
    );
    // parking happens a few microtasks in (inspectors are awaited): flush after a macrotask
    setTimeout(() => flush(name), 0);
    return promises;
  };

  io.inspect.response(unbundle);

  io.bundle = {
    url: '',
    waitTime: 20,
    maxSize: 20,
    minSize: 2,
    maxWait: 500,
    writeThrough: false,
    theDefault: false,
    isActive: false,
    optIn,
    attach: () => {
      io.attach(service);
      io.bundle.isActive = true;
      return io;
    },
    detach: () => {
      io.detach('bundle');
      io.bundle.isActive = false;
      return io;
    },
    register: config => {
      bundlers.push(config);
      return io;
    },
    flush,
    submit,
    fly: targets =>
      targets.map(
        target => io.track.fly(typeof target === 'string' ? {url: target} : target).promise
      )
  };

  return io.bundle;
};
