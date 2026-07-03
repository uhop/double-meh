import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

test('a user abort surfaces as AbortError, not FailedIO', async t => {
  serve(() => new Promise(() => {}));
  const controller = new AbortController();
  const promise = io.get('https://example.com/abort', null, {signal: controller.signal});
  controller.abort();
  try {
    await promise;
    t.fail('expected a throw');
  } catch (error) {
    t.equal(error.name, 'AbortError', 'abort passed through');
    t.notOk(error instanceof io.IOError, 'not wrapped');
  }
  reset();
});

test('timeout produces TimedOut', async t => {
  serve(() => new Promise(() => {}));
  try {
    await io.get('https://example.com/slow', null, {timeout: 20});
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof io.TimedOut, 'TimedOut thrown');
    t.ok(error instanceof io.FailedIO, 'TimedOut is a FailedIO');
    t.ok(error instanceof io.IOError, 'and an IOError');
  }
  reset();
});

test('a network failure wraps into FailedIO with the cause preserved', async t => {
  serve(() => Promise.reject(new Error('boom')));
  try {
    await io.get('https://example.com/nf');
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof io.FailedIO, 'FailedIO');
    t.equal(error.message, 'boom', 'message from the cause');
    t.equal(error.cause && error.cause.message, 'boom', 'original error on .cause');
  }
  reset();
});

test('malformed JSON on a 200 fails loudly with the response attached', async t => {
  serve(() => new Response('{oops', {headers: {'content-type': 'application/json'}}));
  try {
    await io.get('https://example.com/badjson', null, {cache: false});
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof io.FailedIO, 'FailedIO');
    t.ok(error.cause instanceof SyntaxError, 'SyntaxError on .cause');
    t.ok(error.response, 'the response is attached');
  }
  reset();
});

test('an empty JSON body decodes as undefined', async t => {
  serve(() => new Response('', {status: 200, headers: {'content-type': 'application/json'}}));
  const data = await io.get('https://example.com/empty');
  t.equal(data, undefined, 'empty body → undefined');
  reset();
});

test('BadStatus carries the inspected envelope data', async t => {
  serve(() => json({code: 'X_FAILED'}, {status: 500}));
  io.inspect.response(envelope => {
    envelope.data = {normalized: true, original: envelope.data};
  });
  try {
    await io.get('https://example.com/norm');
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof io.BadStatus, 'BadStatus');
    t.ok(error.data.normalized, 'inspector-normalized data on the error');
  } finally {
    io.responseInspectors.length = 0;
  }
  reset();
});

test('download progress reports received bytes', async t => {
  serve(
    () =>
      new Response('0123456789', {
        headers: {'content-type': 'text/plain', 'content-length': '10'}
      })
  );
  const seen = [];
  const data = await io.get('https://example.com/prog', null, {
    cache: false,
    onDownloadProgress: info => seen.push(info)
  });
  t.equal(data, '0123456789', 'body decoded');
  t.ok(seen.length > 0, 'progress reported');
  t.equal(seen[seen.length - 1].loaded, 10, 'final loaded matches the size');
  reset();
});

test('lifecycle events fire around a request', async t => {
  const events = [];
  const onRequest = () => events.push('request');
  const onSuccess = () => events.push('success');
  const onFailure = () => events.push('failure');
  io.on('request', onRequest).on('success', onSuccess).on('failure', onFailure);
  serve(() => json({ok: true}));
  await io.get('https://example.com/ev', null, {cache: false});
  serve(() => json({}, {status: 500}));
  try {
    await io.get('https://example.com/ev-fail', null, {cache: false});
  } catch {
    // expected
  }
  io.off('request', onRequest).off('success', onSuccess).off('failure', onFailure);
  t.deepEqual(events, ['request', 'success', 'request', 'failure'], 'events in order');
  reset();
});
