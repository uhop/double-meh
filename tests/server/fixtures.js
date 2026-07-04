// tape6-server plugin: wire fixtures for double-meh integration tests.
// Stateful routes key their state by `scope` (query param or X-Scope header) minted per test,
// so parallel workers sharing one server can't collide; scopes are swept lazily by TTL.

const SCOPE_TTL = 5 * 60 * 1000;

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {'content-type': 'application/json', ...(init.headers || {})}
  });

export default async function fixtures() {
  const scopes = new Map();

  const scopeOf = (request, url) => {
    const id = url.searchParams.get('scope') || request.headers.get('x-scope') || 'default';
    const now = Date.now();
    for (const [key, value] of scopes) if (now - value.touched > SCOPE_TTL) scopes.delete(key);
    let state = scopes.get(id);
    if (!state) {
      state = {counters: {}, version: 1, data: {seed: 'initial'}, uploads: []};
      scopes.set(id, state);
    }
    state.touched = now;
    return state;
  };

  const routes = {
    echo: async request =>
      json({
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers),
        body: request.body ? await request.text() : null
      }),

    status: (request, url) => {
      const code = Number(url.searchParams.get('code')) || 200;
      const headers = {};
      const retryAfter = url.searchParams.get('retryAfter');
      if (retryAfter) headers['retry-after'] = retryAfter;
      return json({code}, {status: code, headers});
    },

    delay: async (request, url) => {
      const ms = Number(url.searchParams.get('ms')) || 0;
      await new Promise(resolve => setTimeout(resolve, ms));
      return json({delayed: ms});
    },

    etag: async (request, url, state) => {
      if (request.method === 'PUT') {
        const expected = request.headers.get('if-match');
        if (expected && expected !== `"v${state.version}"`) {
          return json({error: 'precondition failed'}, {status: 412});
        }
        state.data = request.body ? await request.json() : {};
        ++state.version;
        return json({version: state.version}, {headers: {etag: `"v${state.version}"`}});
      }
      const etag = `"v${state.version}"`;
      if (request.headers.get('if-none-match') === etag) {
        return new Response(null, {status: 304, headers: {etag}});
      }
      return json({version: state.version, data: state.data}, {headers: {etag}});
    },

    // returns an async iterable: the server streams it as JSONL (generator sugar)
    jsonl: (request, url) => {
      const n = Number(url.searchParams.get('n')) || 10;
      return (async function* () {
        for (let i = 0; i < n; ++i) yield {n: i};
      })();
    },

    sse: (request, url) => {
      const n = Number(url.searchParams.get('n')) || 5;
      const drop = Number(url.searchParams.get('drop')) || Infinity;
      const ms = Number(url.searchParams.get('ms')) || 2;
      const last = request.headers.get('last-event-id');
      let id = last === null ? 0 : Number(last) + 1;
      if (id >= n) return new Response(null, {status: 204}); // ends the subscription
      let sent = 0;
      let timer;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const push = () => {
            if (id >= n || sent >= drop) return void controller.close();
            controller.enqueue(encoder.encode(`id: ${id}\ndata: {"n":${id}}\n\n`));
            ++id;
            ++sent;
            timer = setTimeout(push, ms);
          };
          push();
        },
        cancel() {
          clearTimeout(timer);
        }
      });
      return new Response(stream, {headers: {'content-type': 'text/event-stream'}});
    },

    upload: async (request, url, state) => {
      if (request.method === 'GET') return json(state.uploads.at(-1) ?? null);
      let bytes = 0;
      let chunks = 0;
      if (request.body) {
        for await (const chunk of request.body) {
          bytes += chunk.byteLength;
          ++chunks;
        }
      }
      const record = {method: request.method, bytes, chunks};
      state.uploads.push(record);
      return json(record);
    },

    counters: (request, url, state) => json(state.counters)
  };

  return {
    name: 'double-meh-fixtures',
    prefix: '/--io/',
    async fetch(request) {
      const url = new URL(request.url);
      const route = url.pathname.slice('/--io/'.length).replace(/\/+$/, '');
      const handler = routes[route];
      if (!handler) return undefined; // pass on
      const state = scopeOf(request, url);
      if (route !== 'counters') state.counters[route] = (state.counters[route] || 0) + 1;
      return handler(request, url, state);
    }
  };
}
