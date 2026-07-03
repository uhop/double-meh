import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

test('retries a 5xx then succeeds', async t => {
  let calls = 0;
  serve(() => (++calls < 2 ? json({}, {status: 503}) : json({ok: true})));
  const data = await io.get('https://example.com/r', null, {retry: {retries: 3, initDelay: 0}});
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
    await io.get('https://example.com/r', null, {retry: {retries: 2, initDelay: 0}});
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
  const data = await io.get('https://example.com/r', null, {retry: {retries: 2, initDelay: 0}});
  t.equal(calls, 2, 'retried after the network error');
  t.deepEqual(data, {ok: true});
  reset();
});

test('retry: true uses the default retry count', async t => {
  let calls = 0;
  serve(() => {
    ++calls;
    return json({}, {status: 503});
  });
  const saved = io.retry.initDelay;
  io.retry.initDelay = 0;
  await io.get('https://example.com/rd', null, {retry: true, ignoreBadStatus: true});
  io.retry.initDelay = saved;
  t.equal(calls, 1 + io.retry.retries, 'initial call + the default retries');
  reset();
});

test('safety gate: bare POST not retried; an idempotency key or force enables it', async t => {
  let calls = 0;
  serve(() => {
    ++calls;
    return json({}, {status: 503});
  });
  await io.post(
    'https://example.com/p',
    {a: 1},
    {retry: {retries: 3, initDelay: 0}, ignoreBadStatus: true}
  );
  t.equal(calls, 1, 'bare POST is not retried (unsafe)');
  calls = 0;
  await io.post(
    'https://example.com/p',
    {a: 1},
    {retry: {retries: 1, initDelay: 0}, idempotencyKey: true, ignoreBadStatus: true}
  );
  t.equal(calls, 2, 'POST with an idempotency key is retried');
  calls = 0;
  await io.post(
    'https://example.com/p',
    {a: 1},
    {retry: {retries: 1, initDelay: 0, force: true}, ignoreBadStatus: true}
  );
  t.equal(calls, 2, 'force overrides the safety gate explicitly');
  reset();
});

test('a retried DELETE that returns 404 is treated as success (204)', async t => {
  let calls = 0;
  serve(() => (++calls < 2 ? json({}, {status: 503}) : new Response(null, {status: 404})));
  const env = await io.full.delete('https://example.com/d', null, {
    retry: {retries: 3, initDelay: 0}
  });
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
  await io.post(
    'https://example.com/p',
    {a: 1},
    {retry: {retries: 1, initDelay: 0}, idempotencyKey: true}
  );
  t.equal(keys.length, 2, 'retried');
  t.ok(keys[0], 'a key was generated');
  t.equal(keys[0], keys[1], 'same key reused across the retry');
  reset();
});

test('continueRetries with retries: 0 polls until the predicate stops', async t => {
  let calls = 0;
  serve(() => (++calls < 3 ? json({status: 'pending'}, {status: 202}) : json({status: 'done'})));
  const data = await io.get('https://example.com/poll', null, {
    retry: {retries: 0, initDelay: 0, continueRetries: response => response.status === 202}
  });
  t.equal(calls, 3, 'polled through two 202s');
  t.deepEqual(data, {status: 'done'}, 'resolved with the final body');
  reset();
});

test('an abort is not retried and surfaces as-is', async t => {
  let calls = 0;
  serve(() => {
    ++calls;
    return Promise.reject(new DOMException('This operation was aborted', 'AbortError'));
  });
  try {
    await io.get('https://example.com/ab', null, {retry: {retries: 3, initDelay: 0}});
    t.fail('should have thrown');
  } catch (error) {
    t.equal(calls, 1, 'no retries after an abort');
    t.equal(error.name, 'AbortError', 'the abort surfaced untouched');
    t.notOk(error instanceof io.IOError, 'not wrapped into an IOError');
  }
  reset();
});

test('retries are off by default (no retry option)', async t => {
  let calls = 0;
  serve(() => {
    ++calls;
    return json({}, {status: 503});
  });
  await io.get('https://example.com/r', null, {ignoreBadStatus: true});
  t.equal(calls, 1, 'no retry without the retry option');
  reset();
});
