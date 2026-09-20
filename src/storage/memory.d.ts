import type {CacheStorage} from '../types.js';

export interface MemoryStorageOptions {
  /**
   * Cap on the total size of stored bodies. Past it, least-recently-used entries are dropped to
   * make room; an entry larger than the cap is refused with a `QuotaExceededError`.
   * Default: `Infinity` — unbounded, which is a leak wherever the process is long-lived.
   */
  maxBytes?: number;
}

export interface MemoryStorage extends CacheStorage {
  /** Bytes of stored bodies, excluding metadata. */
  readonly bytes: number;
}

export declare function memoryStorage(options?: MemoryStorageOptions): MemoryStorage;
