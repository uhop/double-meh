const CONFLICT_RETRIES = 3;

const urlOf = target =>
  typeof target === 'string' ? target : target instanceof URL ? String(target) : target.url;

export const installHelpers = io => {
  io.update = async (target, fn, options) => {
    for (let attempt = 0; ; ++attempt) {
      const env = await io.full.get(target, null, {...options, cache: false});
      const next = await fn(env.data);
      if (next === undefined) return env.data;
      try {
        const result = await io.put(target, next, {...options, ifMatch: env.etag});
        if (io.cache && io.cache.isActive) await io.cache.remove(urlOf(target));
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
