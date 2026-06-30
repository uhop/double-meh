import test from 'tape-six';
import {io, json, serve, reset} from './helper.mjs';
import {installCodeForward} from '../src/code-forward.js';

const cleanup = () => {
  reset();
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
  cleanup();
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
  cleanup();
});

test('drain runs queued setup, passing io', t => {
  let configured = false;
  globalThis.__doubleMeh = {setup: [arg => (configured = arg === io)]};
  installCodeForward(io);
  t.ok(configured, 'setup fn was called with io');
  cleanup();
});

test('ready event fires once on drain', t => {
  let fired = 0;
  const onReady = () => ++fired;
  io.on('ready', onReady);
  globalThis.__doubleMeh = {};
  installCodeForward(io);
  t.equal(fired, 1, 'ready emitted once');
  io.off('ready', onReady);
  cleanup();
});
