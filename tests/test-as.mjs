import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

const ctOf = async (as, body = 'raw') => {
  let ct;
  serve(request => {
    ct = request.headers.get('content-type');
    return json({ok: 1});
  });
  await io.put('https://example.com/x', body, {as});
  reset();
  return ct;
};

test('as: known aliases map to their media types', async t => {
  t.equal(await ctOf('json'), 'application/json', 'json');
  t.equal(await ctOf('ndjson'), 'application/x-ndjson', 'ndjson');
  t.equal(await ctOf('jsonl'), 'application/x-ndjson', 'jsonl aliases ndjson');
  t.equal(await ctOf('merge-patch'), 'application/merge-patch+json', 'merge-patch');
  t.equal(await ctOf('json-patch'), 'application/json-patch+json', 'json-patch');
  t.equal(await ctOf('text'), 'text/plain', 'text');
  t.equal(await ctOf('csv'), 'text/csv', 'csv');
  t.equal(await ctOf('form'), 'application/x-www-form-urlencoded', 'form');
  t.equal(await ctOf('octet'), 'application/octet-stream', 'octet');
});

test('as: a full media-type string passes through verbatim', async t => {
  t.equal(await ctOf('application/vnd.foo+json'), 'application/vnd.foo+json', 'vendor type');
  t.equal(await ctOf('text/csv;charset=utf-8'), 'text/csv;charset=utf-8', 'parameters preserved');
});

test('as: an unknown non-media-type token sets nothing', async t => {
  t.equal(await ctOf('nope'), null, 'no slash and not in registry → no content-type');
});

test('as: an explicit content-type header wins over as (and over object auto-json)', async t => {
  let ct;
  serve(request => {
    ct = request.headers.get('content-type');
    return json({ok: 1});
  });
  await io.put(
    'https://example.com/x',
    {a: 1},
    {as: 'json', headers: {'content-type': 'text/plain'}}
  );
  t.equal(ct, 'text/plain', 'caller-set content-type is not overridden');
  reset();
});

test('io.mimeTypes is a mutable registry', async t => {
  io.mimeTypes.widget = 'application/x-widget';
  t.equal(await ctOf('widget'), 'application/x-widget', 'added alias resolves');
  delete io.mimeTypes.widget;
  t.equal(await ctOf('widget'), null, 'deleted alias stops resolving');

  const saved = io.mimeTypes.csv;
  delete io.mimeTypes.csv;
  t.equal(await ctOf('csv'), null, 'removing a built-in alias takes effect');
  io.mimeTypes.csv = saved;
  t.equal(await ctOf('csv'), 'text/csv', 'restored');
});
