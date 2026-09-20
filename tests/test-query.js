import test from 'tape-six';
import {io, json, serve, reset} from './helper.js';

const U = 'https://example.com/search';

test('QUERY sends its criteria as a body and returns the decoded answer', async t => {
  let seen;
  serve(request => {
    seen = {method: request.method, body: request.body, url: request.url};
    return json({hits: 2});
  });
  const data = await io.query(U, {q: 'invoices'});
  t.equal(seen.method, 'QUERY', 'the verb reaches the wire');
  t.deepEqual(JSON.parse(seen.body), {q: 'invoices'}, 'the criteria ride in the body');
  t.equal(seen.url, U, 'and not in the query string');
  t.deepEqual(data, {hits: 2}, 'the response decodes as usual');
  await reset();
});

test('QUERY is cached, and the body is part of the identity', async t => {
  let calls = 0;
  serve(request => json({n: ++calls, for: JSON.parse(request.body).q}));

  t.deepEqual(await io.query(U, {q: 'a'}), {n: 1, for: 'a'}, 'first criteria');
  await io.cache.idle();
  t.deepEqual(await io.query(U, {q: 'a'}), {n: 1, for: 'a'}, 'repeat is served from the cache');
  t.equal(calls, 1, 'no second request');

  t.deepEqual(await io.query(U, {q: 'b'}), {n: 2, for: 'b'}, 'other criteria are a miss');
  t.equal(calls, 2, 'and reach the wire');
  await reset();
});

test('concurrent QUERYs collapse per body, not per URL', async t => {
  let calls = 0;
  serve(async request => {
    ++calls;
    const {q} = JSON.parse(request.body);
    return json({q});
  });
  const [a, b, c] = await Promise.all([
    io.query(U, {q: 'a'}),
    io.query(U, {q: 'a'}),
    io.query(U, {q: 'b'})
  ]);
  t.equal(calls, 2, 'two distinct bodies, two requests');
  t.deepEqual([a, b, c], [{q: 'a'}, {q: 'a'}, {q: 'b'}], 'and every caller got its own answer');
  await reset();
});

test('a QUERY whose body cannot be keyed is not shared', async t => {
  const stream = new ReadableStream({
    start(controller) {
      controller.close();
    }
  });
  t.notOk(io.cache.optIn({method: 'QUERY', url: U, data: stream}), 'an unkeyable body is uncached');
  t.notOk(io.track.optIn({method: 'QUERY', url: U, data: stream}), 'and undeduped');
  t.ok(
    io.cache.optIn({method: 'QUERY', url: U, data: stream, variant: 'invoices'}),
    'a variant restores it'
  );
  t.ok(io.cache.optIn({method: 'QUERY', url: U, data: {q: 'a'}}), 'a stable body needs no variant');
  await reset();
});

test('variant disambiguates a hand-over that the body alone cannot', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));

  io.adopt({method: 'POST', url: U, variant: 'invoices'}, json({for: 'invoices'}));
  io.adopt({method: 'POST', url: U, variant: 'receipts'}, json({for: 'receipts'}));
  await new Promise(resolve => setTimeout(resolve, 20));

  t.deepEqual(
    await io.post({url: U, variant: 'receipts'}, {q: 'receipts'}),
    {for: 'receipts'},
    'each hand-over is reachable'
  );
  t.deepEqual(
    await io.post({url: U, variant: 'invoices'}, {q: 'invoices'}),
    {for: 'invoices'},
    'and they do not collide'
  );
  t.equal(calls, 0, 'neither reached the wire');
  await reset();
});

test('an unsafe verb is still never shared on its own', async t => {
  let calls = 0;
  serve(() => json({n: ++calls}));
  const three = await Promise.all([io.post(U, {q: 1}), io.post(U, {q: 2}), io.post(U, {q: 1})]);
  t.equal(calls, 3, 'three POSTs stay three requests, variant or no variant');
  t.deepEqual(
    three.map(r => r.n),
    [1, 2, 3],
    'each with its own response'
  );
  await reset();
});
