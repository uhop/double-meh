import test from 'tape-six';

import {create} from '../../src/index.js';

// upload streaming is Chromium-only and h2-only; the canonical feature detection:
const supportsRequestStreams = (() => {
  let duplexAccessed = false;
  try {
    const hasContentType = new Request('https://example.com', {
      body: new ReadableStream(),
      method: 'POST',
      get duplex() {
        duplexAccessed = true;
        return 'half';
      }
    }).headers.has('content-type');
    return duplexAccessed && !hasContentType;
  } catch {
    return false;
  }
})();

// the runner's iframe is about:blank — the module's own URL carries the real origin
const overH2 = import.meta.url.startsWith('https:');
const skip = !supportsRequestStreams || !overH2;
const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

test('web duplex: io.stream.post streams the request body up over h2', {skip}, async t => {
  const io = create();
  const url = '/--io/upload?scope=wd-' + unique();
  const up = io.stream.post(url, {as: 'text'});
  const writer = up.writable.getWriter();
  const encoder = new TextEncoder();
  await writer.write(encoder.encode('chunk-1|'));
  await writer.write(encoder.encode('chunk-2'));
  await writer.close();
  const report = JSON.parse(await new Response(up.readable).text());
  t.equal(report.bytes, 15, 'all streamed bytes arrived at the sink');
  t.equal(report.method, 'POST', 'streamed as a POST');
  const envelope = await up.response;
  t.equal(envelope.status, 200, '.response resolves with the metadata');
});

test('web duplex: io.put accepts a {readable} body over the wire', {skip}, async t => {
  const io = create();
  const url = '/--io/upload?scope=wp-' + unique();
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('abc'));
      controller.close();
    }
  });
  const report = await io.put(url, {readable});
  t.equal(report.bytes, 3, 'the readable side became the request body');
  t.equal(report.method, 'PUT', 'verb preserved');
});
