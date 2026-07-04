import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

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
  reset();
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
  reset();
});

test('streaming requests are not deduped', async t => {
  let calls = 0;
  serve(() => json({v: ++calls}));
  await Promise.all([
    io.full.get('https://example.com/stream', null, {stream: true}),
    io.full.get('https://example.com/stream', null, {stream: true})
  ]);
  t.equal(calls, 2, 'each streaming caller gets its own response');
  reset();
});

test('track does not dedupe different keys', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  await Promise.all([io.get('https://example.com/a'), io.get('https://example.com/b')]);
  t.equal(calls, 2, 'distinct urls each hit the transport');
  reset();
});

test('adopt: a later get adopts an externally issued response', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  io.adopt('https://example.com/me', json({from: 'prelude'}));
  const data = await io.get('https://example.com/me');
  t.equal(calls, 0, 'transport not called — the adopted response was used');
  t.deepEqual(data, {from: 'prelude'}, 'the get resolves to the adopted body');
  reset();
});

test('track passes non-GET through to the transport', async t => {
  let method;
  serve(request => {
    method = request.method;
    return json({ok: true});
  });
  await io.post('https://example.com/things', {a: 1});
  t.equal(method, 'POST', 'POST is not deduped');
  reset();
});

test('track is GET-only: track:true does not dedupe POSTs', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  await Promise.all([
    io.post('https://example.com/p', {a: 1}, {track: true}),
    io.post('https://example.com/p', {a: 2}, {track: true})
  ]);
  t.equal(calls, 2, 'each POST hits the transport');
  reset();
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
  reset();
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
  reset();
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
  reset();
});
