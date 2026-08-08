import io from '../src/index.js';

export {io};

export const json = (data, init = {}) =>
  new Response(data === undefined ? null : JSON.stringify(data), {
    status: init.status || 200,
    statusText: init.statusText || 'OK',
    headers: {'content-type': 'application/json', ...(init.headers || {})}
  });

const ANY = () => true;

// a catch-all mock, not a transport override: the full pipeline stays engaged
export const serve = handler => io.mock(ANY, handler);

// awaitable, and drains before clearing: unclaimed bundle parts are adopt-seeded fire-and-forget,
// so a clear that skips io.cache.idle() can be overtaken by an in-flight write and leak the entry
// into the next test — invisible on the synchronous memory default, real on the browser Cache API
export const reset = async () => {
  io.mock.clear();
  await io.cache.idle();
  await io.cache.clear();
};
