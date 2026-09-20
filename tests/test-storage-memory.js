import test from 'tape-six';

import {memoryStorage} from '../src/storage/memory.js';

const entry = bytes => ({
  status: 200,
  statusText: 'OK',
  headers: [],
  body: new ArrayBuffer(bytes),
  expiresAt: Infinity
});

test('memory storage: unbounded by default, and it accounts for what it holds', async t => {
  const storage = memoryStorage();
  t.equal(storage.bytes, 0, 'starts empty');
  storage.set('a', entry(100));
  storage.set('b', entry(200));
  t.equal(storage.bytes, 300, 'bytes tracks both bodies');
  t.deepEqual(storage.keys().sort(), ['a', 'b'], 'nothing was evicted');
});

test('memory storage: replacing a key adjusts the accounting', async t => {
  const storage = memoryStorage();
  storage.set('a', entry(100));
  storage.set('a', entry(40));
  t.equal(storage.bytes, 40, 'the old size was subtracted');
  t.deepEqual(storage.keys(), ['a'], 'still one entry');
});

test('memory storage: delete and clear reset the accounting', async t => {
  const storage = memoryStorage();
  storage.set('a', entry(100));
  storage.set('b', entry(50));
  storage.delete('a');
  t.equal(storage.bytes, 50, 'delete subtracts');
  storage.delete('missing');
  t.equal(storage.bytes, 50, 'deleting an absent key changes nothing');
  storage.clear();
  t.equal(storage.bytes, 0, 'clear resets');
});

test('memory storage: a cap evicts the least recently used', async t => {
  const storage = memoryStorage({maxBytes: 300});
  storage.set('a', entry(100));
  storage.set('b', entry(100));
  storage.set('c', entry(100));
  t.equal(storage.bytes, 300, 'full');
  storage.set('d', entry(100));
  t.deepEqual(storage.keys(), ['b', 'c', 'd'], 'the oldest went');
  t.equal(storage.bytes, 300, 'still at the cap, not over it');
});

test('memory storage: a read counts as use', async t => {
  const storage = memoryStorage({maxBytes: 300});
  storage.set('a', entry(100));
  storage.set('b', entry(100));
  storage.set('c', entry(100));
  storage.get('a'); // 'a' is now the most recent, so 'b' is the oldest
  storage.set('d', entry(100));
  t.deepEqual(storage.keys().sort(), ['a', 'c', 'd'], 'the entry that was read survived');
});

test('memory storage: one big entry evicts as many as it needs', async t => {
  const storage = memoryStorage({maxBytes: 300});
  storage.set('a', entry(100));
  storage.set('b', entry(100));
  storage.set('c', entry(100));
  storage.set('big', entry(250));
  // 250 of a 300 cap leaves 50, which fits none of the three
  t.deepEqual(storage.keys(), ['big'], 'all three were dropped to make room');
  t.equal(storage.bytes, 250, 'accounting holds');
});

test('memory storage: an entry larger than the cap is refused, not ruinous', async t => {
  const storage = memoryStorage({maxBytes: 300});
  storage.set('a', entry(100));
  let caught;
  try {
    storage.set('huge', entry(400));
  } catch (error) {
    caught = error;
  }
  t.equal(caught && caught.name, 'QuotaExceededError', 'the cache seam recognizes this by name');
  t.deepEqual(storage.keys(), ['a'], 'nothing was evicted for an entry that could never fit');
  t.equal(storage.bytes, 100, 'accounting untouched');
});
