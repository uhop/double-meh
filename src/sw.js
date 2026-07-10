// @ts-self-types="./sw.d.ts"
// page half of the SW message contract v1 — lockstep with double-meh-sw src/{contract,messages}.js

const HELLO = 'io:hello';
const FETCH = 'io:fetch';
const RESULT = 'io:result';

// lockstep: double-meh-sw cache-tier default; bundle's writeThrough === true lands here
export const SHARED_CACHE = 'io-shared';

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
