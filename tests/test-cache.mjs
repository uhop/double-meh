import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

test('cache:true serves a stored GET without re-fetching', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  const a = await io.get('https://example.com/c', null, {cache: true});
  const b = await io.get('https://example.com/c', null, {cache: true});
  t.equal(calls, 1, 'second GET served from cache');
  t.deepEqual(a, {n: 1}, 'first body');
  t.deepEqual(b, {n: 1}, 'cached body on the second call');
  reset();
});

test('without the cache flag nothing is cached', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  await io.get('https://example.com/n');
  await io.get('https://example.com/n');
  t.equal(calls, 2, 'no caching unless opted in');
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

test('cache.remove evicts an entry so the next GET refetches', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  await io.get('https://example.com/users/42', null, {cache: true});
  await io.cache.remove('https://example.com/users/42');
  await io.get('https://example.com/users/42', null, {cache: true});
  t.equal(calls, 2, 'removed entry refetched');
  reset();
});

test('cache.remove with a trailing * evicts by prefix', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  await io.get('https://example.com/users/1', null, {cache: true});
  await io.get('https://example.com/users/2', null, {cache: true});
  await io.cache.remove('https://example.com/users/*');
  await io.get('https://example.com/users/1', null, {cache: true});
  t.equal(calls, 3, 'both evicted by prefix; the refetch is a 3rd call');
  reset();
});

test('adopt pre-populates the cache: a later cache:true read hits without a network call', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  await io.adopt('https://example.com/cf', json({from: 'prefetch'}));
  const data = await io.get('https://example.com/cf', null, {cache: true});
  t.equal(calls, 0, 'served from the cache that adopt populated');
  t.deepEqual(data, {from: 'prefetch'}, 'the adopted body, durable past the in-flight window');
  reset();
});

test('non-2xx responses are not cached', async t => {
  let calls = 0;
  serve(() => json({oops: true, n: ++calls}, {status: 500}));
  await io.get('https://example.com/e', null, {cache: true, ignoreBadStatus: true});
  await io.get('https://example.com/e', null, {cache: true, ignoreBadStatus: true});
  t.equal(calls, 2, 'errors are passed through, never stored');
  reset();
});
