import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

const echo = () =>
  serve(async request =>
    json({
      method: request.method,
      url: request.url,
      body: request.body != null ? await new Response(request.body).text() : null
    })
  );

test('getByIds: a comma-joined ?ids= GET', async t => {
  echo();
  const result = await io.getByIds('https://example.com/products/by-ids', ['ap-31', 'ap-77']);
  t.equal(result.method, 'GET', 'a plain GET');
  t.ok(result.url.includes('ids=ap-31%2Cap-77'), 'ids comma-joined in one parameter');
  t.equal(result.body, null, 'no body');
  reset();
});

test('getByIds: numeric ids and other query params compose', async t => {
  echo();
  const result = await io.getByIds('https://example.com/users/by-ids', [1, 2, 3], {
    fields: ['name'],
    query: {expandable: 'no'}
  });
  const url = new URL(result.url);
  t.equal(url.searchParams.get('ids'), '1,2,3', 'numbers joined');
  t.equal(url.searchParams.get('fields'), 'name', 'fields lowering still applies');
  t.equal(url.searchParams.get('expandable'), 'no', 'user query params preserved');
  reset();
});

test('getByIds: an overflowing URL falls back to a POST body', async t => {
  echo();
  const saved = io.getByIds.urlLimit;
  io.getByIds.urlLimit = 60;
  const ids = ['yr8', '6Rc', '3kTMd', 'aLongIdentifier-0001', 'aLongIdentifier-0002'];
  const result = await io.getByIds('https://example.com/users/by-ids', ids);
  t.equal(result.method, 'POST', 'fell back to POST — still a read');
  t.notOk(result.url.includes('ids='), 'the id list left the URL');
  t.deepEqual(JSON.parse(result.body), {keys: ids}, 'the id list moved to the body as {keys}');
  io.getByIds.urlLimit = saved;
  reset();
});

test('getByIds: the GET form stays under the default limit', async t => {
  echo();
  t.equal(io.getByIds.urlLimit, 2000, 'default URL limit');
  const ids = Array.from({length: 50}, (_, i) => 'id-' + i);
  const result = await io.getByIds('https://example.com/users/by-ids', ids);
  t.equal(result.method, 'GET', '50 short ids still fit in a GET');
  reset();
});
