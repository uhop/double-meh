import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

test('update: reads, applies fn, conditionally PUTs with the captured ETag', async t => {
  const srv = {value: {n: 1}, etag: '"v1"'};
  serve(request => {
    if (request.method === 'GET') return json(srv.value, {headers: {etag: srv.etag}});
    t.equal(request.headers.get('if-match'), '"v1"', 'PUT carries If-Match = the GET ETag');
    srv.value = JSON.parse(request.body);
    srv.etag = '"v2"';
    return json(srv.value, {headers: {etag: srv.etag}});
  });
  const result = await io.update('https://example.com/u/1', cur => ({...cur, n: cur.n + 1}));
  t.deepEqual(result, {n: 2}, 'returns the updated representation');
  reset();
});

test('update: a 412 conflict re-reads and retries with the fresh ETag', async t => {
  let etag = '"v1"';
  let gets = 0;
  let puts = 0;
  serve(request => {
    if (request.method === 'GET') return json({n: ++gets}, {headers: {etag}});
    if (++puts === 1) {
      etag = '"v2"';
      return new Response(null, {status: 412});
    }
    return new Response(request.body, {
      status: 200,
      headers: {'content-type': 'application/json', etag: '"v3"'}
    });
  });
  const result = await io.update('https://example.com/u/2', cur => ({...cur, x: 1}));
  t.equal(gets, 2, 're-read after the 412');
  t.equal(puts, 2, 'retried the PUT');
  t.equal(result.x, 1, 'change eventually applied');
  reset();
});

test('update: fn returning undefined is a no-op (no PUT)', async t => {
  let puts = 0;
  serve(request => {
    if (request.method !== 'GET') ++puts;
    return json({n: 1}, {headers: {etag: '"v1"'}});
  });
  const result = await io.update('https://example.com/u/3', () => undefined);
  t.equal(puts, 0, 'no PUT issued');
  t.deepEqual(result, {n: 1}, 'returns the current value');
  reset();
});
