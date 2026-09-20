import test from 'tape-six';
import {io, json, serve, reset} from './helper.js';

const quotaError = () => {
  const error = new Error('quota');
  error.name = 'QuotaExceededError';
  return error;
};

const entryAt = (expiresAt, bytes) => ({
  status: 200,
  statusText: 'OK',
  headers: [],
  body: new ArrayBuffer(bytes),
  expiresAt
});

// a memory store whose writes fail on demand: `fail(nth)` returns an error or null
const rigged = () => {
  const map = new Map();
  const state = {sets: 0, fail: () => null};
  return {
    state,
    map,
    get: key => map.get(key),
    set: (key, entry) => {
      const error = state.fail(++state.sets);
      if (error) throw error;
      map.set(key, entry);
    },
    delete: key => void map.delete(key),
    clear: () => map.clear(),
    keys: () => [...map.keys()]
  };
};

const withStorage = async (storage, body) => {
  const saved = io.cache.storage;
  io.cache.storage = storage;
  try {
    await body();
  } finally {
    io.cache.storage = saved;
    await reset();
  }
};

const collect = event => {
  const seen = [];
  const listener = info => seen.push(info);
  io.on(event, listener);
  return {seen, stop: () => io.off(event, listener)};
};

test('a full cache never fails the request', async t => {
  const storage = rigged();
  storage.state.fail = () => quotaError();
  let calls = 0;
  serve(() => json({n: ++calls}));
  await withStorage(storage, async () => {
    t.deepEqual(await io.get('https://example.com/q1'), {n: 1}, 'the response still arrives');
    t.deepEqual(await io.get('https://example.com/q1'), {n: 2}, 'nothing cached, so it refetches');
    t.equal(storage.map.size, 0, 'nothing stored');
  });
});

test('io.cache.save rejects with CacheFull when the store is full', async t => {
  const storage = rigged();
  storage.state.fail = () => quotaError();
  await withStorage(storage, async () => {
    let caught;
    try {
      await io.cache.save('https://example.com/q2', json({a: 1}));
    } catch (error) {
      caught = error;
    }
    t.ok(caught instanceof io.CacheFull, 'an explicit save rejects');
    t.ok(caught instanceof io.IOError, 'and stays in the IOError family');
    t.equal(caught.reason, 'quota', 'reason carried');
    t.equal(caught.key, io.makeKey({url: 'https://example.com/q2'}), 'key carried');
    t.ok(caught.cause, 'the backend error rides as the cause');
  });
});

test('maxEntryBytes refuses an oversized body without touching the backend', async t => {
  const storage = rigged();
  const saved = io.cache.maxEntryBytes;
  serve(() => json({big: 'xxxxxxxxxxxxxxxxxxxxxxxx'}));
  await withStorage(storage, async () => {
    io.cache.maxEntryBytes = 4;
    const reported = collect('cache-skip');
    try {
      t.ok(await io.get('https://example.com/q3'), 'the response still arrives');
      t.equal(storage.state.sets, 0, 'the backend was never asked');
      t.equal(reported.seen[0].reason, 'too-large', 'reported as too-large');
    } finally {
      reported.stop();
      io.cache.maxEntryBytes = saved;
    }
  });
});

test('a quota failure sweeps expired entries and retries', async t => {
  const storage = rigged();
  storage.state.fail = n => (n === 1 ? quotaError() : null);
  storage.map.set('stale', entryAt(Date.now() - 1000, 8));
  serve(() => json({n: 1}));
  await withStorage(storage, async () => {
    await io.get('https://example.com/q4');
    t.equal(storage.state.sets, 2, 'one failed write, then one retry');
    t.notOk(storage.map.has('stale'), 'the expired entry was swept');
    t.equal(storage.map.size, 1, 'the new entry landed');
  });
});

test('with nothing expired, the soonest-to-expire entry is evicted', async t => {
  const storage = rigged();
  storage.state.fail = n => (n === 1 ? quotaError() : null);
  storage.map.set('soon', entryAt(Date.now() + 1000, 64));
  storage.map.set('later', entryAt(Date.now() + 600000, 64));
  serve(() => json({n: 1}));
  await withStorage(storage, async () => {
    await io.get('https://example.com/q5');
    t.notOk(storage.map.has('soon'), 'the nearest-to-expiry entry went first');
    t.ok(storage.map.has('later'), 'the longer-lived entry survived');
    t.equal(storage.state.sets, 2, 'one failed write, then one retry');
  });
});

test('a refusal is reported on io.on("cache-skip")', async t => {
  const storage = rigged();
  storage.state.fail = () => quotaError();
  const reported = collect('cache-skip');
  serve(() => json({n: 1}));
  await withStorage(storage, async () => {
    await io.get('https://example.com/q6');
  });
  reported.stop();
  t.equal(reported.seen.length, 1, 'one event');
  const info = reported.seen[0];
  t.equal(info.reason, 'quota', 'reason');
  t.ok(info.bytes > 0, 'entry size, for a beacon to threshold on');
  t.equal(info.expired, 0, 'nothing expired to sweep');
  t.equal(info.evicted, 0, 'nothing to evict');
  t.ok(info.error, 'the backend error is attached');
  t.ok(info.key, 'the key is named');
});

test('a non-quota backend failure is reported, not thrown at the caller', async t => {
  const storage = rigged();
  storage.state.fail = () => new Error('the disk is on fire');
  const reported = collect('cache-skip');
  serve(() => json({n: 1}));
  await withStorage(storage, async () => {
    t.deepEqual(await io.get('https://example.com/q7'), {n: 1}, 'the response still arrives');
  });
  reported.stop();
  t.equal(reported.seen[0].reason, 'error', 'reported as an error, not as quota');
  t.equal(storage.state.sets, 1, 'no recovery ladder runs for a non-quota failure');
});
