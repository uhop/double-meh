const encode = data => new TextEncoder().encode(JSON.stringify(data)).buffer;

// a contract-faithful fake worker: replies on the transferred port like the SW message hub
export const makeWorker = (options = {}) => {
  const {
    version = 'sw-test',
    capabilities = ['cache', 'bundle', 'transport'],
    routes = {}
  } = options;
  const seen = [];
  return {
    seen,
    postMessage(message, transfer) {
      seen.push(message);
      const port = transfer && transfer[0];
      if (!port) return;
      switch (message.type) {
        case 'io:hello':
          port.postMessage({type: 'io:hello', v: 1, version, capabilities});
          break;
        case 'io:fetch': {
          const route = routes[message.url];
          const reply = typeof route === 'function' ? route(message) : route;
          if (!reply || reply.error != null) {
            port.postMessage({
              type: 'io:result',
              id: message.id,
              error: reply ? reply.error : 'no route'
            });
            break;
          }
          const body = reply.body === undefined ? new ArrayBuffer(0) : encode(reply.body);
          port.postMessage(
            {
              type: 'io:result',
              id: message.id,
              status: reply.status || 200,
              statusText: reply.statusText || 'OK',
              headers: reply.headers || [['content-type', 'application/json']],
              body
            },
            [body]
          );
          break;
        }
      }
    }
  };
};

export const makeContainer = worker => {
  const listeners = {};
  return {
    controller: worker,
    ready: Promise.resolve({active: worker}),
    getRegistration: () => Promise.resolve({active: worker}),
    addEventListener: (type, fn) => void (listeners[type] ||= []).push(fn),
    listeners
  };
};

export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
