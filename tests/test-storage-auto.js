import test from 'tape-six';

import {io} from './helper.js';
import {autoStorage} from '../src/storage/auto.js';
import {memoryStorage} from '../src/storage/memory.js';
import {defaultCandidates} from '../src/storage/candidates.js';

const entry = (bytes = 8) => ({
  status: 200,
  statusText: 'OK',
  headers: [],
  body: new ArrayBuffer(bytes),
  expiresAt: Infinity
});

// a working backend that counts what it was asked to do
const counting = () => {
  const inner = memoryStorage();
  const calls = {set: 0, get: 0, keys: 0, delete: 0, clear: 0};
  return {
    calls,
    get: k => (++calls.get, inner.get(k)),
    set: (k, e) => (++calls.set, inner.set(k, e)),
    delete: k => (++calls.delete, inner.delete(k)),
    clear: () => (++calls.clear, inner.clear()),
    keys: () => (++calls.keys, inner.keys())
  };
};

const brokenOn = method => {
  const inner = memoryStorage();
  return {
    ...inner,
    [method]: () => {
      throw new Error(method + ' is not available here');
    }
  };
};

test('auto storage: picks the first candidate that works', async t => {
  const winner = counting();
  const picked = [];
  const storage = autoStorage([() => brokenOn('set'), () => winner, memoryStorage], {
    onPick: (_, index) => picked.push(index)
  });
  await storage.set('a', entry());
  t.deepEqual(picked, [1], 'the second candidate won, and its index was reported');
  t.equal(await storage.chosen(), winner, 'chosen() names it');
  t.deepEqual(await storage.keys(), ['a'], 'operations reach the winner');
});

test('auto storage: a factory that throws is skipped', async t => {
  const winner = counting();
  const storage = autoStorage([
    () => {
      throw new Error('no such global here');
    },
    () => winner
  ]);
  await storage.set('a', entry());
  t.equal(await storage.chosen(), winner, 'the throwing factory did not stop the ladder');
});

test('auto storage: a backend whose keys() throws is rejected', async t => {
  // Deno ships a Cache API with no keys(), and sweep and remove both need it
  const winner = counting();
  const storage = autoStorage([() => brokenOn('keys'), () => winner]);
  await storage.set('a', entry());
  t.equal(await storage.chosen(), winner, 'writable but unlistable is not good enough');
});

test('auto storage: a backend whose get() throws is rejected', async t => {
  const winner = counting();
  const storage = autoStorage([() => brokenOn('get'), () => winner]);
  await storage.set('a', entry());
  t.equal(await storage.chosen(), winner, 'write-only is not good enough');
});

test('auto storage: the probe leaves nothing behind', async t => {
  const winner = counting();
  const storage = autoStorage([() => winner]);
  await storage.set('real', entry());
  t.deepEqual(await storage.keys(), ['real'], 'only the real entry remains');
});

test('auto storage: selection happens once, on first use', async t => {
  let made = 0;
  const winner = counting();
  const storage = autoStorage([
    () => {
      ++made;
      return winner;
    }
  ]);
  t.equal(made, 0, 'nothing is chosen until the cache is actually used');
  await storage.set('a', entry());
  await storage.get('a');
  await storage.keys();
  await storage.delete('a');
  await storage.clear();
  t.equal(made, 1, 'the ladder ran exactly once across five operations');
});

test('auto storage: an async factory is awaited', async t => {
  const winner = counting();
  const storage = autoStorage([async () => winner]);
  await storage.set('a', entry());
  t.equal(await storage.chosen(), winner, 'a promise-returning factory works');
});

test('auto storage: nothing usable is a loud failure, not a silent memory cache', async t => {
  const storage = autoStorage([() => brokenOn('set'), () => brokenOn('get')]);
  let caught;
  try {
    await storage.set('a', entry());
  } catch (error) {
    caught = error;
  }
  t.ok(caught, 'it throws rather than quietly degrading');
  t.ok(/memoryStorage/.test(caught.message), 'and the message says how to guarantee a rung');
});

test('auto storage: every method forwards to the winner', async t => {
  const winner = counting();
  const storage = autoStorage([() => winner]);
  await storage.set('a', entry());
  await storage.get('a');
  await storage.keys();
  await storage.delete('a');
  await storage.clear();
  // the probe adds one set / get / keys / delete of its own before any of these
  t.equal(winner.calls.set, 2, 'set forwarded');
  t.equal(winner.calls.get, 2, 'get forwarded');
  t.equal(winner.calls.keys, 2, 'keys forwarded');
  t.equal(winner.calls.delete, 2, 'delete forwarded');
  t.equal(winner.calls.clear, 1, 'clear forwarded');
});

test('the default cache storage is the ladder, and it reports its choice', async t => {
  const dm = io.create();
  const seen = [];
  dm.on('cache-backend', event => seen.push(event));
  t.equal(dm.cache.backend, undefined, 'nothing is probed before the cache is used');

  const picked = await dm.cache.storage.chosen();
  t.ok(picked && typeof picked.get === 'function', 'a backend was chosen');
  t.equal(seen.length, 1, 'the choice was announced once');
  t.equal(seen[0].backend, dm.cache.backend, 'the event and the property agree');

  const browser = typeof window !== 'undefined';
  t.equal(
    seen[0].backend,
    browser ? 'indexedDb' : 'memory',
    browser ? 'a browser lands on IndexedDB' : 'a CLI runtime lands on memory'
  );

  await dm.cache.storage.set('k', {
    status: 200,
    statusText: 'OK',
    headers: [],
    body: new ArrayBuffer(4),
    expiresAt: Date.now() + 60000
  });
  t.ok(await dm.cache.storage.get('k'), 'and it round-trips through the ladder');
  await dm.cache.storage.clear();
});

test('the browser tier is skipped where a store would be process-wide', async t => {
  // Node 26 exposes a process-global sessionStorage and Deno exposes caches, so presence alone
  // would hand a CLI a store every instance in the process shares
  const browser = typeof window !== 'undefined';
  const picks = [];
  for (const candidate of defaultCandidates) picks.push(await candidate());
  const chosenNames = defaultCandidates
    .filter((_, i) => picks[i] !== undefined)
    .map(candidate => candidate.name);
  if (browser) {
    t.ok(chosenNames.includes('indexedDb'), 'a browser offers IndexedDB');
  } else {
    t.deepEqual(chosenNames, ['memory'], 'a CLI runtime offers memory alone');
  }
});
