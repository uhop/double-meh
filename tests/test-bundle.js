import test from 'tape-six';

import {io, json, serve, reset} from './helper.js';
import {BUNDLE_MIME, BUNDLE_JSONL_MIME} from '../src/services/bundle.js';
import {SHARED_CACHE} from '../src/sw.js';

const BASE = 'https://example.com';
const DATA = {
  '/a': {name: 'a'},
  '/b': {name: 'b'},
  '/c': {name: 'c'},
  '/d': {name: 'd'},
  '/e': {name: 'e'}
};

const bundleResponse = parts =>
  new Response(JSON.stringify({v: 1, parts}), {headers: {'content-type': BUNDLE_MIME}});

const partFor = part => {
  const path = new URL(part.url).pathname;
  return {
    id: part.id,
    url: part.url,
    status: 200,
    headers: {'content-type': 'application/json'},
    body: DATA[path] ?? {miss: path}
  };
};

// a mock bundler endpoint: answers the bundle PUT, counts everything else as individual GETs
const bundler =
  (counters, mapPart = partFor) =>
  request => {
    if (request.method === 'PUT' && new URL(request.url).pathname === '/bundle') {
      ++counters.puts;
      counters.lastDoc = JSON.parse(request.body);
      return bundleResponse(counters.lastDoc.parts.map(mapPart));
    }
    ++counters.gets;
    return json(DATA[new URL(request.url).pathname] ?? {miss: true});
  };

const withBundler = async (t, run, mapPart) => {
  const counters = {puts: 0, gets: 0, lastDoc: null};
  serve(bundler(counters, mapPart));
  io.bundle.url = BASE + '/bundle';
  try {
    await run(counters);
  } finally {
    io.bundle.url = '';
    reset();
  }
};

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('bundle: a burst rides one bundle PUT', async t => {
  await withBundler(t, async counters => {
    const [a, b, c] = await Promise.all([
      io.get(BASE + '/a', null, {bundle: true}),
      io.get(BASE + '/b', null, {bundle: true}),
      io.get(BASE + '/c', null, {bundle: true})
    ]);
    t.deepEqual(a, DATA['/a'], 'first part decoded');
    t.deepEqual(b, DATA['/b'], 'second part decoded');
    t.deepEqual(c, DATA['/c'], 'third part decoded');
    t.equal(counters.puts, 1, 'one bundle PUT');
    t.equal(counters.gets, 0, 'no individual GETs');
    const sent = counters.lastDoc;
    t.equal(sent.v, 1, 'wire format v1');
    t.equal(sent.parts.length, 3, 'three parts in the document');
    t.ok(
      sent.parts.every(part => part.headers.accept),
      'parts carry their accept'
    );
  });
});

test('bundle: parts land in the per-URL cache', async t => {
  await withBundler(t, async counters => {
    await Promise.all([
      io.get(BASE + '/a', null, {bundle: true}),
      io.get(BASE + '/b', null, {bundle: true})
    ]);
    const again = await io.get(BASE + '/a');
    t.deepEqual(again, DATA['/a'], 'bare GET served');
    t.equal(counters.puts, 1, 'no second bundle');
    t.equal(counters.gets, 0, 'served from the cache, not the wire');
  });
});

test('bundle: below minSize goes individually', async t => {
  await withBundler(t, async counters => {
    const a = await io.get(BASE + '/a', null, {bundle: true});
    t.deepEqual(a, DATA['/a'], 'data intact');
    t.equal(counters.puts, 0, 'no bundle for a lone request');
    t.equal(counters.gets, 1, 'sent as a plain GET');
  });
});

test('bundle: maxSize flushes full windows, remainder degenerates', async t => {
  await withBundler(t, async counters => {
    const saved = io.bundle.maxSize;
    io.bundle.maxSize = 2;
    try {
      const results = await Promise.all(
        ['/a', '/b', '/c', '/d', '/e'].map(path => io.get(BASE + path, null, {bundle: true}))
      );
      t.deepEqual(results[4], DATA['/e'], 'last result intact');
      t.equal(counters.puts, 2, 'two full bundles of two');
      t.equal(counters.gets, 1, 'sub-minSize remainder went individually');
    } finally {
      io.bundle.maxSize = saved;
    }
  });
});

test('bundle: a named bundle waits for its flush', async t => {
  await withBundler(t, async counters => {
    const promises = [
      io.get(BASE + '/a', null, {bundle: 'grp'}),
      io.get(BASE + '/b', null, {bundle: 'grp'})
    ];
    await tick();
    t.equal(counters.puts, 0, 'nothing sent before the flush');
    await io.bundle.flush('grp');
    t.deepEqual(await Promise.all(promises), [DATA['/a'], DATA['/b']], 'both parts arrived');
    t.equal(counters.puts, 1, 'one bundle on flush');
  });
});

test('bundle: submit batches a manual list', async t => {
  await withBundler(t, async counters => {
    const results = await Promise.all(io.bundle.submit([BASE + '/a', BASE + '/b']));
    t.deepEqual(results, [DATA['/a'], DATA['/b']], 'both resolved');
    t.equal(counters.puts, 1, 'one bundle PUT');
    t.equal(counters.gets, 0, 'no individual GETs');
  });
});

test('bundle: a synthetic part rejects with FailedIO', async t => {
  const mapPart = part =>
    new URL(part.url).pathname === '/b'
      ? {id: part.id, url: part.url, status: 502, synthetic: true, body: 'upstream exploded'}
      : partFor(part);
  await withBundler(
    t,
    async () => {
      const [a, b] = await Promise.allSettled([
        io.get(BASE + '/a', null, {bundle: true}),
        io.get(BASE + '/b', null, {bundle: true})
      ]);
      t.equal(a.status, 'fulfilled', 'healthy part unaffected');
      t.equal(b.status, 'rejected', 'synthetic part rejects');
      t.ok(b.reason instanceof io.FailedIO, 'as FailedIO');
      t.ok(/upstream exploded/.test(b.reason.message), 'with the bundler message');
    },
    mapPart
  );
});

test('bundle: a part missing from the response rejects its waiter only', async t => {
  const counters = {puts: 0, gets: 0, lastDoc: null};
  serve(request => {
    if (request.method === 'PUT') {
      ++counters.puts;
      const doc = JSON.parse(request.body);
      return bundleResponse(
        doc.parts.filter(part => new URL(part.url).pathname !== '/b').map(partFor)
      );
    }
    ++counters.gets;
    return json({miss: true});
  });
  io.bundle.url = BASE + '/bundle';
  try {
    const [a, b] = await Promise.allSettled([
      io.get(BASE + '/a', null, {bundle: true}),
      io.get(BASE + '/b', null, {bundle: true})
    ]);
    t.equal(a.status, 'fulfilled', 'the present part resolves');
    t.equal(b.status, 'rejected', 'the missing part rejects');
    t.ok(b.reason instanceof io.FailedIO, 'as FailedIO');
    t.ok(/missing/.test(b.reason.message), 'naming the omission');
    t.equal(counters.gets, 0, 'no silent fallback to an individual GET');
  } finally {
    io.bundle.url = '';
    reset();
  }
});

test('bundle: a failed bundle PUT rejects every waiter with FailedIO', async t => {
  const counters = {puts: 0, gets: 0};
  serve(request =>
    request.method === 'PUT' ? json({boom: true}, {status: 500}) : json({miss: true})
  );
  io.bundle.url = BASE + '/bundle';
  try {
    const settled = await Promise.allSettled([
      io.get(BASE + '/a', null, {bundle: true}),
      io.get(BASE + '/b', null, {bundle: true})
    ]);
    t.ok(
      settled.every(s => s.status === 'rejected' && s.reason instanceof io.FailedIO),
      'both reject as FailedIO'
    );
    t.ok(
      settled.every(s => s.reason.cause instanceof io.BadStatus),
      'with the send failure as the cause'
    );
  } finally {
    io.bundle.url = '';
    reset();
  }
});

test('bundle: a non-2xx part takes the BadStatus path', async t => {
  const mapPart = part => ({
    id: part.id,
    url: part.url,
    status: 404,
    headers: {'content-type': 'application/problem+json'},
    body: {title: 'not here'}
  });
  await withBundler(
    t,
    async () => {
      const savedMinSize = io.bundle.minSize;
      io.bundle.minSize = 1;
      try {
        await io.get(BASE + '/a', null, {bundle: true, cache: false});
        t.fail('must throw');
      } catch (error) {
        t.ok(error instanceof io.BadStatus, 'BadStatus');
        t.equal(error.status, 404, 'part status');
        t.deepEqual(error.data, {title: 'not here'}, 'parsed problem body');
      } finally {
        io.bundle.minSize = savedMinSize;
      }
    },
    mapPart
  );
});

test('bundle: a 304 part revalidates the cached entry', async t => {
  const counters = {puts: 0, etags: []};
  serve(request => {
    if (request.method === 'PUT') {
      ++counters.puts;
      const doc = JSON.parse(request.body);
      return bundleResponse(
        doc.parts.map(part => {
          counters.etags.push(part.headers['if-none-match']);
          return {id: part.id, url: part.url, status: 304, headers: {etag: '"v1"'}};
        })
      );
    }
    return json(DATA['/e'], {headers: {etag: '"v1"'}});
  });
  io.bundle.url = BASE + '/bundle';
  const savedMinSize = io.bundle.minSize;
  io.bundle.minSize = 1; // a lone revalidation must still ride the bundle for this test
  try {
    const first = await io.get(BASE + '/e', null, {cache: {ttl: -1}});
    t.deepEqual(first, DATA['/e'], 'primed');
    const second = await io.get(BASE + '/e', null, {bundle: true, cache: {ttl: -1}});
    t.deepEqual(second, DATA['/e'], 'revalidated 304 part serves the stored body');
    t.equal(counters.puts, 1, 'revalidation rode a bundle');
    t.deepEqual(counters.etags, ['"v1"'], 'the conditional header rode the part');
  } finally {
    io.bundle.minSize = savedMinSize;
    io.bundle.url = '';
    reset();
  }
});

test('bundle: a bundle payload from any endpoint adopts unclaimed parts', async t => {
  const counters = {warmups: 0, gets: 0};
  serve(request => {
    const path = new URL(request.url).pathname;
    if (path === '/warmup') {
      ++counters.warmups;
      return bundleResponse([
        {
          url: BASE + '/a',
          status: 200,
          headers: {'content-type': 'application/json'},
          body: DATA['/a']
        }
      ]);
    }
    ++counters.gets;
    return json(DATA[path] ?? {miss: true});
  });
  try {
    const doc = await io.get(BASE + '/warmup');
    t.equal(doc.v, 1, 'the caller still sees the bundle document');
    await tick();
    await io.cache.idle();
    const a = await io.get(BASE + '/a');
    t.deepEqual(a, DATA['/a'], 'prefetched part served');
    t.equal(counters.gets, 0, 'from the cache, not the wire');
  } finally {
    reset();
  }
});

test('bundle: fly registers interest a later payload resolves', async t => {
  serve(request =>
    new URL(request.url).pathname === '/warmup'
      ? bundleResponse([
          {
            url: BASE + '/b',
            status: 200,
            headers: {'content-type': 'application/json'},
            body: DATA['/b']
          }
        ])
      : json({miss: true})
  );
  try {
    const [flying] = io.bundle.fly([BASE + '/b']);
    await io.get(BASE + '/warmup');
    const envelope = await flying;
    t.deepEqual(envelope.data, DATA['/b'], 'the flying interest resolved with the part');
  } finally {
    reset();
  }
});

test('bundle: registered bundlers select by match', async t => {
  const counters = {api: 0, other: 0};
  const dm = io.create();
  dm.mock(
    () => true,
    request => {
      if (request.method === 'PUT') {
        new URL(request.url).pathname === '/api-bundle' ? ++counters.api : ++counters.other;
        const doc = JSON.parse(request.body);
        return bundleResponse(doc.parts.map(partFor));
      }
      return json({miss: true});
    }
  );
  dm.bundle.url = BASE + '/bundle';
  dm.bundle.register({url: BASE + '/api-bundle', match: BASE + '/api/'});
  const results = await Promise.all([
    dm.get(BASE + '/api/x', null, {bundle: true}),
    dm.get(BASE + '/api/y', null, {bundle: true}),
    dm.get(BASE + '/a', null, {bundle: true}),
    dm.get(BASE + '/b', null, {bundle: true})
  ]);
  t.deepEqual(results[3], DATA['/b'], 'default bundler part decoded');
  t.equal(counters.api, 1, 'matched requests rode the registered bundler');
  t.equal(counters.other, 1, 'the rest rode the default');
});

test(
  'bundle: writeThrough lands parts in the Cache API',
  {skip: typeof caches === 'undefined'},
  async t => {
    const dm = io.create();
    dm.mock(
      () => true,
      () =>
        bundleResponse([
          {
            url: BASE + '/wt',
            status: 200,
            headers: {'content-type': 'application/json'},
            body: {via: 'sw'}
          }
        ])
    );
    dm.bundle.writeThrough = 'io-bundle-test';
    await dm.get(BASE + '/warmup');
    const cache = await caches.open('io-bundle-test');
    let hit;
    // the write-through is fire-and-forget by design: poll briefly instead of racing it
    for (let i = 0; i < 50 && !hit; ++i) {
      await tick();
      hit = await cache.match(BASE + '/wt');
    }
    t.ok(hit, 'part written through');
    t.deepEqual(await hit.json(), {via: 'sw'}, 'with its body');
    await caches.delete('io-bundle-test').catch(() => {});
  }
);

test(
  'bundle: writeThrough === true lands in the shared SW tier',
  {skip: typeof caches === 'undefined'},
  async t => {
    const dm = io.create();
    dm.mock(
      () => true,
      () =>
        bundleResponse([
          {
            url: BASE + '/wts',
            status: 200,
            headers: {'content-type': 'application/json'},
            body: {via: 'shared'}
          }
        ])
    );
    dm.bundle.writeThrough = true;
    await dm.get(BASE + '/warmup-shared');
    const cache = await caches.open(SHARED_CACHE);
    let hit;
    for (let i = 0; i < 50 && !hit; ++i) {
      await tick();
      hit = await cache.match(BASE + '/wts');
    }
    t.ok(hit, 'part written to the shared tier');
    t.deepEqual(await hit.json(), {via: 'shared'}, 'with its body');
    await caches.delete(SHARED_CACHE).catch(() => {});
  }
);

// a bundler that answers the PUT with a jsonl stream the test drives line by line
const streamingBundler = (counters, script) => request => {
  if (request.method === 'PUT' && new URL(request.url).pathname === '/bundle') {
    ++counters.puts;
    counters.lastAccept = request.headers.get('accept');
    counters.lastDoc = JSON.parse(request.body);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        counters.write = record =>
          controller.enqueue(encoder.encode(JSON.stringify(record) + '\n'));
        counters.close = () => controller.close();
        script(counters);
      }
    });
    return new Response(stream, {headers: {'content-type': BUNDLE_JSONL_MIME}});
  }
  ++counters.gets;
  return json(DATA[new URL(request.url).pathname] ?? {miss: true});
};

const withStreamingBundler = async (run, script) => {
  const counters = {puts: 0, gets: 0, lastDoc: null, lastAccept: null};
  // reset() fires io.cache.clear() without awaiting it; the browser backend is async, so an
  // earlier test's cached /a and /b can survive into this one and never enter a bundle window
  await io.cache.clear();
  serve(streamingBundler(counters, script));
  io.bundle.url = BASE + '/bundle';
  io.bundle.streaming = true;
  try {
    await run(counters);
  } finally {
    io.bundle.streaming = false;
    io.bundle.url = '';
    reset();
  }
};

test('bundle streaming: the send negotiates jsonl and parts resolve', async t => {
  await withStreamingBundler(
    async counters => {
      const [a, b] = await Promise.all([
        io.get(BASE + '/a', null, {bundle: true}),
        io.get(BASE + '/b', null, {bundle: true})
      ]);
      t.equal(counters.puts, 1, 'one bundle PUT');
      t.equal(counters.gets, 0, 'no individual GETs');
      t.ok(counters.lastAccept.startsWith(BUNDLE_JSONL_MIME), 'jsonl offered first');
      t.ok(counters.lastAccept.includes(BUNDLE_MIME), 'buffered json still offered as a fallback');
      t.deepEqual(a, DATA['/a'], 'first part decoded');
      t.deepEqual(b, DATA['/b'], 'second part decoded');
    },
    counters => {
      counters.write({v: 1});
      for (const part of counters.lastDoc.parts) counters.write(partFor(part));
      counters.close();
    }
  );
});

test('bundle streaming: a waiter resolves before the rest of the stream arrives', async t => {
  let releaseSecond;
  const gate = new Promise(resolve => (releaseSecond = resolve));
  await withStreamingBundler(
    async counters => {
      const first = io.get(BASE + '/a', null, {bundle: true});
      const second = io.get(BASE + '/b', null, {bundle: true});
      // would never settle if the client waited for the whole envelope
      t.deepEqual(
        await first,
        DATA['/a'],
        'the first part resolved while the stream was still open'
      );
      releaseSecond();
      t.deepEqual(await second, DATA['/b'], 'the second followed');
      t.equal(counters.puts, 1, 'still one PUT');
    },
    counters => {
      const [one, two] = counters.lastDoc.parts;
      counters.write({v: 1});
      counters.write(partFor(one));
      gate.then(() => {
        counters.write(partFor(two));
        counters.close();
      });
    }
  );
});

test('bundle streaming: a synthetic part rejects only its own waiter', async t => {
  await withStreamingBundler(
    async counters => {
      const results = await Promise.allSettled([
        io.get(BASE + '/a', null, {bundle: true}),
        io.get(BASE + '/b', null, {bundle: true})
      ]);
      t.equal(results[0].status, 'fulfilled', 'the healthy part resolved');
      t.deepEqual(results[0].value, DATA['/a'], 'with its body');
      t.equal(results[1].status, 'rejected', 'the synthetic part rejected');
      t.ok(results[1].reason instanceof io.FailedIO, 'as FailedIO');
      t.ok(/upstream exploded/.test(results[1].reason.message), 'carrying the bundler message');
    },
    counters => {
      const [one, two] = counters.lastDoc.parts;
      counters.write({v: 1});
      counters.write(partFor(one));
      counters.write({
        id: two.id,
        url: two.url,
        status: 502,
        synthetic: true,
        headers: {'content-type': 'text/plain'},
        body: 'upstream exploded'
      });
      counters.close();
    }
  );
});

test('bundle streaming: a part the stream never carries fails its waiter', async t => {
  await withStreamingBundler(
    async counters => {
      const results = await Promise.allSettled([
        io.get(BASE + '/a', null, {bundle: true}),
        io.get(BASE + '/b', null, {bundle: true})
      ]);
      t.equal(results[0].status, 'fulfilled', 'the delivered part resolved');
      t.equal(results[1].status, 'rejected', 'the omitted one rejected');
      t.ok(/part missing/.test(results[1].reason.message), 'as a missing part');
    },
    counters => {
      counters.write({v: 1});
      counters.write(partFor(counters.lastDoc.parts[0]));
      counters.close();
    }
  );
});

test('bundle streaming: a bundler that answers buffered json still works', async t => {
  const counters = {puts: 0, gets: 0, lastAccept: null};
  serve(request => {
    if (request.method === 'PUT' && new URL(request.url).pathname === '/bundle') {
      ++counters.puts;
      counters.lastAccept = request.headers.get('accept');
      return bundleResponse(JSON.parse(request.body).parts.map(partFor));
    }
    ++counters.gets;
    return json(DATA[new URL(request.url).pathname] ?? {miss: true});
  });
  io.bundle.url = BASE + '/bundle';
  io.bundle.streaming = true;
  try {
    const [a, b] = await Promise.all([
      io.get(BASE + '/a', null, {bundle: true}),
      io.get(BASE + '/b', null, {bundle: true})
    ]);
    t.ok(counters.lastAccept.includes(BUNDLE_JSONL_MIME), 'jsonl was offered');
    t.equal(counters.puts, 1, 'one PUT');
    t.equal(counters.gets, 0, 'no fallback GETs');
    t.deepEqual([a, b], [DATA['/a'], DATA['/b']], 'both parts decoded off the buffered envelope');
  } finally {
    io.bundle.streaming = false;
    io.bundle.url = '';
    reset();
  }
});

test('bundle streaming: off by default — the send asks only for buffered json', async t => {
  await withBundler(t, async counters => {
    let accept;
    serve(request => {
      if (request.method === 'PUT' && new URL(request.url).pathname === '/bundle') {
        accept = request.headers.get('accept');
        return bundleResponse(JSON.parse(request.body).parts.map(partFor));
      }
      ++counters.gets;
      return json(DATA[new URL(request.url).pathname] ?? {miss: true});
    });
    await Promise.all([
      io.get(BASE + '/a', null, {bundle: true}),
      io.get(BASE + '/b', null, {bundle: true})
    ]);
    t.equal(accept, BUNDLE_MIME, 'no jsonl offered when streaming is off');
  });
});

test('bundle streaming: the buffered inspector ignores a jsonl content type', async t => {
  // BUNDLE_MIME is a string prefix of BUNDLE_JSONL_MIME — a startsWith test would unpack this
  await withBundler(t, async counters => {
    serve(request => {
      if (request.method === 'PUT' && new URL(request.url).pathname === '/bundle') {
        const parts = JSON.parse(request.body).parts.map(partFor);
        return new Response(JSON.stringify({v: 1, parts}), {
          headers: {'content-type': BUNDLE_JSONL_MIME}
        });
      }
      ++counters.gets;
      return json(DATA[new URL(request.url).pathname] ?? {miss: true});
    });
    const results = await Promise.allSettled([
      io.get(BASE + '/a', null, {bundle: true}),
      io.get(BASE + '/b', null, {bundle: true})
    ]);
    t.deepEqual(
      results.map(r => r.status),
      ['rejected', 'rejected'],
      'a jsonl-typed body is not unpacked by the buffered path'
    );
  });
});
