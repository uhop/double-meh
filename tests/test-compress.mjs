import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

const decompress = async (body, format) =>
  new Response(new Response(body).body.pipeThrough(new DecompressionStream(format))).text();

const PAYLOAD = {message: 'double-meh compresses request bodies '.repeat(50)};

test('compress: gzip — the body shrinks and roundtrips', async t => {
  let seen;
  serve(request => {
    seen = request;
    return json({ok: true});
  });
  await io.post('https://example.com/z', PAYLOAD, {compress: 'gzip'});
  t.equal(seen.headers.get('content-encoding'), 'gzip', 'Content-Encoding set');
  const raw = JSON.stringify(PAYLOAD);
  t.ok(seen.body.byteLength < raw.length, 'compressed body is smaller than the JSON');
  t.deepEqual(JSON.parse(await decompress(seen.body, 'gzip')), PAYLOAD, 'roundtrips');
  reset();
});

test('compress: true means gzip', async t => {
  let seen;
  serve(request => {
    seen = request;
    return json({ok: true});
  });
  await io.post('https://example.com/zt', PAYLOAD, {compress: true});
  t.equal(seen.headers.get('content-encoding'), 'gzip', 'gzip is the default encoder');
  reset();
});

test('compress: deflate roundtrips', async t => {
  let seen;
  serve(request => {
    seen = request;
    return json({ok: true});
  });
  await io.post('https://example.com/zd', PAYLOAD, {compress: 'deflate'});
  t.equal(seen.headers.get('content-encoding'), 'deflate', 'Content-Encoding set');
  t.deepEqual(JSON.parse(await decompress(seen.body, 'deflate')), PAYLOAD, 'roundtrips');
  reset();
});

test('compress: an unknown encoder throws', async t => {
  serve(() => json({ok: true}));
  try {
    await io.post('https://example.com/zu', PAYLOAD, {compress: 'lzma'});
    t.fail('an unregistered encoder must throw');
  } catch (error) {
    t.ok(error instanceof TypeError, 'TypeError');
    t.ok(/unknown compression encoder: lzma/.test(error.message), 'named in the message');
  }
  reset();
});

test('compress: a bodyless request is untouched', async t => {
  let seen;
  serve(request => {
    seen = request;
    return json({ok: true});
  });
  await io.get('https://example.com/zg', null, {compress: 'gzip', cache: false});
  t.equal(seen.headers.get('content-encoding'), null, 'no Content-Encoding on a GET');
  reset();
});

test('compress: a stream body stays a stream', async t => {
  let seen;
  serve(request => {
    seen = request;
    return json({ok: true});
  });
  const text = 'streamed and compressed '.repeat(40);
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });
  await io.post('https://example.com/zs', {readable}, {compress: 'gzip'});
  t.equal(typeof seen.body.getReader, 'function', 'the compressed body is still a stream');
  t.equal(seen.headers.get('content-encoding'), 'gzip', 'Content-Encoding set');
  t.equal(await decompress(seen.body, 'gzip'), text, 'stream content roundtrips');
  reset();
});

test('compress: an inline encoder function is the escape hatch', async t => {
  let seen;
  serve(request => {
    seen = request;
    return json({ok: true});
  });
  let called = 0;
  const encoder = source => {
    ++called;
    return source.pipeThrough(new CompressionStream('gzip'));
  };
  await io.post('https://example.com/zi', PAYLOAD, {compress: encoder});
  t.equal(called, 1, 'the inline encoder ran');
  t.equal(seen.headers.get('content-encoding'), null, 'no automatic Content-Encoding — no name');
  t.deepEqual(JSON.parse(await decompress(seen.body, 'gzip')), PAYLOAD, 'roundtrips');
  reset();
});

test('compress: an inline encoder pairs with an explicit header', async t => {
  let seen;
  serve(request => {
    seen = request;
    return json({ok: true});
  });
  const encoder = source => source.pipeThrough(new CompressionStream('deflate'));
  await io.post('https://example.com/zih', PAYLOAD, {
    compress: encoder,
    headers: {'Content-Encoding': 'deflate'}
  });
  t.equal(seen.headers.get('content-encoding'), 'deflate', 'the caller-set header rides through');
  t.deepEqual(JSON.parse(await decompress(seen.body, 'deflate')), PAYLOAD, 'roundtrips');
  reset();
});

test('compress: a FormData body refuses loudly', async t => {
  serve(() => json({ok: true}));
  const form = new FormData();
  form.append('a', '1');
  try {
    await io.post('https://example.com/zf', form, {compress: 'gzip'});
    t.fail('FormData must not be compressed');
  } catch (error) {
    t.ok(/cannot compress a FormData body/.test(error.message), 'refused with the reason');
  }
  reset();
});
