import test from 'tape-six';
import {io, json, serve, reset} from './helper.js';

const U = 'https://example.com/totals';
const entryFor = (url = U) => io.cache.storage.get(io.makeKey({url}));
const secondsLeft = entry => Math.round((entry.expiresAt - Date.now()) / 1000);
// Expires carries whole seconds and a write costs a few milliseconds, so the arithmetic lands
// within a second of the intention rather than on it
const about = (entry, expected, what) => [
  Math.abs(secondsLeft(entry) - expected) <= 1,
  what + ' (expected about ' + expected + 's, got ' + secondsLeft(entry) + 's)'
];

const answer = headers => serve(() => json({total: 1}, {headers}));

test('cache headers: a positive max-age sets the TTL', async t => {
  answer({'cache-control': 'public, max-age=3600'});
  await io.get(U);
  await io.cache.idle();
  t.ok(...about(await entryFor(), 3600, 'the server schedule won over defaultTtl'));
  await reset();
});

test('cache headers: a future Expires works too, and a past one does not', async t => {
  answer({expires: new Date(Date.now() + 90 * 1000).toUTCString()});
  await io.get(U);
  await io.cache.idle();
  t.ok(...about(await entryFor(), 90, 'Expires in the future is a schedule'));
  await reset();

  answer({expires: new Date(Date.now() - 90 * 1000).toUTCString()});
  await io.get(U);
  await io.cache.idle();
  t.ok(...about(await entryFor(), io.cache.defaultTtl / 1000, 'a past Expires is not a schedule'));
  await reset();
});

test('cache headers: the negative forms are ignored, being the absence of a schedule', async t => {
  for (const control of ['no-cache', 'max-age=0', 'must-revalidate, max-age=600']) {
    answer({'cache-control': control});
    await io.get(U);
    await io.cache.idle();
    t.ok(...about(await entryFor(), io.cache.defaultTtl / 1000, control + ' fell through'));
    await reset();
  }
});

test('cache headers: the precedence is explicit ttl, then server, then default', async t => {
  answer({'cache-control': 'max-age=3600'});
  await io.get(U, null, {cache: {ttl: 30 * 1000}});
  await io.cache.idle();
  t.ok(...about(await entryFor(), 30, 'an explicit ttl beats the server'));
  await reset();

  answer({'cache-control': 'max-age=3600'});
  await io.get(U, null, {cache: {fromHeaders: false}});
  await io.cache.idle();
  t.ok(...about(await entryFor(), io.cache.defaultTtl / 1000, 'fromHeaders: false ignores it'));
  await reset();

  const saved = io.cache.fromHeaders;
  io.cache.fromHeaders = false;
  answer({'cache-control': 'max-age=3600'});
  await io.get(U);
  await io.cache.idle();
  t.ok(...about(await entryFor(), io.cache.defaultTtl / 1000, 'the switch works service-wide'));
  io.cache.fromHeaders = saved;
  await reset();
});

test('cache headers: Vary: * is uncacheable, unless the application says otherwise', async t => {
  let calls = 0;
  serve(() => {
    ++calls;
    return json({n: calls}, {headers: {vary: '*'}});
  });
  await io.get(U);
  await io.cache.idle();
  t.notOk(await entryFor(), 'nothing stored by default');
  await io.get(U);
  t.equal(calls, 2, 'so every read is a request');
  await reset();

  calls = 0;
  serve(() => {
    ++calls;
    return json({n: calls}, {headers: {vary: '*'}});
  });
  await io.get(U, null, {cache: {vary: false}});
  await io.cache.idle();
  t.ok(await entryFor(), 'the override stores it');
  t.deepEqual(await io.get(U, null, {cache: {vary: false}}), {n: 1}, 'and serves it back');
  t.equal(calls, 1, 'one request');
  await reset();
});

test('cache headers: vary: false keeps one entry per URL', async t => {
  let calls = 0;
  serve(() => {
    ++calls;
    return json({n: calls}, {headers: {vary: 'accept-language'}});
  });
  const opts = lang => ({cache: {vary: false}, headers: {'accept-language': lang}});
  await io.get(U, null, opts('en'));
  await io.cache.idle();
  const second = await io.get(U, null, opts('fr'));
  t.deepEqual(second, {n: 1}, 'a different language reads the same entry');
  t.equal(calls, 1, 'because the application handles variance itself');
  await reset();
});

test('cache headers: a no-store response is cached, but never in the durable backend', async t => {
  let calls = 0;
  serve(() => {
    ++calls;
    return json({n: calls}, {headers: {'cache-control': 'no-store'}});
  });
  const url = 'https://example.com/statement';
  const key = io.makeKey({url});

  const first = await io.get(url);
  await io.cache.idle();
  t.notOk(await io.cache.storage.get(key), 'nothing reached the configured backend');
  t.ok(await io.cache.volatile.get(key), 'it went to the volatile tier');

  const second = await io.get(url);
  t.deepEqual(second, first, 'and it is served from there');
  t.equal(calls, 1, 'so the read still costs one request');

  await io.cache.clear();
  t.notOk(await io.cache.volatile.get(key), 'clear() spans both tiers');
  await reset();
});

test('cache headers: remove and sweep span the volatile tier too', async t => {
  serve(request =>
    json(
      {ok: 1},
      {
        headers: new URL(request.url).pathname.startsWith('/private')
          ? {'cache-control': 'no-store'}
          : {}
      }
    )
  );
  const priv = 'https://example.com/private/1';
  const pub = 'https://example.com/public/1';
  await io.get(priv);
  await io.get(pub);
  await io.cache.idle();
  t.ok(await io.cache.volatile.get(io.makeKey({url: priv})), 'the private one is volatile');
  t.ok(await io.cache.storage.get(io.makeKey({url: pub})), 'the public one is durable');

  await io.cache.remove('https://example.com/private/*');
  t.notOk(await io.cache.volatile.get(io.makeKey({url: priv})), 'remove reached the volatile tier');
  t.ok(await io.cache.storage.get(io.makeKey({url: pub})), 'and left the other alone');

  await io.get(priv);
  await io.cache.idle();
  const entry = await io.cache.volatile.get(io.makeKey({url: priv}));
  entry.expiresAt = Date.now() - 1;
  await io.cache.volatile.set(io.makeKey({url: priv}), entry);
  await io.cache.sweep();
  t.notOk(await io.cache.volatile.get(io.makeKey({url: priv})), 'sweep reached it as well');
  await reset();
});
