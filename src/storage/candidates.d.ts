import type {CacheStorage} from '../types.js';

/**
 * The default ladder for `io.cache.storage`, in order: IndexedDB, the Cache API, `sessionStorage`,
 * memory. Each entry loads its backend on demand and answers `undefined` where the API is absent.
 */
export declare const defaultCandidates: Array<() => Promise<CacheStorage | undefined>>;
