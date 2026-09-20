import type {CacheStorage} from '../types.js';

export interface WebStorageOptions {
  /** The store to use. Default: `sessionStorage`. Pass `localStorage` to outlive the tab. */
  store?: Storage;
  /** Key-prefix namespace inside the store. Default: `'double-meh'`. */
  name?: string;
}

export declare function webStorage(options?: WebStorageOptions): CacheStorage;
