import test from 'tape-six';

import {indexedDbStorage} from '../src/storage/indexed-db.js';

const hasIndexedDb = typeof indexedDB !== 'undefined';
const uniqueName = () => 'dm-test-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

const bytes = buffer => Array.from(new Uint8Array(buffer));

const entry = (body, extra = {}) => ({
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'application/json']],
  body: new TextEncoder().encode(body).buffer,
  expiresAt: Infinity,
  ...extra
});

test(
  'indexed-db storage: set/get roundtrip preserves the entry',
  {skip: !hasIndexedDb},
  async t => {
    const storage = indexedDbStorage({name: uniqueName()});
    await storage.set(
      'GET https://example.com/a',
      entry('{"a":1}', {
        etag: '"v1"',
        lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT',
        vary: {'x-tenant': 'a'}
      })
    );
    const got = await storage.get('GET https://example.com/a');
    t.ok(got, 'entry retrieved');
    t.equal(got.status, 200, 'status preserved');
    t.equal(got.statusText, 'OK', 'statusText preserved');
    t.equal(got.etag, '"v1"', 'etag preserved');
    t.equal(got.lastModified, 'Wed, 21 Oct 2026 07:28:00 GMT', 'lastModified preserved');
    t.equal(got.expiresAt, Infinity, 'Infinity survives with no sentinel');
    t.deepEqual(got.vary, {'x-tenant': 'a'}, 'vary snapshot preserved');
    t.deepEqual(got.headers, [['content-type', 'application/json']], 'headers preserved');
    t.equal(new TextDecoder().decode(got.body), '{"a":1}', 'body preserved');
  }
);

test('indexed-db storage: a binary body needs no encoding', {skip: !hasIndexedDb}, async t => {
  const storage = indexedDbStorage({name: uniqueName()});
  const raw = new Uint8Array([0, 1, 2, 250, 251, 255]).buffer; // not valid UTF-8
  await storage.set('GET https://example.com/bin', entry('', {body: raw}));
  const got = await storage.get('GET https://example.com/bin');
  t.deepEqual(bytes(got.body), [0, 1, 2, 250, 251, 255], 'every byte survives');
  t.ok(got.body instanceof ArrayBuffer, 'still an ArrayBuffer');
});

test('indexed-db storage: vary is three-state', {skip: !hasIndexedDb}, async t => {
  const storage = indexedDbStorage({name: uniqueName()});
  await storage.set('a', entry('{}', {vary: null})); // Vary: * — uncacheable
  await storage.set('b', entry('{}')); // no Vary at all
  t.equal((await storage.get('a')).vary, null, 'null vary stays null');
  t.equal((await storage.get('b')).vary, undefined, 'absent vary stays absent');
});

test('indexed-db storage: a finite expiry survives as a number', {skip: !hasIndexedDb}, async t => {
  const storage = indexedDbStorage({name: uniqueName()});
  const when = Date.now() + 60_000;
  await storage.set('a', entry('{}', {expiresAt: when}));
  t.equal((await storage.get('a')).expiresAt, when, 'exact millisecond preserved');
});

test('indexed-db storage: a miss is undefined', {skip: !hasIndexedDb}, async t => {
  const storage = indexedDbStorage({name: uniqueName()});
  t.equal(await storage.get('GET https://example.com/nope'), undefined, 'absent key');
});

test('indexed-db storage: set overwrites an existing key', {skip: !hasIndexedDb}, async t => {
  const storage = indexedDbStorage({name: uniqueName()});
  await storage.set('a', entry('{"v":1}'));
  await storage.set('a', entry('{"v":2}'));
  t.equal(new TextDecoder().decode((await storage.get('a')).body), '{"v":2}', 'second write wins');
  t.deepEqual(await storage.keys(), ['a'], 'no duplicate key');
});

test('indexed-db storage: keys, delete and clear', {skip: !hasIndexedDb}, async t => {
  const storage = indexedDbStorage({name: uniqueName()});
  await storage.set('a', entry('{}'));
  await storage.set('b', entry('{}'));
  await storage.set('c', entry('{}'));
  t.deepEqual((await storage.keys()).sort(), ['a', 'b', 'c'], 'keys lists everything stored');
  await storage.delete('b');
  t.deepEqual((await storage.keys()).sort(), ['a', 'c'], 'delete removes one');
  t.equal(await storage.get('b'), undefined, 'the deleted entry is gone');
  await storage.clear();
  t.deepEqual(await storage.keys(), [], 'clear empties the store');
});

test('indexed-db storage: two names are separate stores', {skip: !hasIndexedDb}, async t => {
  const one = indexedDbStorage({name: uniqueName()});
  const two = indexedDbStorage({name: uniqueName()});
  await one.set('a', entry('{"from":"one"}'));
  t.equal(await two.get('a'), undefined, 'the database is the namespace');
  await two.clear();
  t.ok(await one.get('a'), 'clearing one does not touch the other');
});
