import test from 'tape-six';
import {io, json, serve, reset} from './helper.js';
import {normalizeTarget as normalizeTargetFor} from '../src/key.js';

test('track dedupes concurrent identical GETs', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  const [a, b] = await Promise.all([
    io.get('https://example.com/dup'),
    io.get('https://example.com/dup')
  ]);
  t.equal(calls, 1, 'transport called once for two concurrent gets');
  t.deepEqual(a, {n: 1}, 'first caller gets data');
  t.deepEqual(b, {n: 1}, 'second caller shares the same response');
  await reset();
});

test('concurrent full gets share one decoded envelope (not cloned + reparsed)', async t => {
  let calls = 0;
  serve(() => json({v: ++calls}));
  const [a, b] = await Promise.all([
    io.full.get('https://example.com/shared'),
    io.full.get('https://example.com/shared')
  ]);
  t.equal(calls, 1, 'one network call');
  t.equal(a, b, 'same envelope object — decoded once at the run level');
  await reset();
});

test('streaming requests are not deduped', async t => {
  let calls = 0;
  serve(() => json({v: ++calls}));
  await Promise.all([
    io.full.get('https://example.com/stream', null, {stream: true}),
    io.full.get('https://example.com/stream', null, {stream: true})
  ]);
  t.equal(calls, 2, 'each streaming caller gets its own response');
  await reset();
});

test('track does not dedupe different keys', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  await Promise.all([io.get('https://example.com/a'), io.get('https://example.com/b')]);
  t.equal(calls, 2, 'distinct urls each hit the transport');
  await reset();
});

test('adopt: a later get adopts an externally issued response', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  io.adopt('https://example.com/me', json({from: 'prelude'}));
  const data = await io.get('https://example.com/me');
  t.equal(calls, 0, 'transport not called — the adopted response was used');
  t.deepEqual(data, {from: 'prelude'}, 'the get resolves to the adopted body');
  await reset();
});

test('track passes non-GET through to the transport', async t => {
  let method;
  serve(request => {
    method = request.method;
    return json({ok: true});
  });
  await io.post('https://example.com/things', {a: 1});
  t.equal(method, 'POST', 'POST is not deduped');
  await reset();
});

test('track is GET-only: track:true does not dedupe POSTs', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  await Promise.all([
    io.post('https://example.com/p', {a: 1}, {track: true}),
    io.post('https://example.com/p', {a: 2}, {track: true})
  ]);
  t.equal(calls, 2, 'each POST hits the transport');
  await reset();
});

test("track: 'wait' on a non-GET throws", async t => {
  try {
    await io.post('https://example.com/w', null, {track: 'wait'});
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof TypeError, 'TypeError for a non-trackable wait');
  }
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('the leader’s abort detaches only the leader; a follower survives', async t => {
  let calls = 0;
  serve(async () => {
    ++calls;
    await sleep(30);
    return json({ok: true});
  });
  const leader = new AbortController();
  const a = io.get('https://example.com/refcount1', null, {signal: leader.signal});
  const b = io.get('https://example.com/refcount1');
  await sleep(5);
  leader.abort();
  const [ra, rb] = await Promise.allSettled([a, b]);
  t.equal(ra.status, 'rejected', 'the aborting caller rejects');
  t.equal(rb.status, 'fulfilled', 'the follower still gets the response');
  t.deepEqual(rb.value, {ok: true}, 'with the real body');
  t.equal(calls, 1, 'one deduped request served the survivor');
  await reset();
});

test('the wire aborts only when the last waiter leaves', async t => {
  let seen;
  serve(async request => {
    seen = request;
    await sleep(30);
    return json({ok: true});
  });
  const one = new AbortController();
  const two = new AbortController();
  const a = io.get('https://example.com/refcount2', null, {signal: one.signal});
  const b = io.get('https://example.com/refcount2', null, {signal: two.signal});
  await sleep(5);
  one.abort();
  t.notOk(seen.signal.aborted, 'the wire survives the first abort');
  two.abort();
  const [ra, rb] = await Promise.allSettled([a, b]);
  t.equal(ra.status, 'rejected', 'first caller rejected');
  t.equal(rb.status, 'rejected', 'second caller rejected');
  t.ok(seen.signal.aborted, 'the wire aborted when the last waiter left');
  await reset();
});

test('a follower’s abort never touches the leader', async t => {
  let seen;
  serve(async request => {
    seen = request;
    await sleep(30);
    return json({ok: true});
  });
  const follower = new AbortController();
  const a = io.get('https://example.com/refcount3');
  const b = io.get('https://example.com/refcount3', null, {signal: follower.signal});
  await sleep(5);
  follower.abort();
  const [ra, rb] = await Promise.allSettled([a, b]);
  t.equal(ra.status, 'fulfilled', 'the leader completes');
  t.equal(rb.status, 'rejected', 'the aborting follower rejects');
  t.notOk(seen.signal.aborted, 'the wire was never aborted');
  await reset();
});

test('fly holds the key: no request fires, and a later adopt delivers it', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  const url = 'https://example.com/fly-holds';
  io.track.fly(url);
  setTimeout(() => io.adopt(url, json({from: 'elsewhere'})), 5);
  const [a, b] = await Promise.all([io.get(url), io.get(url)]);
  t.equal(calls, 0, 'fly suppressed the request: the response came from elsewhere');
  t.deepEqual(a, {from: 'elsewhere'}, 'the first waiter got the adopted response');
  t.deepEqual(b, {from: 'elsewhere'}, 'the second waiter shared it');
  await reset();
});

test('an adopted key is honored whatever the verb', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  const url = 'https://example.com/verb-put';
  io.adopt({method: 'PUT', url}, json({from: 'prelude'}));
  const data = await io.put({url}, {layout: 'compact'});
  t.equal(calls, 0, 'the PUT resolved from the hand-over');
  t.deepEqual(data, {from: 'prelude'}, 'the adopted body came through');
  await reset();
});

test('a reserved POST waits for its delivery instead of requesting', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  const url = 'https://example.com/verb-post';
  io.track.fly({method: 'POST', url});
  setTimeout(() => io.adopt({method: 'POST', url}, json({from: 'elsewhere'})), 5);
  const data = await io.post({url}, {x: 1});
  t.equal(calls, 0, 'no request fired for the reserved key');
  t.deepEqual(data, {from: 'elsewhere'}, 'the late delivery resolved the POST');
  await reset();
});

test('an unreserved non-GET is never shared', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  const url = 'https://example.com/verb-unreserved';
  const [a, b] = await Promise.all([io.post({url}, {x: 1}), io.post({url}, {x: 2})]);
  t.equal(calls, 2, 'two concurrent POSTs stay two requests');
  t.deepEqual([a, b], [{n: 1}, {n: 2}], 'each caller got its own response');
  await reset();
});

test('a hand-over is consumed once, and the method is part of the key', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  const once = 'https://example.com/verb-once';
  io.adopt({method: 'PUT', url: once}, json({from: 'prelude'}));
  t.deepEqual(await io.put({url: once}, {x: 1}), {from: 'prelude'}, 'the first call is adopted');
  t.deepEqual(await io.put({url: once}, {x: 2}), {from: 'network', n: 1}, 'the second requests');

  const cross = 'https://example.com/verb-cross';
  io.adopt(cross, json({from: 'get-prelude'}));
  t.deepEqual(
    await io.put({url: cross}, {x: 1}),
    {from: 'network', n: 2},
    'a GET key is not a PUT key'
  );
  await reset();
});

test('a non-GET hand-over is held for an application that has not loaded yet', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  const url = 'https://example.com/held-post';
  io.adopt({method: 'POST', url}, json({from: 'prelude'}));
  await new Promise(resolve => setTimeout(resolve, 30)); // the response lands with no receiver
  t.deepEqual(await io.post({url}, {q: 1}), {from: 'prelude'}, 'the late caller got it');
  t.equal(calls, 0, 'no request fired');
  t.deepEqual(await io.post({url}, {q: 2}), {from: 'network', n: 1}, 'and it is gone after one');
  await reset();
});

test('a held hand-over expires', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  const saved = io.track.retainMs;
  io.track.retainMs = 10;
  const url = 'https://example.com/held-expires';
  io.adopt({method: 'POST', url}, json({from: 'prelude'}));
  await new Promise(resolve => setTimeout(resolve, 40));
  t.deepEqual(await io.post({url}, {q: 1}), {from: 'network', n: 1}, 'a stale hold is not served');
  io.track.retainMs = saved;
  await reset();
});

test('a GET hand-over is not held: the cache is its durable copy', async t => {
  serve(() => json({from: 'network'}));
  const url = 'https://example.com/held-get';
  io.adopt(url, json({from: 'prelude'}));
  await io.cache.idle();
  await new Promise(resolve => setTimeout(resolve, 10));
  t.notOk(io.track.deferred[io.makeKey({url})], 'the in-flight table is clean');
  t.deepEqual(await io.get(url), {from: 'prelude'}, 'and the cache still serves it');
  await reset();
});

test('a Request is a first-class target, and so is a URL', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));

  const post = 'https://example.com/target-request';
  const request = new Request(post, {method: 'POST', body: JSON.stringify({q: 1})});
  io.adopt(request, json({from: 'prelude'}));
  t.deepEqual(await io.post({url: post}, {q: 1}), {from: 'prelude'}, 'a Request target matches');

  const withAccept = new Request('https://example.com/t-key?b=2&a=1', {
    method: 'PUT',
    headers: {Accept: 'application/vnd.api+json'}
  });
  t.equal(
    io.makeKey(withAccept),
    io.makeKey({
      method: 'PUT',
      url: 'https://example.com/t-key?b=2&a=1',
      accept: 'application/vnd.api+json'
    }),
    'a Request keys exactly as the object form'
  );

  const viaUrl = 'https://example.com/target-url';
  io.adopt(new URL(viaUrl), json({from: 'prelude'}));
  t.deepEqual(await io.get(viaUrl), {from: 'prelude'}, 'a URL target matches');
  await reset();
});

test('a Request never contributes its own options: cache is not one of ours', async t => {
  const saved = io.cache.theDefault;
  io.cache.theDefault = () => false;
  const url = 'https://example.com/target-cache';
  t.notOk(io.cache.optIn({url}), 'the object form opts out');
  t.notOk(
    io.cache.optIn(normalizeTargetFor(new Request(url))),
    "a Request's own `cache` does not read as an opt-in"
  );
  t.notOk(
    io.cache.optIn(normalizeTargetFor(new Request(url, {cache: 'no-store'}))),
    'not even when the page asked for no-store'
  );
  io.cache.theDefault = saved;
  await reset();
});

test('a GET hand-over is held when the cache cannot keep it', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  io.cache.detach();
  const url = 'https://example.com/held-get-nocache';
  io.adopt(url, json({from: 'prelude'}));
  await new Promise(resolve => setTimeout(resolve, 30)); // lands with no receiver, no cache
  t.deepEqual(await io.get(url), {from: 'prelude'}, 'the hold covered for the cache');
  t.equal(calls, 0, 'no request fired');
  io.cache.attach();
  await reset();
});

test('holding is keyed, and ordinary traffic is never shared', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));

  const open = 'https://example.com/held-overlap';
  const three = await Promise.all([
    io.post({url: open}, {x: 1}),
    io.post({url: open}, {x: 2}),
    io.post({url: open}, {x: 3})
  ]);
  t.equal(calls, 3, 'three overlapping POSTs stay three requests');
  t.deepEqual(
    three.map(r => r.n),
    [1, 2, 3],
    'each caller got its own response'
  );

  // a handed-over key is body-blind: the first matching call takes it, whatever it was sending
  calls = 0;
  const handed = 'https://example.com/held-payload';
  io.adopt({method: 'POST', url: handed}, json({from: 'prelude'}));
  await new Promise(resolve => setTimeout(resolve, 20));
  t.deepEqual(await io.post({url: handed}, {x: 999}), {from: 'prelude'}, 'the hold is taken');
  t.deepEqual(await io.post({url: handed}, {x: 998}), {from: 'network', n: 1}, 'then released');
  await reset();
});
