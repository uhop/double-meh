const noBody = {GET: 1, HEAD: 1, OPTIONS: 1, DELETE: 1};

const base = () => (typeof location !== 'undefined' && location ? location.href : undefined);

const appendList = (params, key, list) => {
  if (Array.isArray(list) && list.length) params.append(key, list.join(','));
};

const buildQuery = options => {
  const params = new URLSearchParams();
  const method = (options.method || 'GET').toUpperCase();
  const dict = options.query != null ? options.query : noBody[method] ? options.data : undefined;
  if (dict && typeof dict === 'object') {
    for (const [key, value] of Object.entries(dict)) {
      if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
      else if (value != null) params.append(key, String(value));
    }
  }
  appendList(params, 'fields', options.fields);
  appendList(params, 'sort', options.sort);
  appendList(params, 'expand', options.expand);
  return params.toString();
};

export const buildUrl = options => {
  const query = buildQuery(options);
  if (!query) return options.url;
  return options.url + (options.url.indexOf('?') < 0 ? '?' : '&') + query;
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

export const requestKey = (method, url) => method.toUpperCase() + ' ' + canonicalUrl(url);
