import test from 'tape-six';

import {create} from '../../src/index.js';
import {cacheApiStorage} from '../../src/storage/cache-api.js';

const hasCacheApi = typeof caches !== 'undefined';
const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

test(
  'web: Cache API backend serves a repeat GET without a network hit',
  {skip: !hasCacheApi},
  async t => {
    const name = 'dm-web-' + unique();
    const scope = 'wc-' + unique();
    const io = create();
    io.cache.storage = cacheApiStorage({name});
    const url = '/--io/etag?scope=' + scope;
    const a = await io.get(url);
    const b = await io.get(url);
    t.deepEqual(b, a, 'second GET served from the Cache API');
    const counters = await io.get('/--io/counters?scope=' + scope, null, {cache: false});
    t.equal(counters.etag, 1, 'exactly one server hit');
    await caches.delete(name);
  }
);

test(
  'web: entries survive across instances — the reload analogue',
  {skip: !hasCacheApi},
  async t => {
    const name = 'dm-web-' + unique();
    const scope = 'wr-' + unique();
    const url = '/--io/etag?scope=' + scope;
    const one = create();
    one.cache.storage = cacheApiStorage({name});
    const a = await one.get(url);
    const two = create();
    two.cache.storage = cacheApiStorage({name});
    const b = await two.get(url);
    t.deepEqual(b, a, 'a fresh instance reads the persisted entry');
    const counters = await two.get('/--io/counters?scope=' + scope, null, {cache: false});
    t.equal(counters.etag, 1, 'the second instance never hit the server');
    await caches.delete(name);
  }
);

test('web: expired entries revalidate and reuse the body on 304', {skip: !hasCacheApi}, async t => {
  const name = 'dm-web-' + unique();
  const scope = 'w3-' + unique();
  const io = create();
  io.cache.storage = cacheApiStorage({name});
  const url = '/--io/etag?scope=' + scope;
  const a = await io.get(url, null, {cache: {ttl: 0}});
  const b = await io.get(url, null, {cache: {ttl: 0}});
  t.deepEqual(b, a, 'cached body reused on 304');
  const counters = await io.get('/--io/counters?scope=' + scope, null, {cache: false});
  t.equal(counters.etag, 2, 'the second GET revalidated with the server');
  await caches.delete(name);
});

test(
  'web: adopt seeds the Cache API; a bare GET never touches the network',
  {skip: !hasCacheApi},
  async t => {
    const name = 'dm-web-' + unique();
    const scope = 'wa-' + unique();
    const io = create();
    io.cache.storage = cacheApiStorage({name});
    const url = '/--io/etag?scope=' + scope;
    const adopted = new Response(JSON.stringify({version: 99, data: {adopted: true}}), {
      headers: {'content-type': 'application/json'}
    });
    await io.adopt(url, adopted);
    await io.cache.idle();
    const data = await io.get(url);
    t.equal(data.version, 99, 'served from the adopted entry');
    const counters = await io.get('/--io/counters?scope=' + scope, null, {cache: false});
    t.equal(counters.etag, undefined, 'the etag route was never hit');
    await caches.delete(name);
  }
);
