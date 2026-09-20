import type {CacheStorage} from '../types.js';

export interface IndexedDbStorageOptions {
  /** Database name passed to `indexedDB.open()`. Default: `'double-meh'`. */
  name?: string;
}

export declare function indexedDbStorage(options?: IndexedDbStorageOptions): CacheStorage;
