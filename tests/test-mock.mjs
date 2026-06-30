import test from 'tape-six';
import io from '../src/index.js';

test('mock: an exact match returns the mocked value as JSON', async t => {
  io.mock('https://example.com/a', () => ({mocked: true}));
  t.deepEqual(await io.get('https://example.com/a'), {mocked: true}, 'served from the mock');
  io.mock.clear();
});

test('mock: a Response return is used verbatim', async t => {
  io.mock(
    'https://example.com/b',
    () => new Response('hi', {status: 201, headers: {'content-type': 'text/plain'}})
  );
  const env = await io.full.get('https://example.com/b');
  t.equal(env.status, 201, 'status from the mock Response');
  t.equal(env.data, 'hi', 'text body decoded');
  io.mock.clear();
});

test('mock: prefix matcher, callback receives the request', async t => {
  io.mock('https://example.com/users/*', request => ({url: request.url}));
  t.deepEqual(
    await io.get('https://example.com/users/42'),
    {url: 'https://example.com/users/42'},
    'prefix matched'
  );
  io.mock.clear();
});

test('mock: a function matcher selects by request', async t => {
  io.mock(
    request => request.method === 'POST',
    () => ({ok: true})
  );
  t.deepEqual(await io.post('https://example.com/x', {a: 1}), {ok: true}, 'matched the POST');
  io.mock.clear();
});

test('mock composes with retry: a 503 then a 200 is retried', async t => {
  let n = 0;
  io.mock(
    'https://example.com/flaky',
    () =>
      new Response(JSON.stringify({ok: true}), {
        status: ++n < 2 ? 503 : 200,
        headers: {'content-type': 'application/json'}
      })
  );
  const data = await io.get('https://example.com/flaky', null, {retries: 2, initDelay: 0});
  t.equal(n, 2, 'the mock was retried by the retry service');
  t.deepEqual(data, {ok: true});
  io.mock.clear();
});

test('mock: unmatched requests fall through to the transport', async t => {
  const original = io.defaultTransport;
  let reached = false;
  io.defaultTransport = () => {
    reached = true;
    return Promise.resolve(new Response('{}', {headers: {'content-type': 'application/json'}}));
  };
  io.mock('https://example.com/only-this', () => ({}));
  await io.get('https://example.com/other');
  t.ok(reached, 'non-mocked request reached the transport');
  io.mock.clear();
  io.defaultTransport = original;
});
