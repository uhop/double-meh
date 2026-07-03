import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

test('GET returns parsed data', async t => {
  serve(request => {
    t.equal(request.method, 'GET', 'method is GET');
    return json({hello: 'world'});
  });
  t.deepEqual(await io.get('https://example.com/x'), {hello: 'world'}, 'bare get yields data');
  reset();
});

test('io.full returns the envelope with a hoisted etag', async t => {
  serve(() => json({a: 1}, {headers: {etag: '"v1"'}}));
  const env = await io.full.get('https://example.com/x');
  t.equal(env.status, 200, 'status');
  t.ok(env.ok, 'ok');
  t.deepEqual(env.data, {a: 1}, 'data');
  t.equal(env.etag, '"v1"', 'etag hoisted');
  t.notOk(env.weak, 'strong validator');
  reset();
});

test('POST sends a JSON body and resolves Location', async t => {
  let sentBody;
  let sentType;
  serve(request => {
    sentBody = request.body;
    sentType = request.headers.get('content-type');
    return json({id: 7}, {status: 201, headers: {location: '/things/7'}});
  });
  const env = await io.full.post('https://example.com/things', {name: 'Bob'});
  t.equal(sentBody, JSON.stringify({name: 'Bob'}), 'json body');
  t.equal(sentType, 'application/json', 'json content-type');
  t.equal(env.status, 201, 'created');
  t.equal(env.location, 'https://example.com/things/7', 'location resolved absolute');
  reset();
});

test('non-2xx throws BadStatus carrying the problem+json envelope', async t => {
  serve(() =>
    json({title: 'Nope'}, {status: 404, headers: {'content-type': 'application/problem+json'}})
  );
  try {
    await io.get('https://example.com/missing');
    t.fail('expected a throw');
  } catch (error) {
    t.ok(error instanceof io.BadStatus, 'throws BadStatus');
    t.ok(error instanceof io.IOError, 'BadStatus is an IOError');
    t.equal(error.status, 404, 'status on the error');
    t.equal(error.data.title, 'Nope', 'parsed problem+json on the error');
  }
  reset();
});

test('io(options) is the low-level callable; verbs are sugar over it', async t => {
  serve(request => {
    t.equal(request.method, 'GET', 'defaults to GET');
    return json({v: 1});
  });
  t.deepEqual(await io({url: 'https://example.com/x'}), {v: 1}, 'io(options) returns data');
  reset();
});

test('io.full(options) returns the envelope', async t => {
  serve(() => json({v: 1}, {status: 201}));
  const env = await io.full({url: 'https://example.com/x', method: 'POST', data: {a: 1}});
  t.equal(env.status, 201, 'status');
  t.deepEqual(env.data, {v: 1}, 'data');
  reset();
});

test('a reusable endpoint descriptor works across verbs with data', async t => {
  const seen = [];
  serve(request => {
    seen.push({method: request.method, url: request.url, body: request.body});
    return json({ok: true});
  });
  const endpoint = {url: 'https://example.com/things/1', headers: {'X-Trace': 'abc'}};
  await io.get(endpoint, {q: 1});
  await io.put(endpoint, {name: 'Bob'});
  t.equal(seen[0].method, 'GET');
  t.equal(seen[0].url, 'https://example.com/things/1?q=1', 'GET: data → query, endpoint reused');
  t.equal(seen[1].method, 'PUT');
  t.equal(seen[1].body, JSON.stringify({name: 'Bob'}), 'PUT: data → body, same endpoint');
  t.equal(endpoint.url, 'https://example.com/things/1', 'endpoint descriptor not mutated');
  reset();
});

test('a URL object is accepted as the url', async t => {
  let sentUrl;
  serve(request => {
    sentUrl = request.url;
    return json({ok: true});
  });
  await io.get(new URL('https://example.com/u?z=1'));
  t.equal(sentUrl, 'https://example.com/u?z=1', 'URL object → url string');
  reset();
});

test('io(...) is multi-arg and does not force a method (defaults GET)', async t => {
  const seen = [];
  serve(request => {
    seen.push({method: request.method, body: request.body});
    return json({ok: true});
  });
  await io('https://example.com/x');
  await io({url: 'https://example.com/x', method: 'POST'}, {a: 1});
  t.equal(seen[0].method, 'GET', 'io() defaults to GET when no method given');
  t.equal(seen[1].method, 'POST', 'io() uses the provided method (not forced)');
  t.equal(seen[1].body, JSON.stringify({a: 1}), 'data became the body for POST');
  reset();
});

test('3rd-arg overrides: scalar flags shallow-override, headers merge per-key, url stays', async t => {
  let auth;
  let trace;
  let accept;
  let sentUrl;
  serve(request => {
    sentUrl = request.url;
    auth = request.headers.get('authorization');
    trace = request.headers.get('x-trace');
    accept = request.headers.get('accept');
    return json({ok: true});
  });
  const endpoint = {
    url: 'https://example.com/e',
    headers: {Authorization: 'Bearer t', 'X-Trace': 'base'}
  };
  await io.get(endpoint, null, {accept: 'application/json-seq', headers: {'X-Trace': 'call'}});
  t.equal(sentUrl, 'https://example.com/e', 'url comes from the endpoint, not the override');
  t.equal(auth, 'Bearer t', 'endpoint Authorization preserved');
  t.equal(trace, 'call', 'override replaced only the X-Trace header');
  t.equal(accept, 'application/json-seq', 'scalar override (accept) applied');
  reset();
});

test('write verbs: undefined data sends no body; null is a valid JSON-null body', async t => {
  let body;
  let ct;
  serve(request => {
    body = request.body;
    ct = request.headers.get('content-type');
    return json({ok: true});
  });
  await io.post('https://example.com/x');
  t.equal(body, undefined, 'undefined → no body');
  await io.post('https://example.com/x', null);
  t.equal(body, 'null', 'null → JSON null body');
  t.equal(ct, 'application/json', 'with JSON content-type');
  reset();
});

test('read verbs: both null and undefined data drop the query', async t => {
  let url;
  serve(request => {
    url = request.url;
    return json({ok: true});
  });
  await io.get('https://example.com/q1', undefined);
  t.equal(url, 'https://example.com/q1', 'undefined → no query');
  await io.get('https://example.com/q2', null);
  t.equal(url, 'https://example.com/q2', 'null → no query');
  reset();
});

test('a URL with a fragment keeps the query ahead of the fragment', async t => {
  let sentUrl;
  serve(request => {
    sentUrl = request.url;
    return json({ok: true});
  });
  await io.get('https://example.com/a#top', {q: 1});
  t.equal(sentUrl, 'https://example.com/a?q=1#top', 'query inserted before the fragment');
  reset();
});

test('a Headers instance is accepted for options.headers', async t => {
  let trace;
  serve(request => {
    trace = request.headers.get('x-trace');
    return json({ok: true});
  });
  await io.get('https://example.com/h', null, {headers: new Headers({'X-Trace': 'hdr'})});
  t.equal(trace, 'hdr', 'headers from a Headers instance are sent');
  reset();
});

test('URLSearchParams is accepted as a query', async t => {
  let sentUrl;
  serve(request => {
    sentUrl = request.url;
    return json({ok: true});
  });
  await io.get('https://example.com/usp', new URLSearchParams({a: '1', b: '2'}));
  t.equal(sentUrl, 'https://example.com/usp?a=1&b=2', 'params serialized into the query');
  reset();
});

test('DELETE: positional data goes to the query; explicit options.data is the body', async t => {
  const seen = [];
  serve(request => {
    seen.push({url: request.url, body: request.body});
    return json({ok: true});
  });
  await io.delete('https://example.com/d', {soft: true});
  t.equal(seen[0].url, 'https://example.com/d?soft=true', 'positional data → query');
  t.equal(seen[0].body, undefined, 'no body from positional data');
  await io.delete('https://example.com/d2', null, {data: {ids: [1, 2]}});
  t.equal(seen[1].body, JSON.stringify({ids: [1, 2]}), 'explicit data → JSON body');
  reset();
});

test('decode forces the response parsing mode', async t => {
  serve(() => new Response('{"a":1}', {headers: {'content-type': 'text/plain'}}));
  t.equal(
    await io.get('https://example.com/dec1'),
    '{"a":1}',
    'text/plain decodes as text by default'
  );
  t.deepEqual(
    await io.get('https://example.com/dec2', null, {decode: 'json'}),
    {a: 1},
    'decode json overrides the content type'
  );
  reset();
});

test('makeKey canonicalizes: sorts query, drops fragment', t => {
  const a = io.makeKey({url: 'https://example.com/x?b=2&a=1#frag'});
  const b = io.makeKey({url: 'https://example.com/x', query: {a: 1, b: 2}});
  t.equal(a, b, 'order-independent key');
  t.equal(a, 'GET https://example.com/x?a=1&b=2', 'canonical form');
});
