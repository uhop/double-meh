import test from 'tape-six';
import {io, json, serve, reset} from './helper.js';

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
  await reset();
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
  await reset();
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
  await reset();
});

test('getByIds: the GET form stays under the default limit', async t => {
  echo();
  t.equal(io.getByIds.urlLimit, 2000, 'default URL limit');
  const ids = Array.from({length: 50}, (_, i) => 'id-' + i);
  const result = await io.getByIds('https://example.com/users/by-ids', ids);
  t.equal(result.method, 'GET', '50 short ids still fit in a GET');
  await reset();
});

test('getByIds: the overflow body can go as a QUERY instead, and stays a cacheable read', async t => {
  let calls = 0;
  serve(async request => {
    ++calls;
    return json({
      method: request.method,
      body: request.body != null ? await new Response(request.body).text() : null
    });
  });
  const savedLimit = io.getByIds.urlLimit;
  const savedOverflow = io.getByIds.overflow;
  io.getByIds.urlLimit = 60;
  io.getByIds.overflow = 'query';
  const url = 'https://example.com/users/by-ids';
  const ids = ['yr8', '6Rc', '3kTMd', 'aLongIdentifier-0001', 'aLongIdentifier-0002'];

  const first = await io.getByIds(url, ids);
  t.equal(first.method, 'QUERY', 'the overflow went as a QUERY');
  t.deepEqual(JSON.parse(first.body), {keys: ids}, 'carrying the same {keys} body');

  await io.cache.idle();
  const repeat = await io.getByIds(url, ids);
  t.deepEqual(repeat, first, 'a repeat is served from the cache');
  t.equal(calls, 1, 'which a POST overflow could never be');

  const others = [...ids.slice(0, 4), 'aLongIdentifier-0003'];
  await io.getByIds(url, others);
  t.equal(calls, 2, 'a different id list is a different entry, not a collision');

  io.getByIds.urlLimit = savedLimit;
  io.getByIds.overflow = savedOverflow;
  await reset();
});

test('getByIds: the overflow default is POST, and an unknown value falls back to it', async t => {
  echo();
  const savedLimit = io.getByIds.urlLimit;
  const savedOverflow = io.getByIds.overflow;
  io.getByIds.urlLimit = 60;
  const ids = ['aLongIdentifier-0001', 'aLongIdentifier-0002', 'aLongIdentifier-0003'];

  t.equal(io.getByIds.overflow, 'post', 'POST by default');
  const byDefault = await io.getByIds('https://example.com/users/by-ids', ids);
  t.equal(byDefault.method, 'POST', 'so nothing changes for an existing caller');

  io.getByIds.overflow = 'nonsense';
  const unknown = await io.getByIds('https://example.com/users/by-ids', ids);
  t.equal(unknown.method, 'POST', 'and an unrecognized mode stays on the safe side');

  io.getByIds.urlLimit = savedLimit;
  io.getByIds.overflow = savedOverflow;
  await reset();
});
