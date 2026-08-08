import test from 'tape-six';
import 'tape-six-fast-check';

import {create} from '../../src/index.js';

const URLS = ['https://races.example/a', 'https://races.example/b', 'https://races.example/c'];

// every payload rides s.schedule(), so fast-check decides when each wire settles
const serveScheduled = (instance, s, url, served) =>
  instance.mock(url, () => {
    const tag = 'v' + (served.length + 1);
    served.push(tag);
    return s.schedule(Promise.resolve({tag}));
  });

// waitFor, never waitAll: each service layer costs a microtask hop, so nothing is
// scheduled yet at the point the callers are launched
const drain = (s, promises) => s.waitFor(Promise.all(promises));

test('concurrent identical GETs collapse to one flight per key', async t => {
  await t.scheduler(async s => {
    const instance = create();
    const hits = new Map(URLS.map(url => [url, 0]));
    for (const url of URLS) {
      instance.mock(url, () => {
        hits.set(url, hits.get(url) + 1);
        return s.schedule(Promise.resolve({url, n: hits.get(url)}));
      });
    }
    const callers = [];
    for (const url of URLS) {
      // cache off: without dedup each of these would be its own wire
      for (let i = 0; i < 3; ++i) {
        callers.push(instance.get(url, null, {cache: false}).then(data => ({url, data})));
      }
    }
    const results = await drain(s, callers);
    if (URLS.some(url => hits.get(url) !== 1)) return false;
    return results.every(({url, data}) => data.url === url && data.n === 1);
  }, "three keys in flight: one wire each, and every caller gets its own key's payload");
});

test('racing cache writers leave one whole payload behind', async t => {
  await t.scheduler(async s => {
    const instance = create();
    const [url] = URLS;
    const served = [];
    serveScheduled(instance, s, url, served);
    // track off: every caller is its own wire, so they race to write the same key
    const callers = [0, 1, 2, 3].map(() => instance.get(url, null, {track: false}));
    const results = await drain(s, callers);
    await instance.cache.idle();
    if (!results.every(data => served.includes(data.tag))) return false;
    // a populated cache answers this without reaching the mock
    instance.mock(url, () => ({tag: 'uncached'}));
    const final = await instance.get(url, null, {track: false});
    return served.includes(final.tag);
  }, 'every read is a served payload, and the cache keeps one of them intact');
});

test('eviction racing in-flight reads never yields a torn read', async t => {
  await t.scheduler(async s => {
    const instance = create();
    const [url] = URLS;
    const served = [];
    serveScheduled(instance, s, url, served);
    const callers = [0, 1, 2].map(() => instance.get(url, null, {track: false}));
    const evicted = s.schedule(Promise.resolve()).then(() => instance.cache.remove(url));
    const [results] = await drain(s, [Promise.all(callers), evicted]);
    await instance.cache.idle();
    return results.every(data => served.includes(data.tag));
  }, 'an eviction interleaved with in-flight reads still resolves every reader');
});
