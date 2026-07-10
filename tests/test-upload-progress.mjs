import test from 'tape-six';

import {io, json, serve, reset} from './helper.mjs';

const PAYLOAD = {message: 'upload progress measures the outgoing body '.repeat(20)};

// a transport that drains the body like a real wire would
const makeSink = () => {
  const state = {calls: 0, bytes: 0};
  const transport = async request => {
    ++state.calls;
    const body = request.body;
    if (body != null && typeof body.getReader === 'function') {
      const reader = body.getReader();
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        state.bytes += value.byteLength;
      }
    }
    return json({ok: true});
  };
  return {state, transport};
};

const withSink = () => {
  const dm = io.create();
  const sink = makeSink();
  dm.registerTransport('sink', sink.transport);
  return {dm, sink};
};

test('upload progress: a buffered body reports one completion event', async t => {
  const {dm} = withSink();
  const events = [];
  await dm.post('https://example.com/up', PAYLOAD, {
    transport: 'sink',
    onUploadProgress: info => events.push(info)
  });
  const total = new TextEncoder().encode(JSON.stringify(PAYLOAD)).byteLength;
  t.equal(events.length, 1, 'exactly one event');
  t.deepEqual(events[0], {loaded: total, total, lengthComputable: true}, 'loaded === total');
});

test('upload progress: totals are bytes, not code units', async t => {
  const {dm} = withSink();
  const events = [];
  const text = 'héllo — ünïcode';
  await dm.post('https://example.com/up-utf8', text, {
    transport: 'sink',
    as: 'text',
    onUploadProgress: info => events.push(info)
  });
  const total = new TextEncoder().encode(text).byteLength;
  t.ok(total > text.length, 'the fixture is genuinely multibyte');
  t.equal(events[0].total, total, 'UTF-8 byte length reported');
});

test('upload progress: a Blob body reports its size', async t => {
  const {dm} = withSink();
  const events = [];
  const blob = new Blob(['blob '.repeat(100)], {type: 'application/octet-stream'});
  await dm.post('https://example.com/up-blob', blob, {
    transport: 'sink',
    onUploadProgress: info => events.push(info)
  });
  t.equal(events.length, 1, 'one completion event');
  t.equal(events[0].total, blob.size, 'total is blob.size');
});

test('upload progress: a stream body meters per chunk', async t => {
  const {dm, sink} = withSink();
  const events = [];
  const chunks = ['first chunk ', 'second chunk ', 'third chunk'].map(text =>
    new TextEncoder().encode(text)
  );
  const readable = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
  await dm.post(
    'https://example.com/up-stream',
    {readable},
    {transport: 'sink', onUploadProgress: info => events.push(info)}
  );
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  t.ok(events.length > 1, 'multiple chunk events');
  t.equal(events.at(-1).loaded, total, 'cumulative loaded reaches the full byte count');
  t.notOk(events[0].lengthComputable, 'stream totals are unknown');
  t.ok(
    events.every((info, i) => i === 0 || info.loaded > events[i - 1].loaded),
    'loaded grows monotonically'
  );
  t.equal(sink.state.bytes, total, 'the transport drained every byte through the meter');
});

test('upload progress: compression meters the compressed bytes', async t => {
  const {dm} = withSink();
  const events = [];
  await dm.post('https://example.com/up-z', PAYLOAD, {
    transport: 'sink',
    compress: 'gzip',
    onUploadProgress: info => events.push(info)
  });
  const raw = new TextEncoder().encode(JSON.stringify(PAYLOAD)).byteLength;
  t.equal(events.length, 1, 'still one completion event — buffered stays buffered');
  t.ok(events[0].total > 0 && events[0].total < raw, 'the metered total is the compressed size');
});

test('upload progress: platform-encoded bodies report nothing', async t => {
  const {dm} = withSink();
  const events = [];
  const form = new FormData();
  form.append('a', '1');
  await dm.post('https://example.com/up-form', form, {
    transport: 'sink',
    onUploadProgress: info => events.push(info)
  });
  t.equal(events.length, 0, 'FormData size is the platform’s secret — no events');
});

test('upload progress: a mock-served request reports nothing', async t => {
  const events = [];
  serve(() => json({ok: true}));
  await io.post('https://example.com/up-mock', PAYLOAD, {
    onUploadProgress: info => events.push(info)
  });
  t.equal(events.length, 0, 'no wire, no upload events');
  reset();
});
