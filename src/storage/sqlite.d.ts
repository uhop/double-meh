import type {CacheStorage} from '../types.js';

export interface SqliteStorageOptions {
  /** Database file path (or `':memory:'`); overrides `name`. */
  database?: string;
  /** App namespace inside the OS cache dir. Default: `'double-meh'`. */
  name?: string;
}

export declare function sqliteStorage(
  options?: SqliteStorageOptions
): Promise<CacheStorage & {database: string; close(): void}>;
