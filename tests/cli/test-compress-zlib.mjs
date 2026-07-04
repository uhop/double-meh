import test from 'tape-six';
import zlib from 'node:zlib';

import {io, json, serve, reset} from '../helper.mjs';
import {installZlibEncoders} from '../../src/encoders/zlib.js';

const hasZstd = typeof zlib.createZstdCompress === 'function';
const PAYLOAD = {message: 'brotli and zstd ride node:zlib '.repeat(50)};

test('zlib encoders: br compresses and roundtrips', async t => {
  await installZlibEncoders(io);
  let seen;
  serve(request => {
    seen = request;
    return json({ok: true});
  });
  await io.post('https://example.com/br', PAYLOAD, {compress: 'br'});
  t.equal(seen.headers.get('content-encoding'), 'br', 'Content-Encoding set');
  const raw = JSON.stringify(PAYLOAD);
  t.ok(seen.body.byteLength < raw.length, 'compressed body is smaller than the JSON');
  const decoded = zlib.brotliDecompressSync(new Uint8Array(seen.body)).toString();
  t.deepEqual(JSON.parse(decoded), PAYLOAD, 'roundtrips');
  reset();
});

test('zlib encoders: zstd where the runtime ships it', {skip: !hasZstd}, async t => {
  await installZlibEncoders(io);
  let seen;
  serve(request => {
    seen = request;
    return json({ok: true});
  });
  await io.post('https://example.com/zstd', PAYLOAD, {compress: 'zstd'});
  t.equal(seen.headers.get('content-encoding'), 'zstd', 'Content-Encoding set');
  const decoded = zlib.zstdDecompressSync(new Uint8Array(seen.body)).toString();
  t.deepEqual(JSON.parse(decoded), PAYLOAD, 'roundtrips');
  reset();
});

test('zlib encoders: registration matches the runtime', async t => {
  await installZlibEncoders(io);
  t.equal(typeof io.encoders.br, 'function', 'br always registers');
  t.equal(typeof io.encoders.zstd, hasZstd ? 'function' : 'undefined', 'zstd is feature-detected');
});
