// CLI-only: these stub `location`, which cannot be assigned in a browser (it navigates).
import test from 'tape-six';

import {io} from '../helper.js';
import {makeWorker, makeContainer} from '../helper-sw.js';
import {installSW} from '../../src/sw.js';

// defineProperty, not assignment: under Deno the suite runs in a worker scope whose `location`
// is a getter-only own property, and a plain assignment there throws
const withLocation = async (href, body) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {value: {href}, configurable: true});
  try {
    return await body();
  } finally {
    if (original) Object.defineProperty(globalThis, 'location', original);
    else delete globalThis.location;
  }
};

const urlSentFor = async (target, pageHref) => {
  const dm = io.create();
  const worker = makeWorker({routes: {}});
  installSW(dm, {serviceWorker: makeContainer(worker)});
  await withLocation(pageHref, () => dm.get(target, null, {transport: 'sw'}).catch(() => {}));
  return worker.seen.find(message => message.type === 'io:fetch').url;
};

const PAGE = 'https://example.com/deep/page.html';

test('sw: a relative URL is resolved against the page, not the worker script', async t => {
  t.equal(
    await urlSentFor('api/rel', PAGE),
    'https://example.com/deep/api/rel',
    'page-relative resolves against the page directory'
  );
  t.equal(
    await urlSentFor('/api/root', PAGE),
    'https://example.com/api/root',
    'root-relative resolves against the origin'
  );
  t.equal(
    await urlSentFor('https://other.example.net/x', PAGE),
    'https://other.example.net/x',
    'an absolute URL is left alone'
  );
});

test('sw: a query does not change which resource a relative URL names', async t => {
  const dm = io.create();
  const worker = makeWorker({routes: {}});
  installSW(dm, {serviceWorker: makeContainer(worker)});
  await withLocation(PAGE, () => dm.get('api/rel', {q: 1}, {transport: 'sw'}).catch(() => {}));
  const sent = worker.seen.find(message => message.type === 'io:fetch');
  // buildUrl absolutizes only on the query branch — the transport must not inherit that asymmetry
  t.equal(sent.url, 'https://example.com/deep/api/rel?q=1', 'same path as the query-less form');
});

test('sw: with no page base the URL crosses unchanged', async t => {
  // Deno runs this in a worker scope that HAS a location (the script URL), so drop it explicitly
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  if (original) delete globalThis.location;
  try {
    const dm = io.create();
    const worker = makeWorker({routes: {}});
    installSW(dm, {serviceWorker: makeContainer(worker)});
    await dm.get('api/rel', null, {transport: 'sw'}).catch(() => {});
    const sent = worker.seen.find(message => message.type === 'io:fetch');
    t.equal(sent.url, 'api/rel', 'nothing to resolve against, so nothing is invented');
  } finally {
    if (original) Object.defineProperty(globalThis, 'location', original);
  }
});
