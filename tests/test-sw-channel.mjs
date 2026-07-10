import test from 'tape-six';

import {io, json} from './helper.mjs';
import {makeWorker, makeContainer, tick} from './helper-sw.mjs';
import {installChannel, installSW} from '../src/sw.js';

const BASE = 'https://example.com';
const hasBC = typeof BroadcastChannel !== 'undefined';

let counter = 0;
const uniqueName = () => 'io-test-' + Date.now().toString(36) + '-' + ++counter;

const seed = async (dm, url, options) => {
  await dm.get(url, null, options);
  await dm.cache.idle();
  return dm.makeKey({url, ...options});
};

const held = (dm, key) => dm.cache.storage.get(key);

const evicted = async (dm, key) => {
  for (let i = 0; i < 100; ++i) {
    if (!(await held(dm, key))) return true;
    await tick();
  }
  return false;
};

test('channel: cross-tab invalidation without a SW', {skip: !hasBC}, async t => {
  const name = uniqueName();
  const a = io.create();
  const b = io.create();
  installChannel(a, {name, serviceWorker: null});
  installChannel(b, {name, serviceWorker: null});
  a.mock(
    () => true,
    () => json({tab: 'a'})
  );
  b.mock(
    () => true,
    () => json({tab: 'b'})
  );

  const url = BASE + '/shared/1';
  const keyA = await seed(a, url);
  const keyB = await seed(b, url);
  t.ok(await held(b, keyB), 'B holds the entry');

  await a.cache.remove(url);
  t.notOk(await held(a, keyA), 'A evicted locally');
  t.ok(await evicted(b, keyB), "A's removal evicted B across the channel");

  a.channel.close();
  b.channel.close();
});

test('channel: a trailing-* prefix evicts across tabs', {skip: !hasBC}, async t => {
  const name = uniqueName();
  const a = io.create();
  const b = io.create();
  installChannel(a, {name, serviceWorker: null});
  installChannel(b, {name, serviceWorker: null});
  a.mock(
    () => true,
    () => json({ok: 1})
  );
  b.mock(
    () => true,
    () => json({ok: 2})
  );

  const inside = await seed(b, BASE + '/api/users/1');
  const outside = await seed(b, BASE + '/other/1');

  await a.cache.remove(BASE + '/api/*');
  t.ok(await evicted(b, inside), 'the matching entry evicted');
  t.ok(await held(b, outside), 'the non-matching entry stayed');

  a.channel.close();
  b.channel.close();
});

test('channel: key-space RegExp removals stay local', {skip: !hasBC}, async t => {
  const name = uniqueName();
  const a = io.create();
  const b = io.create();
  installChannel(a, {name, serviceWorker: null});
  installChannel(b, {name, serviceWorker: null});
  a.mock(
    () => true,
    () => json({ok: 1})
  );
  b.mock(
    () => true,
    () => json({ok: 2})
  );

  const keyA = await seed(a, BASE + '/api/users/1');
  const keyB = await seed(b, BASE + '/api/users/1');

  await a.cache.remove(/users/);
  t.notOk(await held(a, keyA), 'A evicted locally');
  for (let i = 0; i < 10; ++i) await tick();
  t.ok(await held(b, keyB), 'B unaffected — key-space patterns do not cross');

  a.channel.close();
  b.channel.close();
});

test('channel: a connected SW is the fan-out hub', {skip: !hasBC}, async t => {
  const name = uniqueName();
  const dm = io.create();
  const worker = makeWorker();
  const container = makeContainer(worker);
  installSW(dm, {serviceWorker: container});
  await dm.sw.hello();
  installChannel(dm, {name, serviceWorker: container});
  dm.mock(
    () => true,
    () => json({ok: 1})
  );

  const url = BASE + '/hub/1';
  await seed(dm, url);

  const probe = new BroadcastChannel(name);
  const heard = [];
  probe.addEventListener('message', event => heard.push(event.data));

  await dm.cache.remove(url);
  const sent = worker.seen.find(message => message.type === 'io:invalidate');
  t.ok(sent, 'io:invalidate posted to the SW');
  t.equal(sent.pattern, url, 'the URL pattern rides the message');
  for (let i = 0; i < 10; ++i) await tick();
  t.equal(heard.length, 0, 'no direct broadcast — the connected SW fans out');

  // the hub's own fan-out coming back evicts locally without echo
  const again = await seed(dm, url);
  t.ok(await held(dm, again), 're-seeded');
  probe.postMessage({type: 'io:invalidated', pattern: url});
  t.ok(await evicted(dm, again), "the hub's io:invalidated evicts the local cache");
  for (let i = 0; i < 10; ++i) await tick();
  t.equal(heard.length, 0, 'no echo back onto the channel');

  probe.close();
  dm.channel.close();
});

test('channel: inbound eviction covers accept variants', {skip: !hasBC}, async t => {
  const name = uniqueName();
  const dm = io.create();
  installChannel(dm, {name, serviceWorker: null});
  dm.mock(
    () => true,
    () => json({ok: 1})
  );

  const url = BASE + '/variants/1';
  const base = await seed(dm, url);
  const variant = await seed(dm, url, {accept: 'text/csv'});
  t.notEqual(base, variant, 'two distinct keys');

  const probe = new BroadcastChannel(name);
  probe.postMessage({type: 'io:invalidated', pattern: url});
  t.ok(await evicted(dm, base), 'the base entry evicted');
  t.ok(await evicted(dm, variant), 'the accept variant evicted');

  probe.close();
  dm.channel.close();
});

test('channel: close() detaches cleanly', {skip: !hasBC}, async t => {
  const name = uniqueName();
  const a = io.create();
  const b = io.create();
  installChannel(a, {name, serviceWorker: null});
  installChannel(b, {name, serviceWorker: null});
  a.mock(
    () => true,
    () => json({ok: 1})
  );
  b.mock(
    () => true,
    () => json({ok: 2})
  );

  const url = BASE + '/closed/1';
  const keyB = await seed(b, url);
  a.channel.close();
  t.notOk(a.channel.active, 'closed channel reports inactive');

  await seed(a, url);
  await a.cache.remove(url);
  for (let i = 0; i < 10; ++i) await tick();
  t.ok(await held(b, keyB), 'a closed channel no longer propagates');

  b.channel.close();
});
