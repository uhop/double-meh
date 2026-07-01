import type {
  IO,
  Verb,
  FullNamespace,
  StreamNamespace,
  Ios,
  Track,
  Cache,
  Retry,
  Mock,
  Target,
  Overrides,
  Envelope
} from './types.js';

declare const io: IO;
export default io;

export const get: Verb;
export const head: Verb;
export const post: Verb;
export const put: Verb;
export const patch: Verb;
export const del: Verb;
export const remove: Verb;
export const options: Verb;
export const full: FullNamespace;
export const stream: StreamNamespace;
export const ios: Ios;
export const track: Track;
export const cache: Cache;
export const retry: Retry;
export const mock: Mock;
export const update: (
  target: Target,
  fn: (data: unknown) => unknown,
  options?: Overrides
) => Promise<unknown>;
export const adopt: (options: Target, source: Promise<Response> | Response) => Promise<Envelope>;
export {installCodeForward} from './code-forward.js';

export {FailedIO, BadStatus, TimedOut} from './envelope.js';
export type {
  Options,
  Envelope,
  PreparedRequest,
  RequestContext,
  Transport,
  RequestInspector,
  ResponseInspector,
  DataProcessor,
  MimeProcessor,
  Service,
  IO
} from './types.js';
