import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

test('accept variants coexist in the cache', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  const url = 'https://example.com/variants';
  const a = await io.get(url);
  const b = await io.get(url, null, {accept: 'text/x-alt'});
  t.equal(calls, 2, 'each representation fetched once');
  t.notDeepEqual(a, b, 'distinct representations');
  const a2 = await io.get(url);
  const b2 = await io.get(url, null, {accept: 'text/x-alt'});
  t.equal(calls, 2, 'both variants served from the cache');
  t.deepEqual(a2, a, 'default variant preserved');
  t.deepEqual(b2, b, 'alternate variant preserved');
  reset();
});

test('track dedups per representation, not per URL', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  const url = 'https://example.com/rep-dedup';
  const [a, b, c] = await Promise.all([
    io.get(url),
    io.get(url, null, {accept: 'text/x-alt'}),
    io.get(url, null, {accept: 'text/x-alt'})
  ]);
  t.equal(calls, 2, 'one request per representation');
  t.notDeepEqual(a, b, 'different accepts did not share an envelope');
  t.deepEqual(b, c, 'same accept shared one request');
  reset();
});

test('an explicit application/json is the same identity as the default', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  const url = 'https://example.com/normalized';
  const [a, b] = await Promise.all([io.get(url), io.get(url, null, {accept: 'application/json'})]);
  t.equal(calls, 1, 'the prepared default and an explicit accept dedup together');
  t.deepEqual(a, b, 'one shared representation');
  const c = await io.get(url, null, {headers: {Accept: 'application/json'}});
  t.equal(calls, 1, 'a header-spelled accept hits the same cache entry');
  t.deepEqual(c, a, 'served from the cache');
  reset();
});

test('a response Vary mismatch is a cache miss', async t => {
  let calls = 0;
  serve(request => {
    ++calls;
    return json({tenant: request.headers.get('x-tenant')}, {headers: {vary: 'X-Tenant'}});
  });
  const url = 'https://example.com/tenants';
  const a = await io.get(url, null, {headers: {'x-tenant': 'a'}});
  t.deepEqual(a, {tenant: 'a'}, 'first tenant fetched');
  const b = await io.get(url, null, {headers: {'x-tenant': 'b'}});
  t.equal(calls, 2, 'a different selecting header refetches');
  t.deepEqual(b, {tenant: 'b'}, 'never served another tenant’s body');
  const b2 = await io.get(url, null, {headers: {'x-tenant': 'b'}});
  t.equal(calls, 2, 'the stored variant serves its own tenant');
  t.deepEqual(b2, {tenant: 'b'}, 'correct body from the cache');
  const a2 = await io.get(url, null, {headers: {'x-tenant': 'a'}});
  t.equal(calls, 3, 'one variant per key: the overwritten tenant refetches');
  t.deepEqual(a2, {tenant: 'a'}, 'refetched, not mis-served');
  reset();
});

test('Vary: * is never stored', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}, {headers: {vary: '*'}}));
  const url = 'https://example.com/uncacheable';
  await io.get(url);
  await io.get(url);
  t.equal(calls, 2, 'every request goes to the network');
  reset();
});

test('removing an exact URL evicts all of its accept variants', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  const url = 'https://example.com/evict';
  await io.get(url);
  await io.get(url, null, {accept: 'text/x-alt'});
  t.equal(calls, 2, 'two variants stored');
  await io.cache.remove(url);
  await io.get(url);
  await io.get(url, null, {accept: 'text/x-alt'});
  t.equal(calls, 4, 'both variants were evicted');
  reset();
});

test('a custom decode opts out of dedup; the cache stays byte-level', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  const url = 'https://example.com/decoded';
  const [a, b] = await Promise.all([io.get(url), io.get(url, null, {decode: 'text'})]);
  t.equal(calls, 2, 'a decode-divergent GET is not deduped');
  t.equal(typeof a, 'object', 'the plain caller got parsed data');
  t.equal(typeof b, 'string', 'the decode caller got its own representation');
  await io.cache.idle();
  const c = await io.get(url, null, {decode: 'text'});
  t.equal(calls, 2, 'the cache serves stored bytes to any decode');
  t.equal(typeof c, 'string', 'decoded per request from the same bytes');
  reset();
});

test('adopt seeds the variant its target names', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  const url = 'https://example.com/adopt-variant';
  await io.adopt({url, accept: 'text/x-alt'}, json({from: 'prefetch'}));
  await io.cache.idle();
  const alt = await io.get(url, null, {accept: 'text/x-alt'});
  t.equal(calls, 0, 'the matching representation is served from the adopted entry');
  t.deepEqual(alt, {from: 'prefetch'}, 'adopted body');
  const plain = await io.get(url);
  t.equal(calls, 1, 'the default representation is a different identity — fetched');
  t.deepEqual(plain, {from: 'network', n: 1}, 'network body');
  reset();
});
