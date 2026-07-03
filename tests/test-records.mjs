import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

const chunked = (parts, contentType) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    }
  });
  return new Response(stream, {status: 200, headers: {'content-type': contentType}});
};

test('records.get iterates JSONL records', async t => {
  serve(() => chunked(['{"a":1}\n{"a":2}\n{"a":3}\n'], 'application/x-ndjson'));
  const seen = [];
  for await (const record of io.records.get('https://example.com/r')) seen.push(record);
  t.deepEqual(seen, [{a: 1}, {a: 2}, {a: 3}], 'all records parsed');
  reset();
});

test('records survive chunk boundaries mid-record and mid-CRLF', async t => {
  serve(() => chunked(['{"a":', '1}\r', '\n{"b"', ':2}\r\n', '{"c":3}'], 'application/x-ndjson'));
  const seen = [];
  for await (const record of io.records.get('https://example.com/rc')) seen.push(record);
  t.deepEqual(seen, [{a: 1}, {b: 2}, {c: 3}], 'boundaries handled, incl. a trailing record');
  reset();
});

test('json-seq framing is selected by the content type', async t => {
  serve(() => chunked(['\x1e{"a":1}\n\x1e', '{"a":2}\n'], 'application/json-seq'));
  const seen = [];
  for await (const record of io.records.get('https://example.com/seq')) seen.push(record);
  t.deepEqual(seen, [{a: 1}, {a: 2}], 'RS-framed records parsed');
  reset();
});

test('framing can be forced', async t => {
  serve(() => chunked(['{"a":1}\n'], 'application/octet-stream'));
  const seen = [];
  for await (const record of io.records.get('https://example.com/f', null, {framing: 'jsonl'})) {
    seen.push(record);
  }
  t.deepEqual(seen, [{a: 1}], 'jsonl forced despite the content type');
  try {
    io.records.get('https://example.com/f', null, {framing: 'nope'});
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof TypeError, 'unknown framing fails fast');
  }
  reset();
});

test('records.post sends the body and streams records back', async t => {
  let sent;
  let accept;
  serve(request => {
    sent = request.body;
    accept = request.headers.get('accept');
    return chunked(['{"hit":1}\n'], 'application/x-ndjson');
  });
  const seen = [];
  for await (const record of io.records.post('https://example.com/search', {q: 'x'})) {
    seen.push(record);
  }
  t.equal(sent, JSON.stringify({q: 'x'}), 'query went up as the JSON body');
  t.deepEqual(seen, [{hit: 1}], 'records streamed back');
  t.equal(accept, 'application/x-ndjson, application/json-seq', 'record formats advertised');
  reset();
});

test('breaking out cancels the underlying stream', async t => {
  let cancelled = false;
  serve(() => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"a":1}\n{"a":2}\n'));
        // stays open — only a cancel releases it
      },
      cancel() {
        cancelled = true;
      }
    });
    return new Response(stream, {headers: {'content-type': 'application/x-ndjson'}});
  });
  for await (const record of io.records.get('https://example.com/rb')) {
    t.deepEqual(record, {a: 1}, 'first record arrived');
    break;
  }
  t.ok(cancelled, 'the response stream was cancelled on early exit');
  reset();
});

test('a bad status surfaces as BadStatus with the parsed body', async t => {
  serve(() =>
    json({title: 'Nope'}, {status: 404, headers: {'content-type': 'application/problem+json'}})
  );
  try {
    for await (const record of io.records.get('https://example.com/missing')) void record;
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof io.BadStatus, 'BadStatus');
    t.equal(error.status, 404, 'status');
    t.equal(error.data.title, 'Nope', 'error body parsed, not left as a stream');
  }
  reset();
});

test('a malformed record throws FailedIO with the cause attached', async t => {
  serve(() => chunked(['{"a":1}\nnot-json\n'], 'application/x-ndjson'));
  const seen = [];
  try {
    for await (const record of io.records.get('https://example.com/bad')) seen.push(record);
    t.fail('expected a throw');
  } catch (error) {
    t.deepEqual(seen, [{a: 1}], 'records before the bad one were delivered');
    t.ok(error instanceof io.FailedIO, 'FailedIO');
    t.ok(error.cause instanceof SyntaxError, 'SyntaxError on .cause');
  }
  reset();
});

test('an abort mid-iteration surfaces even when the transport ignores the signal', async t => {
  serve(() => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"a":1}\n'));
        // stays open
      }
    });
    return new Response(stream, {headers: {'content-type': 'application/x-ndjson'}});
  });
  const controller = new AbortController();
  const seen = [];
  try {
    for await (const record of io.records.get('https://example.com/ab', null, {
      signal: controller.signal
    })) {
      seen.push(record);
      controller.abort();
    }
    t.fail('expected a throw');
  } catch (error) {
    t.equal(error.name, 'AbortError', 'abort surfaced');
  }
  t.deepEqual(seen, [{a: 1}], 'records before the abort were delivered');
  reset();
});
