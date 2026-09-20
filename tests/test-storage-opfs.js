import test from 'tape-six';

import {opfsStorage} from '../src/storage/opfs.js';

// the main-thread write path needs createWritable(); the read side is much older
const hasOpfs =
  typeof navigator !== 'undefined' &&
  navigator.storage &&
  typeof navigator.storage.getDirectory === 'function' &&
  typeof FileSystemFileHandle !== 'undefined' &&
  typeof FileSystemFileHandle.prototype.createWritable === 'function';

const uniqueName = () => 'dm-test-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

const entry = (body, extra = {}) => ({
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'application/json']],
  body: typeof body === 'string' ? new TextEncoder().encode(body).buffer : body,
  expiresAt: Infinity,
  ...extra
});

test('opfs storage: set/get roundtrip preserves the entry', {skip: !hasOpfs}, async t => {
  const storage = opfsStorage({name: uniqueName()});
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
  t.equal(got.status, 200, 'status');
  t.equal(got.etag, '"v1"', 'etag');
  t.equal(got.lastModified, 'Wed, 21 Oct 2026 07:28:00 GMT', 'lastModified');
  t.equal(got.expiresAt, Infinity, 'Infinity survives the null sentinel');
  t.deepEqual(got.vary, {'x-tenant': 'a'}, 'vary snapshot');
  t.deepEqual(got.headers, [['content-type', 'application/json']], 'headers');
  t.equal(new TextDecoder().decode(got.body), '{"a":1}', 'body');
});

test('opfs storage: a binary body is stored as bytes', {skip: !hasOpfs}, async t => {
  const storage = opfsStorage({name: uniqueName()});
  const raw = new Uint8Array([0, 1, 2, 10, 250, 255]).buffer; // includes the 0x0a the meta line ends on
  await storage.set('k', entry(raw));
  t.deepEqual(
    [...new Uint8Array((await storage.get('k')).body)],
    [0, 1, 2, 10, 250, 255],
    'a newline byte inside the body does not confuse the framing'
  );
});

test('opfs storage: a large body round-trips', {skip: !hasOpfs}, async t => {
  const storage = opfsStorage({name: uniqueName()});
  const big = new Uint8Array(300_000).map((_, i) => i & 0xff);
  await storage.set('big', entry(big.buffer));
  const got = new Uint8Array((await storage.get('big')).body);
  t.equal(got.length, 300_000, 'whole');
  t.equal(got[299_999], 299_999 & 0xff, 'last byte intact');
});

test('opfs storage: vary is three-state', {skip: !hasOpfs}, async t => {
  const storage = opfsStorage({name: uniqueName()});
  await storage.set('a', entry('{}', {vary: null}));
  await storage.set('b', entry('{}'));
  t.equal((await storage.get('a')).vary, null, 'null stays null');
  t.equal((await storage.get('b')).vary, undefined, 'absent stays absent');
});

test('opfs storage: a miss is undefined and set overwrites', {skip: !hasOpfs}, async t => {
  const storage = opfsStorage({name: uniqueName()});
  t.equal(await storage.get('nope'), undefined, 'absent key');
  await storage.set('a', entry('{"v":1}'));
  await storage.set('a', entry('{"v":2}'));
  t.equal(new TextDecoder().decode((await storage.get('a')).body), '{"v":2}', 'second write wins');
  t.deepEqual(await storage.keys(), ['a'], 'no duplicate file');
});

test('opfs storage: keys, delete and clear', {skip: !hasOpfs}, async t => {
  const storage = opfsStorage({name: uniqueName()});
  await storage.set('a', entry('{}'));
  await storage.set('b', entry('{}'));
  await storage.set('c', entry('{}'));
  t.deepEqual((await storage.keys()).sort(), ['a', 'b', 'c'], 'keys recovered from the files');
  await storage.delete('b');
  t.deepEqual((await storage.keys()).sort(), ['a', 'c'], 'delete removes one');
  await storage.clear();
  t.deepEqual(await storage.keys(), [], 'clear empties the directory');
});

test('opfs storage: the directory is the namespace', {skip: !hasOpfs}, async t => {
  const one = opfsStorage({name: uniqueName()});
  const two = opfsStorage({name: uniqueName()});
  await one.set('a', entry('{"from":"one"}'));
  t.equal(await two.get('a'), undefined, 'a second name sees nothing');
  await two.clear();
  t.ok(await one.get('a'), 'clearing one leaves the other alone');
});
