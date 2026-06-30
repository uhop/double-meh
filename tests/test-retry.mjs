import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

test('retries a 5xx then succeeds', async t => {
  let calls = 0;
  serve(() => (++calls < 2 ? json({}, {status: 503}) : json({ok: true})));
  const data = await io.get('https://example.com/r', null, {retries: 3, initDelay: 0});
  t.equal(calls, 2, 'retried once, then 200');
  t.deepEqual(data, {ok: true}, 'final body returned');
  reset();
});

test('exhausts retries then surfaces the failure', async t => {
  let calls = 0;
  serve(() => {
    ++calls;
    return json({}, {status: 500});
  });
  try {
    await io.get('https://example.com/r', null, {retries: 2, initDelay: 0});
    t.fail('should have thrown');
  } catch (e) {
    t.equal(calls, 3, 'initial call + 2 retries');
    t.equal(e.status, 500, 'final 500 surfaced as BadStatus');
  }
  reset();
});

test('retries a network error', async t => {
  let calls = 0;
  serve(() => (++calls < 2 ? Promise.reject(new Error('boom')) : json({ok: true})));
  const data = await io.get('https://example.com/r', null, {retries: 2, initDelay: 0});
  t.equal(calls, 2, 'retried after the network error');
  t.deepEqual(data, {ok: true});
  reset();
});

test('safety gate: bare POST not retried; with an idempotency key it is', async t => {
  let calls = 0;
  serve(() => {
    ++calls;
    return json({}, {status: 503});
  });
  await io.post('https://example.com/p', {a: 1}, {retries: 3, initDelay: 0, ignoreBadStatus: true});
  t.equal(calls, 1, 'bare POST is not retried (unsafe)');
  calls = 0;
  await io.post(
    'https://example.com/p',
    {a: 1},
    {
      retries: 1,
      initDelay: 0,
      idempotencyKey: true,
      ignoreBadStatus: true
    }
  );
  t.equal(calls, 2, 'POST with an idempotency key is retried');
  reset();
});

test('a retried DELETE that returns 404 is treated as success (204)', async t => {
  let calls = 0;
  serve(() => (++calls < 2 ? json({}, {status: 503}) : new Response(null, {status: 404})));
  const env = await io.full.delete('https://example.com/d', null, {retries: 3, initDelay: 0});
  t.equal(calls, 2, 'retried, then got 404');
  t.equal(env.status, 204, '404-on-retry → 204 success');
  reset();
});

test('idempotencyKey: true generates a key reused across retries', async t => {
  const keys = [];
  serve(request => {
    keys.push(request.headers.get('idempotency-key'));
    return json({ok: true}, {status: keys.length < 2 ? 503 : 200});
  });
  await io.post('https://example.com/p', {a: 1}, {retries: 1, initDelay: 0, idempotencyKey: true});
  t.equal(keys.length, 2, 'retried');
  t.ok(keys[0], 'a key was generated');
  t.equal(keys[0], keys[1], 'same key reused across the retry');
  reset();
});

test('retries are off by default (no retries option)', async t => {
  let calls = 0;
  serve(() => {
    ++calls;
    return json({}, {status: 503});
  });
  await io.get('https://example.com/r', null, {ignoreBadStatus: true});
  t.equal(calls, 1, 'no retry without the retries option');
  reset();
});
