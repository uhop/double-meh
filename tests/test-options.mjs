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

test('the query object bag: values stringify, arrays repeat by default, empties drop', async t => {
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
  t.deepEqual(
    url.searchParams.getAll('tags'),
    ['new', 'sale', '7'],
    'arrays repeat keys by default — no separator-in-item ambiguity'
  );
  t.notOk(url.searchParams.has('empty'), 'an empty array contributes nothing');
  t.notOk(url.searchParams.has('missing'), 'undefined drops');
  t.notOk(url.searchParams.has('none'), 'null drops');
  reset();
});

test('listSeparator: a string joins query lists; the builders follow', async t => {
  let seen;
  serve(request => {
    seen = request.url;
    return json({});
  });
  await io.get(
    'https://example.com/sep',
    {tags: ['new', 'sale']},
    {listSeparator: '|', fields: ['id', 'name']}
  );
  let url = new URL(seen);
  t.equal(url.searchParams.get('tags'), 'new|sale', 'the bag joins with the separator');
  t.equal(url.searchParams.get('fields'), 'id|name', 'fields follow an explicit separator');

  await io.get('https://example.com/sep2', {tags: ['a', 'b']}, {listSeparator: ','});
  url = new URL(seen);
  t.equal(url.searchParams.get('tags'), 'a,b', 'comma is an explicit choice');
  t.equal(url.searchParams.getAll('tags').length, 1, 'a single param');
  reset();
});

test('listSeparator: fields keep their protocol comma unless overridden', async t => {
  let seen;
  serve(request => {
    seen = request.url;
    return json({});
  });
  await io.get('https://example.com/f1', null, {fields: ['id', 'name']});
  let url = new URL(seen);
  t.equal(url.searchParams.get('fields'), 'id,name', 'unset → comma (the article convention)');

  await io.get('https://example.com/f2', null, {fields: ['id', 'name'], listSeparator: null});
  url = new URL(seen);
  t.deepEqual(
    url.searchParams.getAll('fields'),
    ['id', 'name'],
    'an explicit null flips the builders to repeated keys'
  );
  reset();
});

test('io.defaults: scoped option defaults apply; per-call options win', async t => {
  const dm = io.create();
  let seen;
  dm.mock(
    () => true,
    request => {
      seen = request.url;
      return json({});
    }
  );
  dm.defaults('https://legacy.example.com/', {listSeparator: ','});
  dm.defaults({timeout: 60_000}); // global (unscoped) bag

  await dm.get('https://legacy.example.com/units', {tags: ['a', 'b']});
  let url = new URL(seen);
  t.equal(url.searchParams.get('tags'), 'a,b', 'the scoped default applied');

  await dm.get('https://other.example.com/units', {tags: ['a', 'b']});
  url = new URL(seen);
  t.deepEqual(url.searchParams.getAll('tags'), ['a', 'b'], 'a non-matching scope is untouched');

  await dm.get('https://legacy.example.com/units', {tags: ['a', 'b']}, {listSeparator: null});
  url = new URL(seen);
  t.deepEqual(url.searchParams.getAll('tags'), ['a', 'b'], 'per-call options beat the default');
});

test('io.defaults: later registrations win; url in a bag is ignored', async t => {
  const dm = io.create();
  let seen;
  dm.mock(
    () => true,
    request => {
      seen = request.url;
      return json({});
    }
  );
  dm.defaults(/example\.com/, {listSeparator: '|'});
  dm.defaults('https://legacy.example.com/', {
    listSeparator: ';',
    url: 'https://evil.invalid/' // must not redirect anything
  });

  await dm.get('https://legacy.example.com/units', {tags: ['a', 'b']});
  const url = new URL(seen);
  t.equal(url.hostname, 'legacy.example.com', 'the url never comes from a defaults bag');
  t.equal(url.searchParams.get('tags'), 'a;b', 'the later matching bag wins');
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
