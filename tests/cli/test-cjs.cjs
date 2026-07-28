'use strict';

// CJS consumers require() this ESM (type:module) package on Node >= 20.19, where require(ESM)
// loads the synchronous module graph. This pins that path: the entry's default/named mirrors,
// the opt-in subpath modules, and — implicitly — that no top-level await enters the graph
// (require(ESM) of an async module throws ERR_REQUIRE_ASYNC_MODULE).

const {test} = require('tape-six');

const dm = require('../../src/index.js');
const {
  brotliEncoder,
  deflateEncoder,
  gzipEncoder,
  installZlibEncoders,
  zstdEncoder
} = require('../../src/encoders/zlib.js');
const {cacheApiStorage} = require('../../src/storage/cache-api.js');
const {appCacheDir, osCacheDir} = require('../../src/storage/cache-dir.js');
const {fsStorage} = require('../../src/storage/fs.js');
const {sqliteStorage} = require('../../src/storage/sqlite.js');
const {CHANNEL, SHARED_CACHE, installChannel, installSW} = require('../../src/sw.js');

test('cjs: the entry pairs its default export with a named mirror', t => {
  t.equal(typeof dm.default, 'function', 'default export is the callable io');
  t.equal(dm.default, dm.io, 'default and the named io are the same value');
  t.equal(typeof dm.createIO, 'function');
  t.equal(typeof dm.create, 'function');
});

test('cjs: verbs and return-shape entry points resolve', t => {
  for (const verb of ['get', 'head', 'post', 'put', 'patch', 'del', 'remove', 'options']) {
    t.equal(typeof dm[verb], 'function', verb + ' is callable');
  }
  t.equal(typeof dm.full, 'function');
  t.equal(typeof dm.stream, 'object');
  t.equal(typeof dm.records, 'object');
  t.equal(typeof dm.sse, 'function');
});

test('cjs: services and the error taxonomy resolve', t => {
  for (const service of ['track', 'cache', 'retry', 'bundle']) {
    t.equal(typeof dm[service], 'object', service + ' is installed');
  }
  t.equal(typeof dm.mock, 'function', 'mock is installed');
  for (const name of ['IOError', 'FailedIO', 'BadStatus', 'TimedOut']) {
    t.equal(typeof dm[name], 'function', name + ' is a constructor');
  }
  for (const name of ['FailedIO', 'BadStatus', 'TimedOut']) {
    t.ok(dm[name].prototype instanceof dm.IOError, name + ' extends IOError');
  }
  t.equal(typeof dm.isAbort, 'function');
});

test('cjs: opt-in subpath modules require() cleanly', t => {
  for (const encoder of [brotliEncoder, deflateEncoder, gzipEncoder, zstdEncoder]) {
    t.equal(typeof encoder, 'function', 'zlib encoder is a factory');
  }
  t.equal(typeof installZlibEncoders, 'function');
  t.equal(typeof cacheApiStorage, 'function');
  t.equal(typeof fsStorage, 'function');
  t.equal(typeof sqliteStorage, 'function');
  t.equal(typeof appCacheDir, 'function');
  t.equal(typeof osCacheDir, 'function');
  t.equal(typeof installSW, 'function');
  t.equal(typeof installChannel, 'function');
  t.equal(typeof SHARED_CACHE, 'string');
  t.equal(typeof CHANNEL, 'string');
});
