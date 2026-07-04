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

export const reset = () => {
  io.mock.clear();
  io.cache.clear();
};
