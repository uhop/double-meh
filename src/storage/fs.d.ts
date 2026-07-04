import type {CacheStorage} from '../types.js';

export interface FsStorageOptions {
  /** Directory for entry files; overrides `name`. */
  directory?: string;
  /** App namespace inside the OS cache dir. Default: `'double-meh'`. */
  name?: string;
}

export declare function fsStorage(options?: FsStorageOptions): CacheStorage & {directory: string};
