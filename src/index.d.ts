import type {
  IO,
  Verb,
  MetaVerb,
  FullNamespace,
  StreamNamespace,
  RecordsNamespace,
  Sse,
  Track,
  Cache,
  Retry,
  Mock,
  Bundle
} from './types.js';

declare const io: IO;
export default io;
export {io};

export declare const createIO: () => IO;
export declare const create: () => IO;
export declare const get: Verb;
export declare const head: MetaVerb;
export declare const post: Verb;
export declare const put: Verb;
export declare const patch: Verb;
export declare const del: Verb;
export declare const remove: Verb;
export declare const options: MetaVerb;
export declare const full: FullNamespace;
export declare const stream: StreamNamespace;
export declare const records: RecordsNamespace;
export declare const sse: Sse;
export declare const track: Track;
export declare const cache: Cache;
export declare const retry: Retry;
export declare const mock: Mock;
export declare const bundle: Bundle;
export declare const update: IO['update'];
export declare const adopt: IO['adopt'];
export {installCodeForward} from './code-forward.js';

export {IOError, FailedIO, BadStatus, TimedOut, isAbort} from './envelope.js';
export type {
  Options,
  Envelope,
  PreparedRequest,
  RequestContext,
  Transport,
  RequestInspector,
  ResponseInspector,
  InspectorMatch,
  DataProcessor,
  MimeProcessor,
  Service,
  RetryConfig,
  Bundle,
  BundlerConfig,
  DecodeMode,
  DownloadProgress,
  StreamDuplex,
  RecordsOverrides,
  SseEvent,
  SseOverrides,
  IO
} from './types.js';
