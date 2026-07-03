import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

const feed = (writable, text) => {
  const w = writable.getWriter();
  return (async () => {
    await w.write(new TextEncoder().encode(text));
    await w.close();
  })();
};

test('io.stream.get yields the response body as a ReadableStream', async t => {
  serve(() => new Response('chunk-data', {status: 200}));
  const body = await io.stream.get('https://example.com/file');
  t.equal(typeof body.getReader, 'function', 'a ReadableStream comes back');
  t.equal(await new Response(body).text(), 'chunk-data', 'stream carries the payload');
  reset();
});

test('io.stream.get still composes query', async t => {
  let seenUrl;
  serve(request => {
    seenUrl = request.url;
    return new Response('ok');
  });
  await io.stream.get('https://example.com/file', {page: 2});
  t.equal(seenUrl, 'https://example.com/file?page=2', 'query merged onto the streaming GET');
  reset();
});

test('io.put accepts a {readable} chain/duplex as the body', async t => {
  let seen;
  serve(async request => {
    seen = await new Response(request.body).text();
    return json({ok: 1});
  });
  const {readable, writable} = new TransformStream();
  const done = feed(writable, 'piped-body');
  await io.put('https://example.com/x', {readable}, {as: 'text'});
  await done;
  t.equal(seen, 'piped-body', 'the .readable side was used as the request body');
  reset();
});

test('io.stream.put streams the request up and the response back as a duplex', async t => {
  serve(async request => {
    const sent = await new Response(request.body).text();
    return new Response('echo:' + sent, {status: 200});
  });
  const up = io.stream.put('https://example.com/data', {as: 'text'});
  const done = feed(up.writable, 'hello');
  const out = await new Response(up.readable).text();
  await done;
  t.equal(out, 'echo:hello', 'request streamed up, response streamed back');
  const env = await up.response;
  t.equal(env.status, 200, '.response carries the metadata');
  reset();
});

test('io.stream.put: a non-2xx errors the readable and rejects .response', async t => {
  serve(async request => {
    await new Response(request.body).arrayBuffer();
    return new Response('boom', {status: 500});
  });
  const up = io.stream.put('https://example.com/data', {as: 'text'});
  const done = feed(up.writable, 'x');
  try {
    await new Response(up.readable).text();
    t.fail('reading the response should reject on a 5xx');
  } catch {
    t.pass('the response stream errored on a 5xx');
  }
  await done;
  try {
    await up.response;
    t.fail('.response should reject on a 5xx');
  } catch (error) {
    t.ok(error instanceof io.BadStatus, '.response rejects with BadStatus');
  }
  reset();
});

test('io.stream.post is the duplex form for POST', async t => {
  serve(async request => new Response('got:' + (await new Response(request.body).text())));
  const up = io.stream.post('https://example.com/data', {as: 'text'});
  const done = feed(up.writable, 'z');
  const out = await new Response(up.readable).text();
  await done;
  t.equal(out, 'got:z', 'POST duplex streams like the PUT form');
  reset();
});
