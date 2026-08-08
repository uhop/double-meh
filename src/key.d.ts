import type {Options} from './types.js';

export declare function buildUrl(options: Options): string;
export declare function canonicalUrl(rawUrl: string): string;
/** Resolves against the page URL; unchanged when there is no base. No canonicalization. */
export declare function absoluteUrl(rawUrl: string): string;
export declare function requestKey(method: string, url: string, accept?: string | null): string;
export declare function acceptOf(options: Options): string | undefined;
