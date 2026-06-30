import {buildUrl, requestKey} from './key.js';
import {makeEnvelope, FailedIO, BadStatus, TimedOut} from './envelope.js';

const readVerbs = {GET: 1, HEAD: 1, OPTIONS: 1, DELETE: 1};
const noResponseBody = {HEAD: 1, OPTIONS: 1};
const metaVerbs = {HEAD: 1, OPTIONS: 1};
const verbNames = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const jsonRe = /^application\/(?:[\w.+-]+\+)?json\b/;

const isMergeable = value =>
  value != null &&
  typeof value === 'object' &&
  (value.constructor === Object || value.constructor === undefined);

const deepMerge = (...sources) => {
  const target = {};
  for (const source of sources) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      const value = source[key];
      target[key] =
        isMergeable(value) && isMergeable(target[key]) ? deepMerge(target[key], value) : value;
    }
  }
  return target;
};

const buildOptions = (url, data, opts, method) => {
  const isUrl = typeof url === 'string' || url instanceof URL;
  const options = deepMerge(isUrl ? null : url, opts, {url: isUrl ? String(url) : url.url});
  if (method !== undefined) options.method = method;
  const verb = (options.method || 'GET').toUpperCase();
  if (readVerbs[verb]) {
    if (data != null && options.query == null) options.query = data;
  } else if (data !== undefined) {
    options.data = data;
  }
  return options;
};

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
io.full = (url, data, opts) => run(buildOptions(url, data, opts));

io.registerTransport = (name, transport) => {
  io.transports[name] = transport;
  return io;
};

io.inspect = {
  request: fn => {
    io.requestInspectors.push(fn);
    return io;
  },
  response: fn => {
    io.responseInspectors.push(fn);
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
  switch (as) {
    case 'merge-patch':
      return 'application/merge-patch+json';
    case 'json-patch':
      return 'application/json-patch+json';
    default:
      return undefined;
  }
};

const applyHeaders = (headers, init) => {
  if (!init) return;
  for (const [key, value] of Object.entries(init)) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, value);
  }
};

const uuid = () => {
  if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
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
  const contentType = contentTypeFor(options.as);
  if (contentType && !headers.has('Content-Type')) headers.set('Content-Type', contentType);
};

const isWellKnownBody = data =>
  (typeof FormData !== 'undefined' && data instanceof FormData) ||
  (typeof Blob !== 'undefined' && data instanceof Blob) ||
  (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) ||
  (typeof ArrayBuffer !== 'undefined' &&
    (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) ||
  (typeof ReadableStream !== 'undefined' && data instanceof ReadableStream);

const encodeBody = (options, headers) => {
  const method = (options.method || 'GET').toUpperCase();
  if (readVerbs[method] || options.data === undefined) return undefined;
  const data = options.data;
  for (const processor of io.dataProcessors) {
    if (processor.match(data, options)) return processor.encode(data, headers, options);
  }
  if (typeof data === 'string' || isWellKnownBody(data)) return data;
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
  if (!transport) return Promise.reject(new FailedIO('No transport configured', null, ctx.options));
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

const decode = (response, options) => {
  if (options.stream) return response.body;
  const method = (options.method || 'GET').toUpperCase();
  if (noResponseBody[method] || response.status === 204 || response.body == null) return undefined;
  const contentType = response.headers.get('content-type') || '';
  for (const processor of io.mimeProcessors) {
    if (processor.match(contentType, response)) return processor.decode(response);
  }
  if (jsonRe.test(contentType)) return response.json().catch(() => undefined);
  return response.text();
};

const finalize = async (response, ctx, baseUrl) => {
  const options = ctx.options;
  const data = await decode(response, options);
  let envelope = makeEnvelope(response, data, baseUrl);
  for (const inspector of io.responseInspectors) {
    const result = await inspector(envelope, ctx);
    if (result) envelope = result;
  }
  if (!envelope.ok && !options.ignoreBadStatus) {
    throw new BadStatus(response, data, baseUrl, options);
  }
  return envelope;
};

const execute = async (request, ctx) => {
  let response;
  try {
    response = await dispatch(request, ctx);
  } catch (error) {
    if (error instanceof FailedIO) throw error;
    throw new FailedIO((error && error.message) || 'Failed I/O', null, ctx.options);
  }
  return finalize(response, ctx, request.url);
};

const run = async rawOptions => {
  const options = typeof rawOptions === 'string' ? {url: rawOptions} : {...rawOptions};
  let request = prepare(options);
  for (const inspector of io.requestInspectors) {
    const result = await inspector(request, options);
    if (result) request = result;
  }
  const ctx = {options, key: requestKey(request.method, request.url)};
  if (io.track && io.track.active && io.track.optIn(options)) {
    const existing = io.track.deferred[ctx.key];
    if (existing) return existing.promise;
    const entry = io.track.flyByKey(ctx.key);
    execute(request, ctx).then(entry.resolve, entry.reject);
    return entry.promise;
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

io.run = run;
io.request = run;
io.makeVerb = makeVerb;
io.toEnvelope = (response, options) => {
  const normalized = typeof options === 'string' ? {url: options} : options;
  const ctx = {options: normalized, key: io.makeKey(normalized)};
  return finalize(response, ctx, normalized.url);
};
io.makeKey = options => requestKey((options.method || 'GET').toUpperCase(), buildUrl(options));
io.buildUrl = buildUrl;
io.FailedIO = FailedIO;
io.BadStatus = BadStatus;
io.TimedOut = TimedOut;

export default io;
