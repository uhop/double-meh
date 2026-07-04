import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

test('GETs are cached by default; cache:false opts out', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  const a = await io.get('https://example.com/c');
  const b = await io.get('https://example.com/c');
  t.equal(calls, 1, 'second GET served from cache by default');
  t.deepEqual(a, {n: 1}, 'first body');
  t.deepEqual(b, {n: 1}, 'cached body on the second call');
  await io.get('https://example.com/c', null, {cache: false});
  t.equal(calls, 2, 'cache:false bypasses the cache');
  reset();
});

test('io.cache.theDefault scopes default caching', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  const saved = io.cache.theDefault;
  io.cache.theDefault = options => String(options.url).startsWith('https://cached.example/');
  await io.get('https://uncached.example/x');
  await io.get('https://uncached.example/x');
  t.equal(calls, 2, 'outside the predicate nothing is cached');
  await io.get('https://cached.example/x');
  await io.get('https://cached.example/x');
  t.equal(calls, 3, 'inside the predicate the second GET hits the cache');
  io.cache.theDefault = saved;
  reset();
});

test('an entry past its ttl is refetched', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  await io.get('https://example.com/t', null, {cache: {ttl: 0}});
  await io.get('https://example.com/t', null, {cache: {ttl: 0}});
  t.equal(calls, 2, 'expired entry (ttl 0) refetched');
  reset();
});

test('a stale entry with an ETag revalidates and reuses the body on 304', async t => {
  let calls = 0;
  serve(request => {
    ++calls;
    return request.headers.get('if-none-match') === '"v1"'
      ? new Response(null, {status: 304})
      : json({v: 1}, {headers: {etag: '"v1"'}});
  });
  await io.get('https://example.com/r', null, {cache: {ttl: 0}});
  const b = await io.get('https://example.com/r', null, {cache: {ttl: 0}});
  t.equal(calls, 2, 'revalidated with a conditional request');
  t.deepEqual(b, {v: 1}, 'served the cached body on 304');
  reset();
});

test('a 304 refreshes the stored headers', async t => {
  let calls = 0;
  serve(request => {
    ++calls;
    return request.headers.get('if-none-match') === '"v1"'
      ? new Response(null, {status: 304, headers: {'x-fresh': 'yes'}})
      : json({v: 1}, {headers: {etag: '"v1"', 'x-fresh': 'no'}});
  });
  await io.get('https://example.com/rf', null, {cache: {ttl: 0}});
  const env = await io.full.get('https://example.com/rf', null, {cache: {ttl: 0}});
  t.equal(calls, 2, 'revalidated');
  t.equal(env.headers['x-fresh'], 'yes', '304 headers merged into the stored entry');
  reset();
});

test('cache.remove evicts an entry so the next GET refetches', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  await io.get('https://example.com/users/42');
  await io.cache.remove('https://example.com/users/42');
  await io.get('https://example.com/users/42');
  t.equal(calls, 2, 'removed entry refetched');
  reset();
});

test('cache.remove with a trailing * evicts by prefix', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  await io.get('https://example.com/users/1');
  await io.get('https://example.com/users/2');
  await io.cache.remove('https://example.com/users/*');
  await io.get('https://example.com/users/1');
  t.equal(calls, 3, 'both evicted by prefix; the refetch is a 3rd call');
  reset();
});

test('adopt pre-populates the cache: a later bare GET hits without a network call', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  await io.adopt('https://example.com/cf', json({from: 'prefetch'}));
  await io.cache.idle();
  const data = await io.get('https://example.com/cf');
  t.equal(calls, 0, 'served from the cache that adopt populated');
  t.deepEqual(data, {from: 'prefetch'}, 'the adopted body, durable past the in-flight window');
  reset();
});

test('bust skips the cache and uniquifies the URL', async t => {
  let calls = 0;
  const urls = [];
  serve(request => {
    urls.push(request.url);
    return json({n: ++calls});
  });
  await io.get('https://example.com/b', null, {bust: true});
  await io.get('https://example.com/b', null, {bust: true});
  t.equal(calls, 2, 'busted requests are never cached');
  t.ok(urls[0].includes('io-bust='), 'bust parameter appended');
  t.notEqual(urls[0], urls[1], 'each request gets a fresh bust value');
  reset();
});

test('non-2xx responses are not cached', async t => {
  let calls = 0;
  serve(() => json({oops: true, n: ++calls}, {status: 500}));
  await io.get('https://example.com/e', null, {ignoreBadStatus: true});
  await io.get('https://example.com/e', null, {ignoreBadStatus: true});
  t.equal(calls, 2, 'errors are passed through, never stored');
  reset();
});
