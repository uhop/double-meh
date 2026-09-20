import type {Options, Target} from './types.js';

export declare function buildUrl(options: Options): string;
export declare function canonicalUrl(rawUrl: string): string;
/** Resolves against the page URL; unchanged when there is no base. No canonicalization. */
export declare function absoluteUrl(rawUrl: string): string;
export declare function requestKey(
  method: string,
  url: string,
  accept?: string | null,
  body?: string | null
): string;
/** Methods whose responses may be shared: safe and idempotent. */
export declare const safeMethods: Record<string, 1>;
/** The body's contribution to the key: `variant`, or a hash of a safe method's stable data. */
export declare function bodyKeyOf(options: Options): string | undefined;
export declare function acceptOf(options: Options): string | undefined;
/** Reduces a target to keyable options. A `Request` contributes only method, URL and `Accept`. */
export declare function normalizeTarget(target: Target): Options;
