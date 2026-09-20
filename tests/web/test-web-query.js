import test from 'tape-six';

import {create} from '../../src/index.js';

// A real request to the test server, deliberately not mocked: the question is whether this
// engine puts QUERY and its body on the wire at all, which no mocked transport can answer.
const CRITERIA = {q: 'invoices', limit: 10};

test('web: the engine transmits QUERY with its body', async t => {
  const io = create();
  const echoed = await io.query('/--io/echo', CRITERIA, {cache: false});
  t.equal(echoed.method, 'QUERY', 'the method reached the server unchanged');
  t.deepEqual(JSON.parse(echoed.body), CRITERIA, 'and the criteria arrived as the body');
  t.notOk(new URL(echoed.url, location.href).search, 'nothing leaked into the query string');
});

test('web: a bare fetch transmits it too, without the library in the way', async t => {
  const response = await fetch('/--io/echo', {
    method: 'QUERY',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(CRITERIA)
  });
  const echoed = await response.json();
  t.equal(echoed.method, 'QUERY', 'fetch did not reject or rewrite the method');
  t.deepEqual(JSON.parse(echoed.body), CRITERIA, 'the body survived');
});

test('web: two criteria against one URL are two cache entries', async t => {
  const io = create();
  const scope = 'wq-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const url = '/--io/counters?scope=' + scope;

  await io.query(url, {q: 'a'});
  await io.cache.idle();
  await io.query(url, {q: 'a'});
  await io.query(url, {q: 'b'});
  await io.cache.idle();

  const keys = await io.cache.storage.keys();
  const mine = keys.filter(key => key.includes(scope));
  t.equal(mine.length, 2, 'one entry per set of criteria, not per URL');
  t.ok(
    mine.every(key => key.includes(' body=')),
    'and each key carries a body component'
  );
});
