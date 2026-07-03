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
