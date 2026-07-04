import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

test('options.fetch passes RequestInit fields through to fetch()', async t => {
  const realFetch = globalThis.fetch;
  let seenInit;
  globalThis.fetch = (_url, init) => {
    seenInit = init;
    return Promise.resolve(new Response('{}', {headers: {'content-type': 'application/json'}}));
  };
  try {
    await io.get('https://example.com/x', null, {fetch: {credentials: 'include', mode: 'cors'}});
    t.equal(seenInit.credentials, 'include', 'credentials forwarded to fetch init');
    t.equal(seenInit.mode, 'cors', 'mode forwarded to fetch init');
    t.equal(seenInit.method, 'GET', "double-meh's own method still wins");
  } finally {
    globalThis.fetch = realFetch;
    reset();
  }
});

test('track wait: registers interest without firing; a real request resolves the waiter', async t => {
  let hits = 0;
  serve(() => {
    ++hits;
    return json({v: 42});
  });
  const waiter = io.get({url: 'https://example.com/w', track: 'wait'});
  await Promise.resolve();
  t.equal(hits, 0, 'wait did not fire a request');
  const real = io.get('https://example.com/w');
  const [w, r] = await Promise.all([waiter, real]);
  t.equal(hits, 1, 'exactly one real request fired');
  t.deepEqual(w, {v: 42}, 'the waiter resolved with the landed data');
  t.deepEqual(r, {v: 42}, 'the real request resolved too');
  reset();
});

test('the page option lowers to offset/limit/cursor query params', async t => {
  let seen;
  serve(request => {
    seen = request.url;
    return json({});
  });
  await io.get('https://example.com/paged', null, {page: {offset: 40, limit: 20}});
  let url = new URL(seen);
  t.equal(url.searchParams.get('offset'), '40', 'offset lowered');
  t.equal(url.searchParams.get('limit'), '20', 'limit lowered');
  await io.get('https://example.com/paged', null, {page: {cursor: 'eyJpZCI6Ijk5In0'}});
  url = new URL(seen);
  t.equal(url.searchParams.get('cursor'), 'eyJpZCI6Ijk5In0', 'cursor lowered');
  t.equal(url.searchParams.get('offset'), null, 'absent page fields contribute nothing');
  reset();
});
