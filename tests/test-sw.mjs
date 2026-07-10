import test from 'tape-six';

import {io} from './helper.mjs';
import {makeWorker, makeContainer, tick} from './helper-sw.mjs';
import {installSW} from '../src/sw.js';

const BASE = 'https://example.com';

test('sw: install shape and the hello handshake', async t => {
  const dm = io.create();
  const worker = makeWorker();
  installSW(dm, {serviceWorker: makeContainer(worker)});
  t.equal(typeof dm.transports.sw, 'function', 'the sw transport is registered');
  t.ok(dm.sw.supported, 'support detected');
  const state = await dm.sw.hello();
  t.ok(state, 'hello answered');
  t.ok(dm.sw.connected, 'connected');
  t.equal(dm.sw.contract, 1, 'contract v1 negotiated');
  t.equal(dm.sw.version, 'sw-test', 'SW version recorded');
  t.deepEqual(dm.sw.capabilities, ['cache', 'bundle', 'transport'], 'capabilities recorded');
  const hello = worker.seen.find(message => message.type === 'io:hello');
  t.ok(hello, 'io:hello announced');
  t.equal(hello.library, 'double-meh', 'the library name rides the announce');
});

test('sw: transport round-trip through the full pipeline', async t => {
  const dm = io.create();
  const worker = makeWorker({routes: {[BASE + '/data']: {body: {hello: 'sw'}}}});
  installSW(dm, {serviceWorker: makeContainer(worker)});
  const data = await dm.get(BASE + '/data', null, {transport: 'sw'});
  t.deepEqual(data, {hello: 'sw'}, 'the body decoded through the pipeline');
  const sent = worker.seen.find(message => message.type === 'io:fetch');
  t.ok(sent, 'io:fetch crossed the channel');
  t.equal(sent.method, 'GET', 'method rides along');
  t.equal(sent.url, BASE + '/data', 'url rides along');
  t.ok(Array.isArray(sent.headers), 'headers ride as entries');
});

test('sw: transport works on uncontrolled pages', async t => {
  const dm = io.create();
  const worker = makeWorker({routes: {[BASE + '/first-visit']: {body: {early: true}}}});
  const container = makeContainer(worker);
  container.controller = null;
  installSW(dm, {serviceWorker: container});
  const data = await dm.get(BASE + '/first-visit', null, {transport: 'sw'});
  t.deepEqual(data, {early: true}, 'reached the registration before control');
});

test('sw: null-body statuses mint cleanly', async t => {
  const dm = io.create();
  const worker = makeWorker({routes: {[BASE + '/empty']: {status: 204, headers: []}}});
  installSW(dm, {serviceWorker: makeContainer(worker)});
  const envelope = await dm.full.get(BASE + '/empty', null, {transport: 'sw'});
  t.equal(envelope.response.status, 204, 'status preserved');
  t.equal(envelope.data, undefined, 'no body');
});

test('sw: a worker error becomes FailedIO', async t => {
  const dm = io.create();
  const worker = makeWorker({routes: {[BASE + '/bad']: {error: 'boom'}}});
  installSW(dm, {serviceWorker: makeContainer(worker)});
  try {
    await dm.get(BASE + '/bad', null, {transport: 'sw'});
    t.fail('should have thrown');
  } catch (error) {
    t.ok(error instanceof dm.FailedIO, 'FailedIO');
    t.ok(String(error.message).includes('boom'), 'carries the SW error text');
  }
});

test('sw: request bodies are refused', async t => {
  const dm = io.create();
  const worker = makeWorker();
  installSW(dm, {serviceWorker: makeContainer(worker)});
  try {
    await dm.post(BASE + '/write', {a: 1}, {transport: 'sw'});
    t.fail('should have thrown');
  } catch (error) {
    t.ok(error instanceof dm.FailedIO, 'FailedIO');
    t.ok(String(error.message).includes('no request bodies'), 'names the constraint');
  }
});

test('sw: no Service Worker support', async t => {
  const dm = io.create();
  installSW(dm, {serviceWorker: null});
  t.notOk(dm.sw.supported, 'not supported');
  t.equal(await dm.sw.hello(), null, 'hello resolves null');
  try {
    await dm.get(BASE + '/data', null, {transport: 'sw'});
    t.fail('should have thrown');
  } catch (error) {
    t.ok(error instanceof dm.FailedIO, 'FailedIO');
  }
});

test('sw: hello times out on a silent worker', async t => {
  const dm = io.create();
  const silent = {
    seen: [],
    postMessage(message) {
      this.seen.push(message);
    }
  };
  installSW(dm, {serviceWorker: makeContainer(silent), helloTimeout: 20});
  t.equal(await dm.sw.hello(), null, 'no reply resolves null');
  t.notOk(dm.sw.connected, 'not connected');
});

test('sw: controllerchange re-announces to the new controller', async t => {
  const dm = io.create();
  const first = makeWorker({version: 'one'});
  const container = makeContainer(first);
  installSW(dm, {serviceWorker: container});
  const events = [];
  dm.on('sw', state => events.push({connected: state.connected, version: state.version}));
  await dm.sw.hello();
  t.equal(dm.sw.version, 'one', 'connected to the first controller');

  const second = makeWorker({version: 'two'});
  container.controller = second;
  for (const fn of container.listeners.controllerchange) fn();
  for (let i = 0; i < 50 && dm.sw.version !== 'two'; ++i) await tick();

  t.equal(dm.sw.version, 'two', 're-announced to the new controller');
  t.ok(dm.sw.connected, 'reconnected');
  t.ok(
    events.some(event => !event.connected),
    'the disconnect was observable'
  );
  t.ok(
    second.seen.find(message => message.type === 'io:hello'),
    'the new controller got the hello'
  );
});
