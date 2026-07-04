import test from 'tape-six';
import zlib from 'node:zlib';

import {io, json, serve, reset} from '../helper.mjs';
import {installZlibEncoders, brotliEncoder, gzipEncoder} from '../../src/encoders/zlib.js';
import {create} from '../../src/index.js';

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

const encodeBytes = async (encoder, text) =>
  new Uint8Array(await new Response(await encoder(new Response(text).body)).arrayBuffer());

test('zlib encoders: factories honor parameters', async t => {
  const raw = JSON.stringify(PAYLOAD);
  const brFast = await encodeBytes(await brotliEncoder({quality: 1}), raw);
  const brBest = await encodeBytes(await brotliEncoder({quality: 11}), raw);
  t.ok(brBest.length <= brFast.length, 'brotli quality 11 is at most quality-1 size');
  t.equal(zlib.brotliDecompressSync(brFast).toString(), raw, 'quality 1 roundtrips');
  t.equal(zlib.brotliDecompressSync(brBest).toString(), raw, 'quality 11 roundtrips');
  const gzStored = await encodeBytes(await gzipEncoder({level: 0}), raw);
  const gzBest = await encodeBytes(await gzipEncoder({level: 9}), raw);
  t.ok(gzBest.length < gzStored.length, 'gzip level 9 beats level 0 (stored)');
  t.equal(zlib.gunzipSync(gzBest).toString(), raw, 'gzip roundtrips');
});

test('zlib encoders: install options parameterize the registrations', async t => {
  const dm = create();
  await installZlibEncoders(dm, {br: {quality: 11}, gzip: {level: 9}});
  const raw = JSON.stringify(PAYLOAD);
  const br = await encodeBytes(dm.encoders.br, raw);
  t.equal(zlib.brotliDecompressSync(br).toString(), raw, 'configured br roundtrips');
  const gz = await encodeBytes(dm.encoders.gzip, raw);
  t.equal(zlib.gunzipSync(gz).toString(), raw, 'zlib-backed gzip replaces the platform one');
  const plain = create();
  await installZlibEncoders(plain);
  t.ok(
    (await encodeBytes(plain.encoders.br, raw)).length >= br.length,
    'default br (quality 5) is no smaller than quality 11'
  );
});
