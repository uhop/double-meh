import type {Envelope, Options} from './types.js';

export declare function defineEnvelope<T extends object>(
  target: T,
  response: Response,
  data: unknown,
  baseUrl?: string
): T & Envelope;

export declare function makeEnvelope(response: Response, data: unknown, baseUrl?: string): Envelope;

export declare function isAbort(error: unknown): boolean;

export declare class IOError extends Error {
  options?: Options;
  constructor(message?: string, options?: Options, errorOptions?: ErrorOptions);
}

export declare class FailedIO extends IOError {
  response: Response | undefined;
  constructor(
    message?: string,
    response?: Response,
    options?: Options,
    errorOptions?: ErrorOptions
  );
}

export declare class TimedOut extends FailedIO {
  constructor(response?: Response, options?: Options, errorOptions?: ErrorOptions);
}

export declare interface BadStatus<T = unknown> extends Envelope<T> {}
export declare class BadStatus<T = unknown> extends IOError {
  constructor(
    response: Response,
    data: T,
    baseUrl?: string,
    options?: Options,
    errorOptions?: ErrorOptions
  );
  /**
   * The parsed error envelope, best-effort: `data` itself when the body decoded to a structured
   * value (`problem+json` and other JSON types, or a MIME processor's output), else a JSON sniff
   * of a string body (legacy services mislabel their envelopes); `undefined` when nothing
   * parseable arrived. No schema is imposed — RFC 9457 fields are a convention, not a contract.
   */
  readonly problem: unknown;
}
