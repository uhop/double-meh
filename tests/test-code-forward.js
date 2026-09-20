import test from 'tape-six';
import {io, json, serve, reset} from './helper.js';
import {installCodeForward} from '../src/code-forward.js';

const cleanup = async () => {
  await reset();
  delete globalThis.__doubleMeh;
};

test('drain: pre-load inFlight + arrived hand off without hitting the network', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  globalThis.__doubleMeh = {
    inFlight: ['https://example.com/cf-drain'],
    arrived: [['https://example.com/cf-drain', json({from: 'prelude'})]]
  };
  installCodeForward(io);
  const data = await io.get('https://example.com/cf-drain');
  t.equal(calls, 0, 'transport not called — adopted from the drained arrival');
  t.deepEqual(data, {from: 'prelude'}, 'served the prefetched body');
  await cleanup();
});

test('live: fly returns the key; arrived delivers a later response', async t => {
  let calls = 0;
  serve(() => json({from: 'network', n: ++calls}));
  globalThis.__doubleMeh = {};
  installCodeForward(io);
  const dm = globalThis.__doubleMeh;
  const key = dm.fly('https://example.com/cf-live');
  t.equal(key, 'GET https://example.com/cf-live', 'fly returns the normalized key');
  dm.arrived('https://example.com/cf-live', json({from: 'prelude'}));
  const data = await io.get('https://example.com/cf-live');
  t.equal(calls, 0, 'transport not called');
  t.deepEqual(data, {from: 'prelude'}, 'adopted the arrived response');
  await cleanup();
});

test('drain runs queued setup, passing io', async t => {
  let configured = false;
  globalThis.__doubleMeh = {setup: [arg => (configured = arg === io)]};
  installCodeForward(io);
  t.ok(configured, 'setup fn was called with io');
  await cleanup();
});

test('the global stays a protocol marker, not the io object', async t => {
  globalThis.__doubleMeh = {};
  installCodeForward(io);
  const dm = globalThis.__doubleMeh;
  t.equal(typeof dm.use, 'function', 'use installed');
  t.equal(typeof dm.fly, 'function', 'fly installed');
  t.equal(typeof dm.arrived, 'function', 'arrived installed');
  t.notOk('get' in dm, 'io API is not copied onto the marker');
  await cleanup();
});

test('ready event fires once on drain', async t => {
  let fired = 0;
  const onReady = () => ++fired;
  io.on('ready', onReady);
  globalThis.__doubleMeh = {};
  installCodeForward(io);
  t.equal(fired, 1, 'ready emitted once');
  io.off('ready', onReady);
  await cleanup();
});

// the drain itself, against a minimal io: only fly / adopt / emit are touched by installCodeForward
const fakeIO = log => ({
  track: {fly: target => log.push('fly:' + (target.url || target))},
  makeKey: target => String(target.url),
  adopt: (target, response) => {
    log.push('adopt:' + (target.url || target));
    return Promise.resolve(response);
  },
  emit: event => log.push('emit:' + event)
});

const withGlobal = async (value, body) => {
  const saved = globalThis.__doubleMeh;
  globalThis.__doubleMeh = value;
  try {
    return await body();
  } finally {
    globalThis.__doubleMeh = saved;
  }
};

test('a synchronous setup drains in one turn, before anything is adopted', async t => {
  const log = [];
  await withGlobal(
    {
      setup: [() => void log.push('setup')],
      inFlight: ['https://x/f'],
      arrived: [[{url: 'https://x/a'}, Promise.resolve(new Response('{}'))]]
    },
    async () => {
      installCodeForward(fakeIO(log));
      t.deepEqual(
        log,
        ['setup', 'fly:https://x/f', 'adopt:https://x/a', 'emit:ready'],
        'setup, then in-flight, then adoption, then ready — all synchronously'
      );
    }
  );
});

test('a setup callback returning a promise is awaited before anything is adopted', async t => {
  const log = [];
  let release;
  const gate = new Promise(resolve => (release = resolve));
  await withGlobal(
    {
      setup: [
        () => {
          log.push('setup:start');
          return gate.then(() => void log.push('setup:done'));
        }
      ],
      arrived: [[{url: 'https://x/a'}, Promise.resolve(new Response('{}'))]]
    },
    async () => {
      installCodeForward(fakeIO(log));
      t.deepEqual(log, ['setup:start'], 'nothing is adopted while setup is still running');
      release();
      await new Promise(resolve => setTimeout(resolve, 0));
      t.deepEqual(
        log,
        ['setup:start', 'setup:done', 'adopt:https://x/a', 'emit:ready'],
        'the hand-over lands only after setup settles'
      );
    }
  );
});

test('a setup callback that rejects still lets the prefetch land', async t => {
  const log = [];
  await withGlobal(
    {
      setup: [() => Promise.reject(new Error('backend import failed'))],
      arrived: [[{url: 'https://x/a'}, Promise.resolve(new Response('{}'))]]
    },
    async () => {
      installCodeForward(fakeIO(log));
      await new Promise(resolve => setTimeout(resolve, 0));
      t.deepEqual(
        log,
        ['adopt:https://x/a', 'emit:ready'],
        'a failed setup does not wedge the drain'
      );
    }
  );
});
