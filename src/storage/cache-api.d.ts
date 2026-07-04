import type {CacheStorage} from '../types.js';

export interface CacheApiStorageOptions {
  /** Cache name passed to `caches.open()`. Default: `'double-meh'`. */
  name?: string;
}

export declare function cacheApiStorage(options?: CacheApiStorageOptions): CacheStorage;
