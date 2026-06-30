import type {Options} from './types.js';

export declare function buildUrl(options: Options): string;
export declare function canonicalUrl(rawUrl: string): string;
export declare function requestKey(method: string, url: string): string;
