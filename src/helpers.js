const CONFLICT_RETRIES = 3;
const URL_LIMIT = 2000;

const normalizeTarget = target =>
  typeof target === 'string' || target instanceof URL ? {url: String(target)} : target;

const plainObject = value =>
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams)
    ? value
    : null;

export const installHelpers = io => {
  io.update = async (target, fn, options) => {
    for (let attempt = 0; ; ++attempt) {
      const env = await io.full.get(target, null, {...options, cache: false});
      if (env.etag == null && !(options && options.force)) {
        throw new io.IOError(
          'io.update: the GET returned no ETag; pass {force: true} to update unconditionally',
          options
        );
      }
      const next = await fn(env.data);
      if (next === undefined) return env.data;
      try {
        const overrides = {...options};
        if (env.etag != null) overrides.ifMatch = env.etag;
        const result = await io.put(target, next, overrides);
        if (io.cache && io.cache.isActive) {
          await io.cache.remove(io.buildUrl(normalizeTarget(target)));
        }
        return result;
      } catch (error) {
        if (error instanceof io.BadStatus && error.status === 412 && attempt < CONFLICT_RETRIES) {
          continue;
        }
        throw error;
      }
    }
  };

  io.paginate = (target, data, options) => {
    const base = normalizeTarget(target);
    return (async function* () {
      const follow = {...options};
      delete follow.query;
      delete follow.page;
      const originalQuery = plainObject(options && options.query) || plainObject(data) || {};
      const pageLimit = options && options.page && options.page.limit;
      const visited = new Set();
      let lastCursor;
      let env = await io.full.get(base, data, options);
      if (env.response.url) visited.add(env.response.url);
      for (;;) {
        const body = env.data;
        const page = Array.isArray(body) ? null : body;
        const items = Array.isArray(body)
          ? body
          : page && Array.isArray(page.data)
            ? page.data
            : null;
        if (!items) {
          throw new io.FailedIO(
            'io.paginate: the response is not a list or a paged envelope',
            env.response,
            options
          );
        }
        yield* items;
        const followUrl = async next => {
          let url;
          try {
            url = new URL(next, env.response.url || io.buildUrl(base)).href;
          } catch {
            url = next;
          }
          if (visited.has(url)) {
            throw new io.FailedIO(
              'io.paginate: the next link repeats a page',
              env.response,
              options
            );
          }
          visited.add(url);
          return io.full.get(url, null, follow);
        };
        const followQuery = query => {
          const limit = (page && page.limit) ?? pageLimit ?? originalQuery.limit;
          if (limit != null) query.limit = limit;
          return io.full.get(base, null, {...follow, query});
        };
        if (page && page.links != null && typeof page.links === 'object') {
          // links present in the body: their absence is the last-page signal
          if (page.links.next == null) return;
          env = await followUrl(page.links.next);
        } else if (page && page.cursor !== undefined) {
          if (page.cursor == null) return; // a null cursor is the last page
          if (page.cursor === lastCursor) {
            throw new io.FailedIO('io.paginate: the cursor repeats a page', env.response, options);
          }
          lastCursor = page.cursor;
          env = await followQuery({...originalQuery, cursor: page.cursor});
        } else if (page && typeof page.offset === 'number') {
          if (!items.length) return; // no total, no links: an empty page is the end
          const offset = page.offset + items.length;
          if (typeof page.total === 'number' && offset >= page.total) return;
          if (typeof page.limit === 'number' && items.length < page.limit) return; // a short page is the last
          env = await followQuery({...originalQuery, offset});
        } else {
          // a bare array (or an envelope without paging fields): header links only
          const next = env.links && env.links.next;
          if (!next) return;
          env = await followUrl(next);
        }
      }
    })();
  };

  io.getByIds = (target, ids, options) => {
    const base = normalizeTarget(target);
    const query = {...(plainObject(options && options.query) || {}), ids: ids.join(',')};
    const url = io.buildUrl({...base, ...options, query, method: 'GET'});
    if (url.length <= io.getByIds.urlLimit) return io.get(base, null, {...options, query});
    // the id list overflows the URL: still a read, but carried in a POST body
    return io.post(base, {keys: [...ids]}, options);
  };
  io.getByIds.urlLimit = URL_LIMIT;

  return io;
};
