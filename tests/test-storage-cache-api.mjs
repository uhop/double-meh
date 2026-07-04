import test from 'tape-six';

import {cacheApiStorage} from '../src/storage/cache-api.js';

const hasCacheApi = typeof caches !== 'undefined';
const uniqueName = () => 'dm-test-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

const entry = (body, extra = {}) => ({
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'application/json']],
  body: new TextEncoder().encode(body).buffer,
  expiresAt: Infinity,
  ...extra
});

test('cache-api storage: set/get roundtrip preserves the entry', {skip: !hasCacheApi}, async t => {
  const name = uniqueName();
  const storage = cacheApiStorage({name});
  // like toEntry, entry.etag mirrors the header — this backend derives it back from there
  await storage.set(
    'GET https://example.com/a',
    entry('{"a":1}', {
      etag: '"v1"',
      vary: {'x-tenant': 'a'},
      headers: [
        ['content-type', 'application/json'],
        ['etag', '"v1"']
      ]
    })
  );
  const got = await storage.get('GET https://example.com/a');
  t.ok(got, 'entry retrieved');
  t.equal(got.status, 200, 'status preserved');
  t.equal(got.etag, '"v1"', 'etag preserved');
  t.equal(got.expiresAt, Infinity, 'Infinity expiry survives the header roundtrip');
  t.deepEqual(got.vary, {'x-tenant': 'a'}, 'vary snapshot preserved');
  t.ok(
    got.headers.every(([header]) => !header.startsWith('x-io-')),
    'synthetic headers stripped'
  );
  t.equal(new TextDecoder().decode(got.body), '{"a":1}', 'body bytes preserved');
  await caches.delete(name);
});

test('cache-api storage: finite expiry roundtrips as a number', {skip: !hasCacheApi}, async t => {
  const name = uniqueName();
  const storage = cacheApiStorage({name});
  const expiresAt = Date.now() + 60000;
  await storage.set('GET https://example.com/t', entry('{"t":1}', {expiresAt}));
  const got = await storage.get('GET https://example.com/t');
  t.equal(got.expiresAt, expiresAt, 'expiresAt preserved');
  await caches.delete(name);
});

test('cache-api storage: get on a missing key returns undefined', {skip: !hasCacheApi}, async t => {
  const name = uniqueName();
  const storage = cacheApiStorage({name});
  t.equal(await storage.get('GET https://example.com/none'), undefined, 'miss is undefined');
  await caches.delete(name);
});

test('cache-api storage: delete removes an entry', {skip: !hasCacheApi}, async t => {
  const name = uniqueName();
  const storage = cacheApiStorage({name});
  await storage.set('GET https://example.com/d', entry('{"d":1}'));
  await storage.delete('GET https://example.com/d');
  t.equal(await storage.get('GET https://example.com/d'), undefined, 'deleted entry is a miss');
  await caches.delete(name);
});

test('cache-api storage: keys and clear (where implemented)', {skip: !hasCacheApi}, async t => {
  const name = uniqueName();
  const storage = cacheApiStorage({name});
  await storage.set('GET https://example.com/1', entry('{"n":1}'));
  await storage.set('GET https://example.com/2', entry('{"n":2}'));
  let keys;
  try {
    keys = await storage.keys();
  } catch {
    // Deno's Cache API has no keys(); prefix eviction and sweep need a browser there
    t.skip('cache.keys() not implemented on this runtime');
    await caches.delete(name);
    return;
  }
  t.deepEqual(
    keys.sort(),
    ['GET https://example.com/1', 'GET https://example.com/2'],
    'keys lists the original keys'
  );
  await storage.clear();
  t.deepEqual(await storage.keys(), [], 'clear removes everything');
  await caches.delete(name);
});
