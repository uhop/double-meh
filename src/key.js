const noBody = {GET: 1, HEAD: 1, OPTIONS: 1};

const base = () => (typeof location !== 'undefined' && location ? location.href : undefined);

const appendList = (params, key, list) => {
  if (Array.isArray(list) && list.length) params.append(key, list.join(','));
};

const bustValue = () => Date.now().toString(36) + '-' + ((Math.random() * 1e9) | 0).toString(36);

const buildQuery = options => {
  const params = new URLSearchParams();
  const method = (options.method || 'GET').toUpperCase();
  const dict = options.query != null ? options.query : noBody[method] ? options.data : undefined;
  let raw = '';
  if (typeof URLSearchParams !== 'undefined' && dict instanceof URLSearchParams) {
    for (const [key, value] of dict) params.append(key, value);
  } else if (dict != null && typeof dict === 'object') {
    for (const [key, value] of Object.entries(dict)) {
      if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
      else if (value != null) params.append(key, String(value));
    }
  } else if (dict != null) {
    // scalar → raw query segment (URLSearchParams can't emit a keyless value); '' contributes nothing
    raw = typeof dict === 'string' ? dict : String(dict);
  }
  appendList(params, 'fields', options.fields);
  appendList(params, 'sort', options.sort);
  appendList(params, 'expand', options.expand);
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
export const requestKey = (method, url, accept) => {
  const base = method.toUpperCase() + ' ' + canonicalUrl(url);
  return accept && accept !== DEFAULT_ACCEPT ? base + ' accept=' + accept : base;
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
