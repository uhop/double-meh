import type {CacheStorage} from '../types.js';

export interface OpfsStorageOptions {
  /** Directory name inside the origin private file system. Default: `'double-meh'`. */
  name?: string;
}

export declare function opfsStorage(options?: OpfsStorageOptions): CacheStorage;
