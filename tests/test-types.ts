import test from 'tape-six';

import io, {
  createIO,
  create,
  get,
  head,
  post,
  put,
  patch,
  del,
  remove,
  options,
  full,
  stream,
  records,
  sse,
  track,
  cache,
  retry,
  mock,
  bundle,
  update,
  adopt,
  paginate,
  getByIds,
  encoders,
  IOError,
  FailedIO,
  BadStatus,
  TimedOut,
  isAbort
} from '../src/index.js';
import type {Envelope, Options, SseEvent, StreamDuplex, IO} from '../src/index.js';

// The checkers below are declared, never invoked: `tsc` verifies the annotations, nothing
// runs (calling a verb would fire a real request). The tests record them as assertions.

const checkInstance = (instance: IO): IO => instance;
const checkFactories = (): IO[] => [io, createIO(), create(), io.create()];

// Every top-level named export mirrors the instance member of the same name — this is what
// catches a `.js` export the `.d.ts` never declared.
const checkGet: typeof io.get = get;
const checkHead: typeof io.head = head;
const checkPost: typeof io.post = post;
const checkPut: typeof io.put = put;
const checkPatch: typeof io.patch = patch;
const checkDel: typeof io.del = del;
const checkRemove: typeof io.remove = remove;
const checkOptions: typeof io.options = options;
const checkFull: typeof io.full = full;
const checkStream: typeof io.stream = stream;
const checkRecords: typeof io.records = records;
const checkSse: typeof io.sse = sse;
const checkTrack: typeof io.track = track;
const checkCache: typeof io.cache = cache;
const checkRetry: typeof io.retry = retry;
const checkMock: typeof io.mock = mock;
const checkBundle: typeof io.bundle = bundle;
const checkUpdate: IO['update'] = update;
const checkAdopt: IO['adopt'] = adopt;
const checkPaginate: IO['paginate'] = paginate;
const checkGetByIds: IO['getByIds'] = getByIds;
const checkEncoders: IO['encoders'] = encoders;

// The method declares the return shape; options tune behavior, never shape.
const checkData = (url: string): Promise<unknown> => get(url);
const checkTypedData = (url: string): Promise<{id: number}> => get<{id: number}>(url);
const checkEnvelope = (url: string): Promise<Envelope<{id: number}>> => full.get<{id: number}>(url);
const checkMetaVerb = (url: string): Promise<Envelope> => head(url);
const checkReadable = (url: string): Promise<ReadableStream> => stream.get(url);
const checkDuplex = (url: string): StreamDuplex => stream.post(url);
const checkRecordIteration = (url: string): AsyncIterableIterator<unknown> => records.get(url);
const checkSseEvents = (url: string): AsyncIterableIterator<SseEvent> => sse(url);
const checkReconnectDelay = (): number => sse.reconnectDelay;

// Write verbs take data plus an overrides bag; an endpoint descriptor stands in for a URL.
const checkWrite = (url: string): Promise<unknown> =>
  post(url, {a: 1}, {headers: {'x-test': '1'}, query: {a: 1}, timeout: 100});
const checkEndpoint = (endpoint: Options): Promise<unknown> => put(endpoint, {a: 1});
const checkDelete = (url: string): Promise<unknown> => del(url);
const checkPatchVerb = (url: string): Promise<unknown> => patch(url, {a: 1});
const checkRemoveVerb = (url: string): Promise<unknown> => remove(url, null);
const checkPaginated = (url: string): AsyncIterableIterator<{id: number}> =>
  paginate<{id: number}>(url);
const checkUpdated = (url: string): Promise<{v: number}> => update<{v: number}>(url, prev => prev);

// The error taxonomy is a class hierarchy carrying the envelope contract.
const checkAbort = (error: unknown): boolean => isAbort(error);
const checkBadStatus = (error: BadStatus<{detail: string}>): [number, {detail: string}] => [
  error.status,
  error.data
];
const checkHierarchy = (): boolean[] => [
  FailedIO.prototype instanceof IOError,
  BadStatus.prototype instanceof IOError,
  TimedOut.prototype instanceof FailedIO
];

test('Types: the entry pairs its default export with a named mirror', t => {
  t.equal(checkInstance(io), io, 'the default export satisfies IO');
  t.equal(checkFactories().length, 4, 'every factory returns an IO');
});

test('Types: top-level exports mirror their instance members (compile-time check)', t => {
  t.pass();
});

test('Types: the method declares the return shape (compile-time check)', t => {
  t.pass();
});

test('Types: write verbs accept data and overrides (compile-time check)', t => {
  t.pass();
});

test('Types: the error taxonomy is a class hierarchy', t => {
  t.deepEqual(checkHierarchy(), [true, true, true], 'the taxonomy chains to IOError');
  t.notOk(checkAbort(new Error('x')), 'a plain Error is not an abort');
});
