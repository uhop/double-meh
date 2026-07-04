import test from 'tape-six';
import {withTestServer} from 'tape-six/test-server.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {create} from '../src/index.js';
import {fsStorage} from '../src/storage/fs.js';
import fixtures from './server/fixtures.js';

const OPTIONS = {plugins: [fixtures]};

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'dm-wire-'));

const jsonResponse = data =>
  new Response(JSON.stringify(data), {headers: {'content-type': 'application/json'}});

test('wire: echo fixture round-trips method, headers, and body', async t => {
  await withTestServer(OPTIONS, async base => {
    const io = create();
    const echoed = await io.post(base + '/--io/echo?scope=w-echo', {hello: 'wire'});
    t.equal(echoed.method, 'POST', 'method echoed');
    t.deepEqual(JSON.parse(echoed.body), {hello: 'wire'}, 'body echoed');
    t.ok(echoed.headers['content-type'].includes('json'), 'request headers echoed');
  });
});

test('wire: filesystem cache persists across instances', async t => {
  await withTestServer(OPTIONS, async base => {
    const directory = await tempDir();
    const url = base + '/--io/etag?scope=w-fs';
    const one = create();
    one.cache.storage = fsStorage({directory});
    const a = await one.get(url);
    t.equal(a.version, 1, 'first GET hits the server');
    const two = create();
    two.cache.storage = fsStorage({directory});
    const b = await two.get(url);
    t.deepEqual(b, a, 'a fresh instance is served from disk');
    const counters = await two.get(base + '/--io/counters?scope=w-fs', null, {cache: false});
    t.equal(counters.etag, 1, 'exactly one server hit for both instances');
    await fs.rm(directory, {recursive: true, force: true});
  });
});

test('wire: expired entries revalidate with If-None-Match and reuse the body on 304', async t => {
  await withTestServer(OPTIONS, async base => {
    const io = create();
    const url = base + '/--io/etag?scope=w-304';
    const a = await io.get(url, null, {cache: {ttl: 0}});
    const b = await io.get(url, null, {cache: {ttl: 0}});
    t.deepEqual(b, a, 'cached body reused on 304');
    let counters = await io.get(base + '/--io/counters?scope=w-304', null, {cache: false});
    t.equal(counters.etag, 2, 'the second GET went to the server for revalidation');
    await io.put(url, {updated: true});
    const c = await io.get(url, null, {cache: {ttl: 0}});
    t.equal(c.version, 2, 'a bumped resource misses the validator and refetches');
    counters = await io.get(base + '/--io/counters?scope=w-304', null, {cache: false});
    t.equal(counters.etag, 4, 'PUT and refetch both hit the server');
  });
});

test('wire: adopt seeds the persistent cache; bare GETs never touch the network', async t => {
  await withTestServer(OPTIONS, async base => {
    const directory = await tempDir();
    const url = base + '/--io/etag?scope=w-adopt';
    const one = create();
    one.cache.storage = fsStorage({directory});
    await one.adopt(url, jsonResponse({version: 99, data: {adopted: true}}));
    await one.cache.idle();
    const data = await one.get(url);
    t.equal(data.version, 99, 'bare GET served from the adopted entry');
    const two = create();
    two.cache.storage = fsStorage({directory});
    const again = await two.get(url);
    t.equal(again.version, 99, 'the adopted entry is durable across instances');
    const counters = await two.get(base + '/--io/counters?scope=w-adopt', null, {cache: false});
    t.equal(counters.etag, undefined, 'the etag route was never hit');
    await fs.rm(directory, {recursive: true, force: true});
  });
});

test('wire: io.records iterates JSONL from the generator fixture', async t => {
  await withTestServer(OPTIONS, async base => {
    const io = create();
    const got = [];
    for await (const record of io.records.get(base + '/--io/jsonl?n=3&scope=w-jsonl')) {
      got.push(record);
    }
    t.deepEqual(got, [{n: 0}, {n: 1}, {n: 2}], 'records parsed in order');
  });
});

test('wire: io.sse resumes a dropped stream via Last-Event-ID', async t => {
  await withTestServer(OPTIONS, async base => {
    const io = create();
    const events = [];
    const url = base + '/--io/sse?n=4&drop=2&scope=w-sse';
    for await (const event of io.sse(url, null, {reconnect: 10})) events.push(event);
    t.deepEqual(
      events.map(event => JSON.parse(event.data).n),
      [0, 1, 2, 3],
      'all events arrive exactly once across the drop'
    );
    t.equal(events.at(-1).id, '3', 'last event id tracked');
    const counters = await io.get(base + '/--io/counters?scope=w-sse', null, {cache: false});
    t.equal(counters.sse, 3, 'two streams plus the terminating 204');
  });
});

test('wire: the upload sink drains and reports the request body', async t => {
  await withTestServer(OPTIONS, async base => {
    const io = create();
    const url = base + '/--io/upload?scope=w-upload';
    const report = await io.post(url, 'hello wire');
    t.equal(report.bytes, 10, 'body drained and counted');
    const last = await io.get(url, null, {cache: false});
    t.deepEqual(last, report, 'the sink recorded the upload');
  });
});
