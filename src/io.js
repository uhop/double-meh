import {buildUrl, requestKey} from './key.js';
import {makeEnvelope, IOError, FailedIO, BadStatus, TimedOut, isAbort} from './envelope.js';

const readVerbs = {GET: 1, HEAD: 1, OPTIONS: 1, DELETE: 1};
const bodylessVerbs = {GET: 1, HEAD: 1, OPTIONS: 1};
const noResponseBody = {HEAD: 1, OPTIONS: 1};
const metaVerbs = {HEAD: 1, OPTIONS: 1};
const verbNames = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const streamVerbNames = ['PUT', 'POST', 'PATCH'];
const jsonRe = /^application\/(?:[\w.+-]+\+)?json\b/;

const defaultMimeTypes = {
  'merge-patch': 'application/merge-patch+json',
  'json-patch': 'application/json-patch+json',
  json: 'application/json',
  ndjson: 'application/x-ndjson',
  jsonl: 'application/x-ndjson',
  text: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  xml: 'application/xml',
  form: 'application/x-www-form-urlencoded',
  octet: 'application/octet-stream'
};

const isMergeable = value =>
  value != null &&
  typeof value === 'object' &&
  (value.constructor === Object || value.constructor === undefined);

const deepMerge = (...sources) => {
  const target = {};
  for (const source of sources) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      if (key === '__proto__') continue;
      const value = source[key];
      target[key] =
        isMergeable(value) && isMergeable(target[key]) ? deepMerge(target[key], value) : value;
    }
  }
  return target;
};

const buildOptions = (url, data, opts, method) => {
  const isUrl = typeof url === 'string' || url instanceof URL;
  const options = deepMerge(isUrl ? null : url, opts, {
    url: isUrl ? String(url) : url.url == null ? undefined : String(url.url)
  });
  if (method !== undefined) options.method = method;
  const verb = (options.method || 'GET').toUpperCase();
  if (readVerbs[verb]) {
    if (data != null && options.query == null) options.query = data;
  } else if (data !== undefined) {
    options.data = data;
  }
  return options;
};

const applyHeaders = (headers, init) => {
  if (!init) return;
  if (typeof Headers !== 'undefined' && init instanceof Headers) {
    init.forEach((value, key) => headers.append(key, value));
    return;
  }
  for (const [key, value] of Object.entries(init)) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, value);
  }
};

const uuid = () => {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  const bytes =
    c && c.getRandomValues
      ? c.getRandomValues(new Uint8Array(16))
      : Uint8Array.from({length: 16}, () => (Math.random() * 256) | 0);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20)
  );
};

const isWellKnownBody = data =>
  (typeof FormData !== 'undefined' && data instanceof FormData) ||
  (typeof Blob !== 'undefined' && data instanceof Blob) ||
  (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) ||
  (typeof ArrayBuffer !== 'undefined' &&
    (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) ||
  (typeof ReadableStream !== 'undefined' && data instanceof ReadableStream);

const isReadableStream = data =>
  data != null && typeof data === 'object' && typeof data.getReader === 'function';

const urlMatches = (match, url) =>
  match == null ||
  (typeof match === 'string'
    ? url.startsWith(match)
    : match instanceof RegExp
      ? match.test(url)
      : !!match(url));

const abortError = signal =>
  signal.reason != null
    ? signal.reason
    : new DOMException('This operation was aborted', 'AbortError');

export const createIO = () => {
  const io = /** @type {any} */ (
    (url, data, opts) => run(buildOptions(url, data, opts)).then(envelope => envelope.data)
  );

  io.transports = {};
  io.defaultTransport = null;
  io.requestInspectors = [];
  io.responseInspectors = [];
  io.dataProcessors = [];
  io.mimeProcessors = [];
  io.services = [];
  io.mimeTypes = {...defaultMimeTypes};
  io.inFlight = 0;

  const listeners = {};
  io.on = (event, fn) => {
    (listeners[event] = listeners[event] || []).push(fn);
    return io;
  };
  io.off = (event, fn) => {
    const fns = listeners[event];
    if (fns) {
      const index = fns.indexOf(fn);
      if (index >= 0) fns.splice(index, 1);
    }
    return io;
  };
  io.emit = (event, ...args) => {
    const fns = listeners[event];
    if (fns) for (const fn of fns.slice()) fn(...args);
    return io;
  };

  io.full = (url, data, opts) => run(buildOptions(url, data, opts));

  io.registerTransport = (name, transport) => {
    io.transports[name] = transport;
    return io;
  };

  io.inspect = {
    request: (fn, match) => {
      io.requestInspectors.push({fn, match});
      return io;
    },
    response: (fn, match) => {
      io.responseInspectors.push({fn, match});
      return io;
    }
  };

  io.registerData = processor => {
    io.dataProcessors.push(processor);
    return io;
  };

  io.registerMime = processor => {
    io.mimeProcessors.push(processor);
    return io;
  };

  io.attach = service => {
    io.detach(service.name);
    io.services.push(service);
    io.services.sort((a, b) => a.priority - b.priority);
    return io;
  };

  io.detach = name => {
    const index = io.services.findIndex(service => service.name === name);
    if (index >= 0) io.services.splice(index, 1);
    return io;
  };

  const contentTypeFor = as => {
    if (typeof as !== 'string' || !as) return undefined;
    // registry alias wins; otherwise a media-type string (has '/') passes through verbatim
    return io.mimeTypes[as] || (as.indexOf('/') >= 0 ? as : undefined);
  };

  const applyHeaderOptions = (options, headers) => {
    if (options.accept) headers.set('Accept', options.accept);
    else if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    if (options.ifMatch) headers.set('If-Match', options.ifMatch);
    if (options.ifNoneMatch) headers.set('If-None-Match', options.ifNoneMatch);
    if (options.idempotencyKey && !headers.has('Idempotency-Key')) {
      headers.set(
        'Idempotency-Key',
        options.idempotencyKey === true ? uuid() : options.idempotencyKey
      );
    }
  };

  const encodeBody = (options, headers) => {
    const method = (options.method || 'GET').toUpperCase();
    if (bodylessVerbs[method] || options.data === undefined) return undefined;
    const contentType = contentTypeFor(options.as);
    if (contentType && !headers.has('Content-Type')) headers.set('Content-Type', contentType);
    const data = options.data;
    for (const processor of io.dataProcessors) {
      if (processor.match(data, options)) return processor.encode(data, headers, options);
    }
    if (typeof data === 'string' || isWellKnownBody(data)) return data;
    // a chain/duplex ({readable, writable}) streams its readable side as the body
    if (data && isReadableStream(data.readable)) return data.readable;
    if (typeof data === 'object') {
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      return JSON.stringify(data);
    }
    return String(data);
  };

  const prepare = options => {
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers();
    applyHeaders(headers, options.headers);
    applyHeaderOptions(options, headers);
    const body = encodeBody(options, headers);
    return {url: buildUrl(options), method, headers, body, signal: options.signal};
  };

  const dispatch = (request, ctx) => {
    const transport = io.transports[ctx.options.transport] || io.defaultTransport;
    if (!transport)
      return Promise.reject(new FailedIO('No transport configured', undefined, ctx.options));
    let next = () => Promise.resolve(transport(request, ctx));
    for (const service of io.services) {
      const downstream = next;
      next = () =>
        Promise.resolve(service.handle(request, ctx, downstream)).then(result =>
          result == null ? downstream() : result
        );
    }
    return next();
  };

  const meter = (response, options) => {
    const fn = options.onDownloadProgress;
    if (typeof fn !== 'function' || !response.body) return response;
    const total = Number(response.headers.get('content-length')) || 0;
    let loaded = 0;
    const counted = response.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          loaded += chunk.byteLength || chunk.length || 0;
          controller.enqueue(chunk);
          fn({loaded, total, lengthComputable: total > 0});
        }
      })
    );
    return new Response(counted, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  };

  const parseJson = source => source.text().then(text => (text ? JSON.parse(text) : undefined));

  const decode = (response, options) => {
    if (options.stream) return meter(response, options).body;
    const method = (options.method || 'GET').toUpperCase();
    if (noResponseBody[method] || response.status === 204 || response.body == null)
      return undefined;
    const source = meter(response, options);
    const forced = options.decode;
    if (forced) {
      if (typeof forced === 'function') return forced(source, options);
      switch (forced) {
        case 'json':
          return parseJson(source);
        case 'text':
          return source.text();
        case 'blob':
          return source.blob();
        case 'arrayBuffer':
          return source.arrayBuffer();
        case 'formData':
          return source.formData();
      }
      throw new TypeError('io: unknown decode mode: ' + forced);
    }
    const contentType = response.headers.get('content-type') || '';
    for (const processor of io.mimeProcessors) {
      if (processor.match(contentType, response)) return processor.decode(source);
    }
    if (jsonRe.test(contentType)) return parseJson(source);
    return source.text();
  };

  const finalize = async (response, ctx, baseUrl) => {
    const options = ctx.options;
    const data = await decode(response, options);
    let envelope = makeEnvelope(response, data, baseUrl);
    for (const {fn, match} of io.responseInspectors) {
      if (!urlMatches(match, baseUrl)) continue;
      const result = await fn(envelope, ctx);
      if (result) envelope = result;
    }
    if (!envelope.ok && !options.ignoreBadStatus) {
      throw new BadStatus(envelope.response || response, envelope.data, baseUrl, options);
    }
    return envelope;
  };

  const mapError = (error, ctx, response) => {
    if (
      ctx.timeoutSignal &&
      ctx.timeoutSignal.aborted &&
      !(ctx.userSignal && ctx.userSignal.aborted)
    ) {
      return new TimedOut(response, ctx.options, {cause: error});
    }
    if (isAbort(error) || (ctx.userSignal && ctx.userSignal.aborted)) return error;
    if (error instanceof IOError) return error;
    return new FailedIO((error && error.message) || 'Failed I/O', response, ctx.options, {
      cause: error
    });
  };

  // guarantees abort/timeout surfaces even when a transport or service ignores the signal
  const abortable = (promise, ctx) => {
    const signal = ctx.options.signal;
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      if (signal.aborted) return void reject(abortError(signal));
      const onAbort = () => reject(abortError(signal));
      signal.addEventListener('abort', onAbort, {once: true});
      const settle = fn => value => {
        signal.removeEventListener('abort', onAbort);
        fn(value);
      };
      promise.then(settle(resolve), settle(reject));
    });
  };

  const execute = async (request, ctx) => {
    ++io.inFlight;
    io.emit('request', request, ctx);
    try {
      let response;
      try {
        response = await abortable(dispatch(request, ctx), ctx);
      } catch (error) {
        throw mapError(error, ctx, undefined);
      }
      let envelope;
      try {
        envelope = await finalize(response, ctx, request.url);
      } catch (error) {
        throw mapError(error, ctx, response);
      }
      io.emit('success', envelope, ctx);
      return envelope;
    } catch (error) {
      io.emit('failure', error, ctx);
      throw error;
    } finally {
      --io.inFlight;
    }
  };

  const waitFor = (entry, ctx) => {
    const signal = ctx.options.signal;
    if (!signal) return entry.promise;
    return new Promise((resolve, reject) => {
      const fail = () =>
        reject(
          ctx.timeoutSignal &&
            ctx.timeoutSignal.aborted &&
            !(ctx.userSignal && ctx.userSignal.aborted)
            ? new TimedOut(undefined, ctx.options, {cause: signal.reason})
            : abortError(signal)
        );
      if (signal.aborted) return void fail();
      const onAbort = () => fail();
      signal.addEventListener('abort', onAbort, {once: true});
      const settle = fn => value => {
        signal.removeEventListener('abort', onAbort);
        fn(value);
      };
      entry.promise.then(settle(resolve), settle(reject));
    });
  };

  const run = async rawOptions => {
    const options = typeof rawOptions === 'string' ? {url: rawOptions} : {...rawOptions};
    const userSignal = options.signal;
    let timeoutSignal = null;
    if (typeof options.timeout === 'number' && options.timeout > 0) {
      timeoutSignal = AbortSignal.timeout(options.timeout);
      options.signal = userSignal ? AbortSignal.any([userSignal, timeoutSignal]) : timeoutSignal;
    }
    let request = prepare(options);
    for (const {fn, match} of io.requestInspectors) {
      if (!urlMatches(match, request.url)) continue;
      const result = await fn(request, options);
      if (result) request = result;
    }
    const ctx = {options, key: requestKey(request.method, request.url), userSignal, timeoutSignal};
    const track = io.track;
    const wait = options.track === 'wait';
    const opted = track && track.active && track.optIn(options);
    if (wait && !opted) {
      throw new TypeError("io: track 'wait' requires a trackable GET request");
    }
    if (opted) {
      const entry = track.flyByKey(ctx.key);
      if (!wait && !entry.flying) {
        entry.flying = true;
        execute(request, ctx).then(entry.resolve, entry.reject);
      }
      return waitFor(entry, ctx);
    }
    return execute(request, ctx);
  };

  const invoke = (method, url, data, opts) => run(buildOptions(url, data, opts, method));

  const makeVerb = method => (url, data, opts) => {
    const promise = invoke(method, url, data, opts);
    return metaVerbs[method] ? promise : promise.then(envelope => envelope.data);
  };

  const makeFullVerb = method => (url, data, opts) => invoke(method, url, data, opts);

  for (const name of verbNames) {
    const lower = name.toLowerCase();
    io[lower] = makeVerb(name);
    io.full[lower] = makeFullVerb(name);
  }
  io.del = io.remove = io.delete;
  io.full.del = io.full.remove = io.full.delete;

  // request-body streaming duplex for writes: `writable` streams up (duplex:'half'),
  // `readable` is the streamed response, `.response` resolves at headers-time
  const streamDuplex = options => {
    const reqSide = new TransformStream();
    const resSide = new TransformStream();
    options.data = reqSide.readable;
    options.stream = true;
    const response = run(options);
    response.then(
      envelope => {
        const body = envelope.data;
        (body ? body.pipeTo(resSide.writable) : resSide.writable.close()).catch(() => {});
      },
      error => resSide.writable.abort(error).catch(() => {})
    );
    return {writable: reqSide.writable, readable: resSide.readable, response};
  };

  io.stream = {
    get: (url, data, opts) => io.get(url, data, {...opts, stream: true})
  };
  for (const name of streamVerbNames) {
    io.stream[name.toLowerCase()] = (url, opts) =>
      streamDuplex(buildOptions(url, undefined, opts, name));
  }

  io.run = run;
  io.makeVerb = makeVerb;
  io.toEnvelope = (response, options) => {
    const normalized = typeof options === 'string' ? {url: options} : options;
    const ctx = {options: normalized, key: io.makeKey(normalized)};
    return finalize(response, ctx, normalized.url);
  };
  io.makeKey = options => requestKey((options.method || 'GET').toUpperCase(), buildUrl(options));
  io.buildUrl = buildUrl;
  io.IOError = IOError;
  io.FailedIO = FailedIO;
  io.BadStatus = BadStatus;
  io.TimedOut = TimedOut;

  return io;
};

const io = createIO();

export default io;
