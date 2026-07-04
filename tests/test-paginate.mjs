import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';

const dataset = n => Array.from({length: n}, (_, i) => ({n: i}));

test('paginate: offset envelope with a total', async t => {
  const all = dataset(5);
  const urls = [];
  serve(request => {
    urls.push(request.url);
    const u = new URL(request.url);
    const offset = Number(u.searchParams.get('offset')) || 0;
    const limit = Number(u.searchParams.get('limit')) || 2;
    return json({data: all.slice(offset, offset + limit), offset, limit, total: all.length});
  });
  const rows = [];
  for await (const row of io.paginate('https://example.com/list', null, {page: {limit: 2}})) {
    rows.push(row);
  }
  t.deepEqual(rows, all, 'all rows in order');
  t.equal(urls.length, 3, 'exactly three pages fetched — total stops the loop');
  t.ok(urls[0].includes('limit=2'), 'the page option lowered to query params');
  t.ok(
    urls[1].includes('offset=2') && urls[1].includes('limit=2'),
    'offset advanced by items.length'
  );
  reset();
});

test('paginate: advances by what arrived, not the requested limit', async t => {
  const all = dataset(4);
  const urls = [];
  serve(request => {
    urls.push(request.url);
    const u = new URL(request.url);
    const offset = Number(u.searchParams.get('offset')) || 0;
    // the server clamps the requested limit=100 to 2 and echoes the effective value
    return json({data: all.slice(offset, offset + 2), offset, limit: 2, total: all.length});
  });
  const rows = [];
  for await (const row of io.paginate('https://example.com/clamp', null, {page: {limit: 100}})) {
    rows.push(row);
  }
  t.deepEqual(rows, all, 'no rows skipped despite the clamp');
  t.ok(urls[1].includes('offset=2'), 'the echoed page size drives the offset, not the request');
  t.ok(urls[1].includes('limit=2'), 'the echoed effective limit is reused');
  reset();
});

test('paginate: offset envelope without a total stops on a short page', async t => {
  const all = dataset(5);
  const urls = [];
  serve(request => {
    urls.push(request.url);
    const u = new URL(request.url);
    const offset = Number(u.searchParams.get('offset')) || 0;
    return json({data: all.slice(offset, offset + 2), offset, limit: 2});
  });
  const rows = [];
  for await (const row of io.paginate('https://example.com/nototal', null, {page: {limit: 2}})) {
    rows.push(row);
  }
  t.deepEqual(rows, all, 'all rows in order');
  t.equal(urls.length, 3, 'the short last page ends the loop without an extra request');
  reset();
});

test('paginate: body links drive the loop; their absence is the last page', async t => {
  const all = dataset(4);
  const urls = [];
  serve(request => {
    urls.push(request.url);
    const u = new URL(request.url);
    const offset = Number(u.searchParams.get('offset')) || 0;
    const body = {data: all.slice(offset, offset + 2), offset, limit: 2, links: {}};
    if (offset + 2 < all.length) body.links.next = '/linked?offset=' + (offset + 2);
    return json(body);
  });
  const rows = [];
  for await (const row of io.paginate('https://example.com/linked')) rows.push(row);
  t.deepEqual(rows, all, 'all rows in order');
  t.equal(urls.length, 2, 'two pages');
  t.ok(urls[1].startsWith('https://example.com/linked?offset=2'), 'relative next resolved');
  reset();
});

test('paginate: cursor envelope; a null cursor is the last page', async t => {
  const all = dataset(4);
  const urls = [];
  serve(request => {
    urls.push(request.url);
    const u = new URL(request.url);
    const cursor = u.searchParams.get('cursor');
    const offset = cursor ? Number(cursor.slice(1)) : 0;
    const data = all.slice(offset, offset + 2);
    const next = offset + 2 < all.length ? 'c' + (offset + 2) : null;
    return json({data, limit: 2, cursor: next});
  });
  const rows = [];
  for await (const row of io.paginate('https://example.com/cursor', null, {page: {limit: 2}})) {
    rows.push(row);
  }
  t.deepEqual(rows, all, 'all rows in order');
  t.equal(urls.length, 2, 'two pages');
  t.ok(urls[1].includes('cursor=c2'), 'the opaque cursor echoed back');
  t.ok(urls[1].includes('limit=2'), 'the effective limit rides along');
  reset();
});

test('paginate: a bare array pages by the Link header', async t => {
  const all = dataset(4);
  const urls = [];
  serve(request => {
    urls.push(request.url);
    const u = new URL(request.url);
    const offset = Number(u.searchParams.get('offset')) || 0;
    const headers = {};
    if (offset + 2 < all.length) {
      headers.link = '<https://example.com/bare?offset=' + (offset + 2) + '>; rel="next"';
    }
    return json(all.slice(offset, offset + 2), {headers});
  });
  const rows = [];
  for await (const row of io.paginate('https://example.com/bare')) rows.push(row);
  t.deepEqual(rows, all, 'all rows in order');
  t.equal(urls.length, 2, 'header links followed; absence ends the loop');
  reset();
});

test('paginate: a repeating next link throws instead of looping', async t => {
  serve(() => json({data: [{n: 0}], links: {next: 'https://example.com/loop'}}));
  try {
    for await (const row of io.paginate('https://example.com/loop')) void row;
    t.fail('a self-referential next should throw');
  } catch (error) {
    t.ok(error instanceof io.FailedIO, 'FailedIO on a page loop');
  }
  reset();
});

test('paginate: a non-list response throws FailedIO', async t => {
  serve(() => json({nope: true}));
  try {
    for await (const row of io.paginate('https://example.com/bad')) void row;
    t.fail('a non-list body should throw');
  } catch (error) {
    t.ok(error instanceof io.FailedIO, 'FailedIO on an unrecognized shape');
  }
  reset();
});

test('paginate: lazy — no request until the first iteration', async t => {
  let calls = 0;
  serve(() => {
    ++calls;
    return json([]);
  });
  const rows = io.paginate('https://example.com/lazy');
  await Promise.resolve();
  t.equal(calls, 0, 'creating the iterator fires nothing');
  await rows.next();
  t.equal(calls, 1, 'the first next() fires the request');
  reset();
});
