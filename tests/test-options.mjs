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

test('the query object bag: values stringify, arrays comma-join, empties drop', async t => {
  let seen;
  serve(request => {
    seen = request.url;
    return json({});
  });
  const price = {toString: () => '9.99'};
  await io.get('https://example.com/bag', {
    q: 'meh',
    page: 2,
    active: true,
    price,
    tags: ['new', 'sale', 7],
    empty: [],
    missing: undefined,
    none: null
  });
  const url = new URL(seen);
  t.equal(url.searchParams.get('q'), 'meh', 'strings pass');
  t.equal(url.searchParams.get('page'), '2', 'numbers stringify');
  t.equal(url.searchParams.get('active'), 'true', 'booleans stringify');
  t.equal(url.searchParams.get('price'), '9.99', 'custom toString() honored');
  t.equal(url.searchParams.get('tags'), 'new,sale,7', 'arrays comma-join into one param');
  t.equal(url.searchParams.getAll('tags').length, 1, 'a single param, not repeats');
  t.notOk(url.searchParams.has('empty'), 'an empty array contributes nothing');
  t.notOk(url.searchParams.has('missing'), 'undefined drops');
  t.notOk(url.searchParams.has('none'), 'null drops');
  reset();
});

test('a URLSearchParams query rides verbatim — the repeated-params escape hatch', async t => {
  let seen;
  serve(request => {
    seen = request.url;
    return json({});
  });
  const params = new URLSearchParams();
  params.append('tag', 'new');
  params.append('tag', 'sale');
  await io.get('https://example.com/usp', params);
  const url = new URL(seen);
  t.deepEqual(url.searchParams.getAll('tag'), ['new', 'sale'], 'repeats preserved');
  reset();
});

test('options.query carries the query when the positional data is a body', async t => {
  let seen;
  serve(request => {
    seen = request;
    return json({});
  });
  await io.post('https://example.com/units', {name: 'unit-1'}, {query: {dept: 42}});
  const url = new URL(seen.url);
  t.equal(url.searchParams.get('dept'), '42', 'query rides the URL');
  t.deepEqual(JSON.parse(seen.body), {name: 'unit-1'}, 'the body is untouched');
  reset();
});
