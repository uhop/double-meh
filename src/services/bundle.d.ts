import type {IO, Bundle} from '../types.js';

export declare const REQUEST_MIME: string;
export declare const BUNDLE_MIME: string;

/**
 * Installs the bundle service: batches eligible GETs into one PUT to a bundler endpoint
 * (wire format v1, see the design record) and unbundles bundle-typed responses from any endpoint.
 */
export declare function installBundle(io: IO): Bundle;
