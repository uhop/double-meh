const encode = data => new TextEncoder().encode(JSON.stringify(data)).buffer;

// Bun cannot transfer a ReadableStream, so the streamed reply is only offered where it survives
// the port — the same probe the SW sibling advertises its `stream` capability from
export const canTransferStreams = (() => {
  let known;
  return () => {
    if (known === undefined) {
      try {
        const stream = new ReadableStream();
        structuredClone(stream, {transfer: [stream]}).cancel();
        known = true;
      } catch {
        known = false;
      }
    }
    return known;
  };
})();

// a contract-faithful fake worker: replies on the transferred port like the SW message hub
export const makeWorker = (options = {}) => {
  const {
    version = 'sw-test',
    capabilities = ['cache', 'bundle', 'transport'],
    routes = {},
    canStream = canTransferStreams()
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
          const result = {
            type: 'io:result',
            id: message.id,
            status: reply.status || 200,
            statusText: reply.statusText || 'OK',
            headers: reply.headers || [['content-type', 'application/json']]
          };
          // honour the negotiation exactly as the hub does: stream only when asked and able
          if (message.stream && canStream && (reply.stream || reply.body !== undefined)) {
            result.stream = true;
            // a `stream:` route transfers verbatim — a `body:` one is complete before it leaves,
            // so only the former can show that the caller reads ahead of the source closing
            result.body = reply.stream || new Response(JSON.stringify(reply.body)).body;
          } else if (reply.stream) {
            // an unbufferable route on the buffered path would answer an empty body: fail loudly
            throw new Error('helper-sw: a stream: route needs `canStream` and a streamed ask');
          } else {
            result.body = reply.body === undefined ? new ArrayBuffer(0) : encode(reply.body);
          }
          port.postMessage(result, [result.body]);
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
