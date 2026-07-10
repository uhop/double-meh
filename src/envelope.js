// @ts-self-types="./envelope.d.ts"
const weakRe = /^W\//;

const parseHeaders = response => {
  const dict = {};
  response.headers.forEach((value, key) => {
    if (key === 'set-cookie') {
      const existing = dict[key];
      if (Array.isArray(existing)) existing.push(value);
      else dict[key] = [value];
    } else {
      dict[key] = value;
    }
  });
  return dict;
};

const parseLinks = value => {
  const links = {};
  if (!value) return links;
  for (const part of value.split(',')) {
    const match = /<([^>]*)>\s*;\s*rel\s*=\s*"?([^";]+)"?/i.exec(part);
    if (match) links[match[2].trim()] = match[1].trim();
  }
  return links;
};

const parseRetryAfter = value => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return seconds;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const parseServerTiming = value => {
  const metrics = [];
  if (!value) return metrics;
  for (const part of value.split(',')) {
    const segments = part.split(';');
    const name = segments[0].trim();
    if (!name) continue;
    const metric = {name};
    for (let i = 1; i < segments.length; ++i) {
      const kv = /^\s*(\w+)\s*=\s*"?([^"]*)"?\s*$/.exec(segments[i]);
      if (!kv) continue;
      if (kv[1] === 'dur') metric.dur = Number(kv[2]);
      else if (kv[1] === 'desc') metric.desc = kv[2];
    }
    metrics.push(metric);
  }
  return metrics;
};

const resolveLocation = (value, baseUrl) => {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl || undefined).href;
  } catch {
    return value;
  }
};

export const defineEnvelope = (target, response, data, baseUrl) => {
  const headers = response.headers;
  target.data = data;
  target.status = response.status;
  target.ok = response.ok;
  target.response = response;
  target.headers = parseHeaders(response);
  Object.defineProperties(target, {
    etag: {enumerable: true, configurable: true, get: () => headers.get('etag') || undefined},
    weak: {enumerable: true, configurable: true, get: () => weakRe.test(headers.get('etag') || '')},
    lastModified: {
      enumerable: true,
      configurable: true,
      get: () => {
        const value = headers.get('last-modified');
        return value ? new Date(value) : undefined;
      }
    },
    location: {
      enumerable: true,
      configurable: true,
      get: () => resolveLocation(headers.get('location'), baseUrl || response.url)
    },
    links: {enumerable: true, configurable: true, get: () => parseLinks(headers.get('link'))},
    contentType: {
      enumerable: true,
      configurable: true,
      get: () => headers.get('content-type') || undefined
    },
    retryAfter: {
      enumerable: true,
      configurable: true,
      get: () => parseRetryAfter(headers.get('retry-after'))
    },
    serverTiming: {
      enumerable: true,
      configurable: true,
      get: () => parseServerTiming(headers.get('server-timing'))
    }
  });
  return target;
};

export const makeEnvelope = (response, data, baseUrl) =>
  defineEnvelope({}, response, data, baseUrl);

// covers AbortError (user abort) and TimeoutError (AbortSignal.timeout)
export const isAbort = error =>
  error != null && (error.name === 'AbortError' || error.name === 'TimeoutError');

export class IOError extends Error {
  constructor(message, options, errorOptions) {
    super(message || 'I/O error', errorOptions);
    this.name = this.constructor.name;
    this.options = options;
  }
}

export class FailedIO extends IOError {
  constructor(message, response, options, errorOptions) {
    super(message || 'Failed I/O', options, errorOptions);
    this.response = response;
  }
}

export class TimedOut extends FailedIO {
  constructor(response, options, errorOptions) {
    super('Timed out', response, options, errorOptions);
  }
}

const opaqueBody = value =>
  (typeof Blob !== 'undefined' && value instanceof Blob) ||
  (typeof ArrayBuffer !== 'undefined' &&
    (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) ||
  (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream) ||
  (typeof FormData !== 'undefined' && value instanceof FormData);

const parseProblem = data => {
  if (data == null) return undefined;
  if (typeof data === 'object') return opaqueBody(data) ? undefined : data;
  if (typeof data === 'string') {
    const text = data.trim();
    // legacy services mislabel JSON envelopes (text/plain, text/html): sniff, don't trust the type
    if (text[0] === '{' || text[0] === '[') {
      try {
        return JSON.parse(text);
      } catch {}
    }
  }
  return undefined;
};

export class BadStatus extends IOError {
  constructor(response, data, baseUrl, options, errorOptions) {
    super('Bad status: ' + response.status, options, errorOptions);
    defineEnvelope(this, response, data, baseUrl);
  }

  get problem() {
    const value = parseProblem(/** @type {any} */ (this).data);
    Object.defineProperty(this, 'problem', {value, configurable: true});
    return value;
  }
}
