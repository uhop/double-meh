// @ts-self-types="./sw.d.ts"
// page half of the SW message contract v1 — lockstep with double-meh-sw src/{contract,messages}.js

import {canonicalUrl} from './key.js';

const HELLO = 'io:hello';
const FETCH = 'io:fetch';
const RESULT = 'io:result';
const INVALIDATE = 'io:invalidate';
const INVALIDATED = 'io:invalidated';

// lockstep: double-meh-sw cache-tier default; bundle's writeThrough === true lands here
export const SHARED_CACHE = 'io-shared';
// lockstep: double-meh-sw broadcasts io:invalidated on this channel
export const CHANNEL = 'io';

const nullBodyStatus = {204: true, 205: true, 304: true};

export const installSW = (io, options = {}) => {
  const {
    library = 'double-meh',
    serviceWorker = globalThis.navigator && globalThis.navigator.serviceWorker,
    helloTimeout = 500
  } = /** @type {import('./sw.d.ts').SWInstallOptions} */ (options);

  let counter = 0;

  const target = async opts => {
    if (!serviceWorker)
      throw new io.FailedIO('io: this environment has no Service Worker support', undefined, opts);
    if (serviceWorker.controller) return serviceWorker.controller;
    const registration = await serviceWorker.getRegistration();
    const active = registration && (registration.active || (await serviceWorker.ready).active);
    if (!active) throw new io.FailedIO('io: no active Service Worker', undefined, opts);
    return active;
  };

  const transport = async (request, ctx) => {
    if (request.body != null)
      throw new io.FailedIO(
        'io: the sw transport carries no request bodies',
        undefined,
        ctx.options
      );
    const worker = await target(ctx.options);
    const id = ++counter;
    const channel = new MessageChannel();
    try {
      return await new Promise((resolve, reject) => {
        channel.port1.onmessage = event => {
          const data = event.data;
          if (!data || data.type !== RESULT || data.id !== id) return;
          if (data.error != null) {
            reject(
              new io.FailedIO('io: the sw transport failed: ' + data.error, undefined, ctx.options)
            );
          } else {
            resolve(
              new Response(nullBodyStatus[data.status] ? null : data.body, {
                status: data.status,
                statusText: data.statusText,
                headers: data.headers
              })
            );
          }
        };
        worker.postMessage(
          {
            type: FETCH,
            id,
            url: request.url,
            method: request.method,
            headers: [...request.headers]
          },
          [channel.port2]
        );
      });
    } finally {
      channel.port1.close();
    }
  };

  const disconnect = () => {
    if (!sw.connected) return;
    sw.connected = false;
    sw.contract = 0;
    sw.version = '';
    sw.capabilities = [];
    io.emit('sw', sw);
  };

  const hello = async () => {
    let worker;
    try {
      worker = await target(undefined);
    } catch {
      return null;
    }
    const channel = new MessageChannel();
    try {
      return await new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), helloTimeout);
        if (typeof timer === 'object' && timer.unref) timer.unref();
        channel.port1.onmessage = event => {
          const data = event.data;
          if (!data || data.type !== HELLO) return;
          clearTimeout(timer);
          sw.connected = true;
          sw.contract = data.v || 0;
          sw.version = data.version || '';
          sw.capabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
          io.emit('sw', sw);
          resolve(sw);
        };
        worker.postMessage({type: HELLO, library}, [channel.port2]);
      });
    } finally {
      channel.port1.close();
    }
  };

  const sw = (io.sw = {
    library,
    supported: !!serviceWorker,
    connected: false,
    contract: 0,
    version: '',
    capabilities: [],
    hello
  });

  io.registerTransport('sw', transport);

  if (serviceWorker) {
    if (serviceWorker.controller) hello();
    if (typeof serviceWorker.addEventListener === 'function') {
      // a new controller starts with an empty client registry: re-announce for client-wins
      serviceWorker.addEventListener('controllerchange', () => {
        disconnect();
        hello();
      });
    }
  }

  return io;
};

// keys are 'METHOD <canonical url>[ accept=…]'; canonical URLs carry no raw spaces
const urlOfKey = key => key.slice(key.indexOf(' ') + 1).split(' accept=')[0];

export const installChannel = (io, options = {}) => {
  const {
    name = CHANNEL,
    serviceWorker = globalThis.navigator && globalThis.navigator.serviceWorker
  } = /** @type {import('./sw.d.ts').ChannelInstallOptions} */ (options);

  const channel = /** @type {(BroadcastChannel & {unref?: () => void}) | null} */ (
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null
  );
  // CLI: an idle channel must not hold the event loop open
  if (channel && typeof channel.unref === 'function') channel.unref();

  const original = io.cache && io.cache.remove;

  // key-space RegExp/predicates cannot cross into URL space: string forms only
  const wirePattern = pattern =>
    typeof pattern === 'string'
      ? canonicalUrl(pattern.endsWith('*') ? pattern.slice(0, -1) : pattern)
      : undefined;

  const propagate = pattern => {
    const wire = wirePattern(pattern);
    if (wire === undefined) return;
    const controller = /** @type {import('./sw.d.ts').SWEndpoint | null} */ (
      (serviceWorker && serviceWorker.controller) || null
    );
    if (controller) controller.postMessage({type: INVALIDATE, pattern: wire});
    // a connected SW is the fan-out hub; otherwise reach the other tabs directly
    if (channel && !(controller && io.sw && io.sw.connected)) {
      channel.postMessage({type: INVALIDATED, pattern: wire});
    }
  };

  if (original) {
    io.cache.remove = pattern => {
      propagate(pattern);
      return original(pattern);
    };
  }

  const onMessage = event => {
    const data = event.data;
    if (!data || data.type !== INVALIDATED || data.pattern == null || !original) return;
    const pattern = data.pattern;
    const test =
      pattern instanceof RegExp ? url => pattern.test(url) : url => url.startsWith(String(pattern));
    // the unwrapped remove: an incoming eviction must not re-broadcast
    original(key => test(urlOfKey(key))).catch(() => {});
  };
  if (channel) channel.addEventListener('message', onMessage);

  io.channel = {
    name,
    active: !!channel,
    close: () => {
      if (channel) {
        channel.removeEventListener('message', onMessage);
        channel.close();
      }
      if (original) io.cache.remove = original;
      io.channel.active = false;
    }
  };

  return io;
};
