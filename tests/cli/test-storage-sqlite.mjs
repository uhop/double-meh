import test from 'tape-six';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {io, json, serve, reset} from '../helper.mjs';

const isDeno = typeof Deno !== 'undefined';

const entry = (body, extra = {}) => ({
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'application/json']],
  body: new TextEncoder().encode(body).buffer,
  expiresAt: Infinity,
  ...extra
});

test('sqlite storage: refuses Deno', {skip: !isDeno}, async t => {
  const {sqliteStorage} = await import('../../src/storage/sqlite.js');
  try {
    await sqliteStorage({database: ':memory:'});
    t.fail('expected sqliteStorage to throw on Deno');
  } catch (error) {
    t.ok(/not supported on Deno/.test(error.message), 'refused with the recorded decision');
  }
});

test('sqlite storage: set/get roundtrip preserves the entry', {skip: isDeno}, async t => {
  const {sqliteStorage} = await import('../../src/storage/sqlite.js');
  const storage = await sqliteStorage({database: ':memory:'});
  await storage.set('GET https://example.com/a', entry('{"a":1}', {etag: '"v1"'}));
  const got = await storage.get('GET https://example.com/a');
  t.ok(got, 'entry retrieved');
  t.equal(got.status, 200, 'status preserved');
  t.equal(got.etag, '"v1"', 'etag preserved');
  t.equal(got.expiresAt, Infinity, 'Infinity expiry survives the JSON roundtrip');
  t.equal(new TextDecoder().decode(got.body), '{"a":1}', 'body bytes preserved');
  storage.close();
});

test('sqlite storage: delete, keys, clear', {skip: isDeno}, async t => {
  const {sqliteStorage} = await import('../../src/storage/sqlite.js');
  const storage = await sqliteStorage({database: ':memory:'});
  await storage.set('GET https://example.com/1', entry('{"n":1}'));
  await storage.set('GET https://example.com/2', entry('{"n":2}'));
  t.deepEqual(
    (await storage.keys()).sort(),
    ['GET https://example.com/1', 'GET https://example.com/2'],
    'keys lists the original keys'
  );
  await storage.delete('GET https://example.com/1');
  t.deepEqual(await storage.keys(), ['GET https://example.com/2'], 'deleted key gone');
  await storage.clear();
  t.deepEqual(await storage.keys(), [], 'clear removes everything');
  storage.close();
});

test('sqlite storage: entries persist across re-open', {skip: isDeno}, async t => {
  const {sqliteStorage} = await import('../../src/storage/sqlite.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-sqlite-'));
  const database = path.join(dir, 'cache.sqlite');
  const first = await sqliteStorage({database});
  await first.set('GET https://example.com/p', entry('{"kept":true}'));
  first.close();
  const second = await sqliteStorage({database});
  const got = await second.get('GET https://example.com/p');
  t.ok(got, 'a fresh connection sees the entry');
  t.equal(new TextDecoder().decode(got.body), '{"kept":true}', 'body preserved across re-open');
  second.close();
  await fs.rm(dir, {recursive: true, force: true});
});

test('sqlite storage: drives the cache service end-to-end', {skip: isDeno}, async t => {
  const {sqliteStorage} = await import('../../src/storage/sqlite.js');
  const saved = io.cache.storage;
  const storage = await sqliteStorage({database: ':memory:'});
  io.cache.storage = storage;
  let calls = 0;
  serve(() => json({n: ++calls}));
  const a = await io.get('https://example.com/sq');
  const b = await io.get('https://example.com/sq');
  t.equal(calls, 1, 'second GET served from the SQLite cache');
  t.deepEqual(a, {n: 1}, 'first body');
  t.deepEqual(b, {n: 1}, 'cached body');
  storage.close();
  io.cache.storage = saved;
  reset();
});
