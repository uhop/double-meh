import type {Envelope, Options} from './types.js';

export declare function defineEnvelope<T extends object>(
  target: T,
  response: Response,
  data: unknown,
  baseUrl?: string
): T & Envelope;

export declare function makeEnvelope(response: Response, data: unknown, baseUrl?: string): Envelope;

export declare class FailedIO extends Error {
  response: Response | null;
  options?: Options;
  constructor(message?: string, response?: Response | null, options?: Options);
}

export declare class TimedOut extends FailedIO {
  constructor(response?: Response | null, options?: Options);
}

export declare class BadStatus extends FailedIO {
  data: unknown;
  status: number;
  ok: boolean;
  constructor(response: Response, data: unknown, baseUrl?: string, options?: Options);
}
