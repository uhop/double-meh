import type {CacheStorage} from '../types.js';

export interface AutoStorageOptions {
  /** Called once with the backend that won and its index in the candidate list. */
  onPick?: (storage: CacheStorage, index: number) => void;
}

export interface AutoStorage extends CacheStorage {
  /** Resolves to the backend that won the ladder; selection happens on first use. */
  chosen(): Promise<CacheStorage>;
}

export declare function autoStorage(
  candidates: Array<() => CacheStorage | Promise<CacheStorage>>,
  options?: AutoStorageOptions
): AutoStorage;
