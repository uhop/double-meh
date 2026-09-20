// @ts-self-types="./key.d.ts"
const noBody = {GET: 1, HEAD: 1, OPTIONS: 1};

// safe and idempotent, so one decoded envelope may be shared: the rule track and cache opt in on.
// QUERY (RFC 10008) is a read that carries its criteria in the body, which is why the body has to
// reach the key for it and need not for the unsafe verbs, whose keys only a hand-over consults.
export const safeMethods = {GET: 1, QUERY: 1};

// FNV-1a, 32-bit: a cache discriminator, not a signature, so a sync non-cryptographic hash is the
// right tool -- crypto.subtle is async and would push key building off the synchronous path
const hash = text => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; ++i) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

// only a value whose serialization is stable contributes: a stream cannot be read synchronously,
// and a Blob or FormData would JSON.stringify to the same "{}" as any other, which is worse than
// contributing nothing. Those cases declare a `variant` instead, or go unshared.
const stableText = data => {
  if (typeof data === 'string') return data;
  if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
    return String(data);
  }
  if (Array.isArray(data)) return JSON.stringify(data);
  if (data && typeof data === 'object') {
    const proto = Object.getPrototypeOf(data);
    if (proto === Object.prototype || proto === null) return JSON.stringify(data);
    return undefined;
  }
  if (data === null || typeof data !== 'object') return JSON.stringify(data);
  return undefined;
};

/**
 * The body's contribution to the key: an explicit `variant` wherever it is given, and otherwise a
 * hash of the request data for a safe method that carries one. An unsafe verb contributes nothing
 * by default, because nothing shares it.
 */
export const bodyKeyOf = options => {
  if (options.variant != null) return String(options.variant);
  const method = (options.method || 'GET').toUpperCase();
  if (!safeMethods[method] || noBody[method] || options.data === undefined) return undefined;
  const text = stableText(options.data);
  return text === undefined ? undefined : hash(text);
};

const base = () => (typeof location !== 'undefined' && location ? location.href : undefined);

// resolution only — canonicalUrl additionally sorts the query and drops the hash, which is right
// for an identity key and wrong for a URL about to be fetched
export const absoluteUrl = rawUrl => {
  try {
    return new URL(rawUrl, base()).href;
  } catch {
    return rawUrl;
  }
};

const appendList = (params, key, list, separator) => {
  if (!Array.isArray(list) || !list.length) return;
  if (separator == null) for (const item of list) params.append(key, String(item));
  else params.append(key, list.join(separator));
};

const bustValue = () => Date.now().toString(36) + '-' + ((Math.random() * 1e9) | 0).toString(36);

const buildQuery = options => {
  const params = new URLSearchParams();
  const method = (options.method || 'GET').toUpperCase();
  const dict = options.query != null ? options.query : noBody[method] ? options.data : undefined;
  const sep = options.listSeparator;
  // the generic bag defaults to repeated keys (no separator-in-item ambiguity);
  // fields/sort/expand keep their protocol comma — an explicit listSeparator governs both
  const bagSeparator = typeof sep === 'string' ? sep : null;
  const builderSeparator = sep === undefined ? ',' : bagSeparator;
  let raw = '';
  if (typeof URLSearchParams !== 'undefined' && dict instanceof URLSearchParams) {
    for (const [key, value] of dict) params.append(key, value);
  } else if (dict && typeof dict === 'object') {
    for (const [key, value] of Object.entries(dict)) {
      if (Array.isArray(value)) appendList(params, key, value, bagSeparator);
      else if (value != null) params.append(key, String(value));
    }
  } else if (dict != null) {
    // scalar → raw query segment (URLSearchParams can't emit a keyless value); '' contributes nothing
    raw = typeof dict === 'string' ? dict : String(dict);
  }
  appendList(params, 'fields', options.fields, builderSeparator);
  appendList(params, 'sort', options.sort, builderSeparator);
  appendList(params, 'expand', options.expand, builderSeparator);
  if (options.page && typeof options.page === 'object') {
    for (const key of ['offset', 'limit', 'cursor']) {
      if (options.page[key] != null) params.append(key, String(options.page[key]));
    }
  }
  if (options.bust) {
    params.append(options.bust === true ? 'io-bust' : String(options.bust), bustValue());
  }
  const rest = params.toString();
  return raw && rest ? raw + '&' + rest : raw || rest;
};

export const buildUrl = options => {
  if (options.url == null) throw new TypeError('io: options.url is required');
  const url = String(options.url);
  const query = buildQuery(options);
  if (!query) return url;
  try {
    const parsed = new URL(url, base());
    parsed.search = (parsed.search ? parsed.search.slice(1) + '&' : '') + query;
    return parsed.href;
  } catch {
    // relative URL without a base: keep the query ahead of any fragment
    const hash = url.indexOf('#');
    const head = hash < 0 ? url : url.slice(0, hash);
    const fragment = hash < 0 ? '' : url.slice(hash);
    return head + (head.indexOf('?') < 0 ? '?' : '&') + query + fragment;
  }
};

export const canonicalUrl = rawUrl => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    const root = base();
    if (!root) return rawUrl;
    try {
      url = new URL(rawUrl, root);
    } catch {
      return rawUrl;
    }
  }
  url.searchParams.sort();
  url.hash = '';
  return url.href;
};

const DEFAULT_ACCEPT = 'application/json';

// the prepared default folds to the base key, so an explicit application/json and none are one identity
export const requestKey = (method, url, accept, body) => {
  let key = method.toUpperCase() + ' ' + canonicalUrl(url);
  if (accept && accept !== DEFAULT_ACCEPT) key += ' accept=' + accept;
  return body == null ? key : key + ' body=' + body;
};

// Request shares five property names with Options and disagrees on `cache` (`"default"` reads as
// a truthy cache opt-in), so only the three that identify a request are taken
export const normalizeTarget = target => {
  if (typeof target === 'string') return {url: target};
  if (target instanceof URL) return {url: target.href};
  if (typeof Request !== 'undefined' && target instanceof Request) {
    return {
      method: target.method,
      url: target.url,
      accept: target.headers.get('accept') || undefined
    };
  }
  return target;
};

export const acceptOf = options => {
  if (options.accept) return options.accept;
  const headers = options.headers;
  if (!headers) return undefined;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get('accept') || undefined;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'accept') return value;
  }
  return undefined;
};
