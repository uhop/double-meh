import test from 'tape-six';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {fsStorage} from '../../src/storage/fs.js';
import {io, json, serve, reset} from '../helper.mjs';

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'dm-fs-'));

const entry = (body, extra = {}) => ({
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'application/json']],
  body: typeof body === 'string' ? new TextEncoder().encode(body).buffer : body,
  expiresAt: Infinity,
  ...extra
});

test('fs storage: set/get roundtrip preserves the entry', async t => {
  const directory = await tempDir();
  const storage = fsStorage({directory});
  await storage.set(
    'GET https://example.com/a',
    entry('{"a":1}', {etag: '"v1"', vary: {'x-tenant': 'a', 'accept-language': null}})
  );
  const got = await storage.get('GET https://example.com/a');
  t.ok(got, 'entry retrieved');
  t.equal(got.status, 200, 'status preserved');
  t.equal(got.etag, '"v1"', 'etag preserved');
  t.equal(got.expiresAt, Infinity, 'Infinity expiry survives the JSON roundtrip');
  t.deepEqual(got.vary, {'x-tenant': 'a', 'accept-language': null}, 'vary snapshot preserved');
  t.deepEqual(got.headers, [['content-type', 'application/json']], 'headers preserved');
  t.equal(new TextDecoder().decode(got.body), '{"a":1}', 'body bytes preserved');
  await fs.rm(directory, {recursive: true, force: true});
});

test('fs storage: binary bodies survive intact', async t => {
  const directory = await tempDir();
  const storage = fsStorage({directory});
  const bytes = new Uint8Array([0, 10, 255, 13, 10, 128, 7]); // embedded newlines must not split the record
  await storage.set('GET https://example.com/bin', entry(bytes.buffer));
  const got = await storage.get('GET https://example.com/bin');
  t.deepEqual([...new Uint8Array(got.body)], [...bytes], 'binary body preserved');
  await fs.rm(directory, {recursive: true, force: true});
});

test('fs storage: get on a missing key returns undefined', async t => {
  const directory = await tempDir();
  const storage = fsStorage({directory});
  t.equal(await storage.get('GET https://example.com/none'), undefined, 'miss is undefined');
  await fs.rm(directory, {recursive: true, force: true});
});

test('fs storage: delete, keys, clear', async t => {
  const directory = await tempDir();
  const storage = fsStorage({directory});
  await storage.set('GET https://example.com/1', entry('{"n":1}'));
  await storage.set('GET https://example.com/2', entry('{"n":2}'));
  t.deepEqual(
    (await storage.keys()).sort(),
    ['GET https://example.com/1', 'GET https://example.com/2'],
    'keys lists the original keys'
  );
  await storage.delete('GET https://example.com/1');
  t.deepEqual(await storage.keys(), ['GET https://example.com/2'], 'deleted key gone');
  t.equal(await storage.get('GET https://example.com/1'), undefined, 'deleted entry is a miss');
  await storage.clear();
  t.deepEqual(await storage.keys(), [], 'clear removes everything');
  await fs.rm(directory, {recursive: true, force: true});
});

test('fs storage: entries persist across storage instances', async t => {
  const directory = await tempDir();
  await fsStorage({directory}).set('GET https://example.com/p', entry('{"kept":true}'));
  const got = await fsStorage({directory}).get('GET https://example.com/p');
  t.ok(got, 'a fresh instance sees the entry');
  t.equal(new TextDecoder().decode(got.body), '{"kept":true}', 'body preserved across instances');
  await fs.rm(directory, {recursive: true, force: true});
});

test('fs storage: corrupt files degrade to a miss', async t => {
  const directory = await tempDir();
  const storage = fsStorage({directory});
  await storage.set('GET https://example.com/c', entry('{"ok":true}'));
  const [file] = await fs.readdir(directory);
  await fs.writeFile(path.join(directory, file), 'not json at all');
  t.equal(await storage.get('GET https://example.com/c'), undefined, 'corrupt entry is a miss');
  t.deepEqual(await storage.keys(), [], 'corrupt entry is not listed');
  await fs.rm(directory, {recursive: true, force: true});
});

test('fs storage: drives the cache service end-to-end', async t => {
  const directory = await tempDir();
  const saved = io.cache.storage;
  io.cache.storage = fsStorage({directory});
  let calls = 0;
  serve(() => json({n: ++calls}));
  const a = await io.get('https://example.com/fs');
  const b = await io.get('https://example.com/fs');
  t.equal(calls, 1, 'second GET served from the filesystem cache');
  t.deepEqual(a, {n: 1}, 'first body');
  t.deepEqual(b, {n: 1}, 'cached body');
  await io.cache.clear();
  io.cache.storage = saved;
  reset();
  await fs.rm(directory, {recursive: true, force: true});
});
