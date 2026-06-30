import io from '../src/index.js';

export {io};

export const json = (data, init = {}) =>
  new Response(data === undefined ? null : JSON.stringify(data), {
    status: init.status || 200,
    statusText: init.statusText || 'OK',
    headers: {'content-type': 'application/json', ...(init.headers || {})}
  });

const ANY = () => true;

// Serve every request with `handler(request, ctx)` via a catch-all mock — replaces
// hand-rolled `io.defaultTransport` overrides. The handler returns a Response or any value.
export const serve = handler => io.mock(ANY, handler);

export const reset = () => {
  io.mock.clear();
  io.cache.clear();
};
