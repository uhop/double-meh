import test from 'tape-six';

import {webStorage} from '../src/storage/web-storage.js';

// a Storage-shaped fake, so the logic is exercised on every runtime, not only in a browser
const fakeStore = () => {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: k => void map.delete(k),
    clear: () => map.clear(),
    _raw: map
  };
};

const entry = (body, extra = {}) => ({
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'application/json']],
  body: typeof body === 'string' ? new TextEncoder().encode(body).buffer : body,
  expiresAt: Infinity,
  ...extra
});

test('web storage: set/get roundtrip preserves the entry', async t => {
  const store = fakeStore();
  const storage = webStorage({store});
  storage.set(
    'GET https://example.com/a',
    entry('{"a":1}', {
      etag: '"v1"',
      lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT',
      vary: {'x-tenant': 'a'}
    })
  );
  const got = storage.get('GET https://example.com/a');
  t.equal(got.status, 200, 'status');
  t.equal(got.statusText, 'OK', 'statusText');
  t.equal(got.etag, '"v1"', 'etag');
  t.equal(got.lastModified, 'Wed, 21 Oct 2026 07:28:00 GMT', 'lastModified');
  t.equal(got.expiresAt, Infinity, 'Infinity survives the JSON null sentinel');
  t.deepEqual(got.vary, {'x-tenant': 'a'}, 'vary snapshot');
  t.deepEqual(got.headers, [['content-type', 'application/json']], 'headers');
  t.equal(new TextDecoder().decode(got.body), '{"a":1}', 'body');
});

test('web storage: a binary body survives base64', async t => {
  const store = fakeStore();
  const storage = webStorage({store});
  const raw = new Uint8Array([0, 1, 2, 250, 251, 255]).buffer;
  storage.set('k', entry(raw));
  t.deepEqual(
    [...new Uint8Array(storage.get('k').body)],
    [0, 1, 2, 250, 251, 255],
    'every byte survives'
  );
});

test('web storage: a large body does not overflow the stack', async t => {
  const store = fakeStore();
  const storage = webStorage({store});
  const big = new Uint8Array(300_000).map((_, i) => i & 0xff);
  storage.set('big', entry(big.buffer));
  const got = new Uint8Array(storage.get('big').body);
  t.equal(got.length, 300_000, 'round-tripped whole');
  t.equal(got[299_999], 299_999 & 0xff, 'last byte intact');
});

test('web storage: vary is three-state', async t => {
  const store = fakeStore();
  const storage = webStorage({store});
  storage.set('a', entry('{}', {vary: null})); // Vary: * — uncacheable
  storage.set('b', entry('{}')); // no Vary at all
  t.equal(storage.get('a').vary, null, 'null stays null');
  t.equal(storage.get('b').vary, undefined, 'absent stays absent');
});

test('web storage: a finite expiry survives as a number', async t => {
  const store = fakeStore();
  const storage = webStorage({store});
  const when = Date.now() + 60_000;
  storage.set('a', entry('{}', {expiresAt: when}));
  t.equal(storage.get('a').expiresAt, when, 'exact millisecond');
});

test('web storage: the name is a key prefix, and clear spares everything else', async t => {
  const store = fakeStore();
  const mine = webStorage({store, name: 'app-cache'});
  const other = webStorage({store, name: 'other'});
  store.setItem('app.token', 'keep-me'); // the application's own key
  mine.set('a', entry('{}'));
  mine.set('b', entry('{}'));
  other.set('a', entry('{}'));
  t.deepEqual(mine.keys().sort(), ['a', 'b'], 'keys are unprefixed and only ours');
  mine.clear();
  t.deepEqual(mine.keys(), [], 'ours are gone');
  t.deepEqual(other.keys(), ['a'], 'the other namespace is untouched');
  t.equal(store.getItem('app.token'), 'keep-me', "the app's own key survives");
});

test('web storage: delete removes one, and a miss is undefined', async t => {
  const store = fakeStore();
  const storage = webStorage({store});
  storage.set('a', entry('{}'));
  storage.set('b', entry('{}'));
  storage.delete('a');
  t.equal(storage.get('a'), undefined, 'deleted');
  t.ok(storage.get('b'), 'the other stayed');
  t.equal(storage.get('never-stored'), undefined, 'a miss is undefined');
});

test('web storage: corrupt or foreign records degrade to a miss', async t => {
  const store = fakeStore();
  const storage = webStorage({store});
  store.setItem('double-meh:bad-json', 'not json at all');
  store.setItem('double-meh:wrong-version', JSON.stringify({v: 2, enc: 'base64'}));
  store.setItem('double-meh:wrong-encoding', JSON.stringify({v: 1, enc: 'latin1'}));
  t.equal(storage.get('bad-json'), undefined, 'unparseable');
  t.equal(storage.get('wrong-version'), undefined, 'a future format');
  t.equal(storage.get('wrong-encoding'), undefined, 'a future body encoding');
});

test('web storage: a full store throws for the cache to catch', async t => {
  const store = fakeStore();
  store.setItem = () => {
    const error = new Error('quota');
    error.name = 'QuotaExceededError';
    throw error;
  };
  const storage = webStorage({store});
  let caught;
  try {
    storage.set('a', entry('{}'));
  } catch (error) {
    caught = error;
  }
  t.equal(caught && caught.name, 'QuotaExceededError', 'the error reaches the cache unchanged');
});

const hasSession = typeof sessionStorage !== 'undefined';

test('web storage: the real sessionStorage', {skip: !hasSession}, async t => {
  const name = 'dm-test-' + Math.random().toString(36).slice(2);
  const storage = webStorage({name});
  storage.set('GET https://example.com/real', entry('{"real":true}'));
  const got = storage.get('GET https://example.com/real');
  t.equal(new TextDecoder().decode(got.body), '{"real":true}', 'round-trips through the platform');
  t.deepEqual(storage.keys(), ['GET https://example.com/real'], 'keys from the real store');
  storage.clear();
  t.deepEqual(storage.keys(), [], 'cleared');
});
