const CONFLICT_RETRIES = 3;

const normalizeTarget = target =>
  typeof target === 'string' || target instanceof URL ? {url: String(target)} : target;

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
  return io;
};
