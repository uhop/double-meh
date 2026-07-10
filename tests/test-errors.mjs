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

test('problem: a problem+json body is the parsed problem document', async t => {
  serve(
    () =>
      new Response(JSON.stringify({type: 'about:blank', title: 'Nope', detail: 'No such unit'}), {
        status: 422,
        headers: {'content-type': 'application/problem+json'}
      })
  );
  try {
    await io.get('https://example.com/p-json');
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof io.BadStatus, 'BadStatus');
    t.equal(error.problem, error.data, 'problem IS the parsed data — no copy');
    t.equal(error.problem.title, 'Nope', 'RFC 9457 fields readable');
  }
  reset();
});

test('problem: a mislabeled JSON envelope is sniffed and parsed', async t => {
  serve(
    () =>
      new Response(' {"errorCode": 17, "reason": "legacy"} ', {
        status: 500,
        headers: {'content-type': 'text/plain'}
      })
  );
  try {
    await io.get('https://example.com/p-legacy');
    t.fail('expected a throw');
  } catch (error) {
    t.equal(typeof error.data, 'string', 'data faithfully reflects the decode (text)');
    t.deepEqual(error.problem, {errorCode: 17, reason: 'legacy'}, 'problem is the parsed envelope');
    t.equal(error.problem, error.problem, 'parsed once — memoized');
  }
  reset();
});

test('problem: a JSON array envelope parses too', async t => {
  serve(
    () =>
      new Response('[{"field": "name", "message": "required"}]', {
        status: 400,
        headers: {'content-type': 'text/plain'}
      })
  );
  try {
    await io.get('https://example.com/p-array');
    t.fail('expected a throw');
  } catch (error) {
    t.deepEqual(error.problem, [{field: 'name', message: 'required'}], 'array envelopes work');
  }
  reset();
});

test('problem: unparseable bodies yield undefined', async t => {
  const cases = [
    ['<!doctype html><h1>502 Bad Gateway</h1>', 'text/html'],
    ['{oops, not json', 'text/plain'],
    ['plain refusal', 'text/plain'],
    ['', 'text/plain']
  ];
  for (const [body, type] of cases) {
    serve(() => new Response(body, {status: 502, headers: {'content-type': type}}));
    try {
      await io.get('https://example.com/p-una?b=' + encodeURIComponent(body.slice(0, 8)));
      t.fail('expected a throw');
    } catch (error) {
      t.equal(error.problem, undefined, `no parse for ${JSON.stringify(body.slice(0, 12))}`);
    }
    reset();
  }
});

test('problem: an opaque forced decode yields undefined', async t => {
  serve(
    () =>
      new Response('{"hidden": true}', {
        status: 500,
        headers: {'content-type': 'application/json'}
      })
  );
  try {
    await io.get('https://example.com/p-blob', null, {decode: 'blob'});
    t.fail('expected a throw');
  } catch (error) {
    t.equal(error.problem, undefined, 'a Blob is not a parsed envelope');
  }
  reset();
});

test('problem: a MIME processor is the seam for XML and other legacy types', async t => {
  const dm = io.create();
  dm.registerMime({
    match: contentType => contentType.startsWith('application/vnd.legacy+xml'),
    decode: async source => {
      const text = await source.text();
      const match = /<error code="(\d+)">([^<]*)<\/error>/.exec(text);
      return match ? {code: Number(match[1]), message: match[2]} : {raw: text};
    }
  });
  dm.mock(
    () => true,
    () =>
      new Response('<error code="42">meaning not found</error>', {
        status: 500,
        headers: {'content-type': 'application/vnd.legacy+xml'}
      })
  );
  try {
    await dm.get('https://example.com/p-xml');
    t.fail('expected a throw');
  } catch (error) {
    t.deepEqual(
      error.problem,
      {code: 42, message: 'meaning not found'},
      'the processor-decoded envelope is the problem'
    );
    t.equal(error.problem, error.data, 'and it is data itself');
  }
});
