import test from 'tape-six';
import {io, json, serve, reset} from './helper.js';

const sseBody = (text, init = {}) =>
  new Response(text, {
    status: init.status || 200,
    headers: {'content-type': 'text/event-stream', ...(init.headers || {})}
  });

test('sse parses events: comments, multiline data, types, ids', async t => {
  const text =
    ': keep-alive\n' +
    'data: one\n\n' +
    'event: update\nid: 7\ndata: l1\ndata: l2\n\n' +
    'data: tail-without-blank-line';
  serve(() => sseBody(text));
  const seen = [];
  for await (const event of io.sse('https://example.com/s', null, {reconnect: false})) {
    seen.push(event);
  }
  t.deepEqual(
    seen,
    [
      {data: 'one', event: 'message', id: undefined},
      {data: 'l1\nl2', event: 'update', id: '7'}
    ],
    'comment skipped, multiline joined, incomplete tail discarded'
  );
  await reset();
});

test('sse reconnects with Last-Event-ID; a 204 ends the subscription', async t => {
  let calls = 0;
  const ids = [];
  serve(request => {
    ids.push(request.headers.get('last-event-id'));
    return ++calls === 1 ? sseBody('id: 1\ndata: a\n\n') : new Response(null, {status: 204});
  });
  const seen = [];
  for await (const event of io.sse('https://example.com/rc', null, {reconnect: 0})) {
    seen.push(event.data);
  }
  t.deepEqual(seen, ['a'], 'event delivered');
  t.equal(calls, 2, 'reconnected once, then the 204 ended it');
  t.equal(ids[0], null, 'no Last-Event-ID on the first connect');
  t.equal(ids[1], '1', 'Last-Event-ID sent on reconnect');
  await reset();
});

test('sse resumes from a supplied lastEventId', async t => {
  let sent;
  serve(request => {
    sent = request.headers.get('last-event-id');
    return sseBody('data: x\n\n');
  });
  for await (const event of io.sse('https://example.com/re', null, {
    reconnect: false,
    lastEventId: '42'
  })) {
    void event;
  }
  t.equal(sent, '42', 'initial connect carries the supplied id');
  await reset();
});

test('sse: a non-2xx is fatal and carries the parsed problem', async t => {
  serve(() =>
    json({title: 'Down'}, {status: 503, headers: {'content-type': 'application/problem+json'}})
  );
  try {
    for await (const event of io.sse('https://example.com/down')) void event;
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof io.BadStatus, 'BadStatus');
    t.equal(error.status, 503, 'status');
    t.equal(error.data.title, 'Down', 'problem body parsed');
  }
  await reset();
});

test('sse: a wrong content type is fatal', async t => {
  serve(() => json({nope: true}));
  try {
    for await (const event of io.sse('https://example.com/ct')) void event;
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof io.FailedIO, 'FailedIO');
    t.ok(/content type/.test(error.message), 'names the content-type mismatch');
  }
  await reset();
});

test('sse: an abort stops the subscription', async t => {
  serve(() => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: a\n\n'));
        // stays open
      }
    });
    return new Response(stream, {headers: {'content-type': 'text/event-stream'}});
  });
  const controller = new AbortController();
  const seen = [];
  try {
    for await (const event of io.sse('https://example.com/ab', null, {
      signal: controller.signal
    })) {
      seen.push(event.data);
      controller.abort();
    }
    t.fail('expected a throw');
  } catch (error) {
    t.equal(error.name, 'AbortError', 'abort surfaced, no reconnect');
  }
  t.deepEqual(seen, ['a'], 'events before the abort were delivered');
  await reset();
});

// counts connections inside a window: one fits at the 3000ms default, dozens at a zeroed delay
const connectionsIn = async (ms, body) => {
  await reset();
  let calls = 0;
  serve(() => {
    ++calls;
    return sseBody(body);
  });
  const controller = new AbortController();
  const stop = setTimeout(() => controller.abort(), ms);
  try {
    for await (const event of io.sse('https://example.com/retry', null, {
      signal: controller.signal
    })) {
      void event;
    }
  } catch {
    // the abort ends the subscription
  }
  clearTimeout(stop);
  return calls;
};

test('sse: a retry value that is not ASCII digits leaves the delay alone', async t => {
  t.ok((await connectionsIn(120, 'retry:\n\n')) <= 2, 'an empty retry: does not zero the delay');
  t.ok((await connectionsIn(120, 'retry: \n\n')) <= 2, 'nor does a blank one');
  t.ok((await connectionsIn(120, 'retry: 0x10\n\n')) <= 2, 'nor a non-decimal one');
  await reset();
});

test('sse: a digits retry is honoured, and clamped to the timer ceiling', async t => {
  t.ok((await connectionsIn(120, 'retry: 20\n\n')) >= 3, 'a valid retry shortens the delay');
  t.ok(
    (await connectionsIn(120, 'retry: 999999999999999999999\n\n')) <= 2,
    'a value past setTimeout’s range is clamped, not overflowed to fire immediately'
  );
  await reset();
});

test('sse: breaking out stops without reconnecting', async t => {
  let calls = 0;
  serve(() => {
    ++calls;
    return sseBody('data: a\n\ndata: b\n\n');
  });
  const seen = [];
  for await (const event of io.sse('https://example.com/brk', null, {reconnect: 0})) {
    seen.push(event.data);
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  t.deepEqual(seen, ['a'], 'stopped after the first event');
  t.equal(calls, 1, 'no reconnect after the consumer broke out');
  await reset();
});
