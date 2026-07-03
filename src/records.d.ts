import type {BadStatus} from './envelope.js';
import type {Envelope, IO, Options} from './types.js';

export declare function lines(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncIterableIterator<string>;

export declare function parsedBadStatus(
  envelope: Envelope,
  baseUrl?: string,
  options?: Options
): Promise<BadStatus>;

export declare function installRecords(io: IO): IO;
