// @ts-self-types="./candidates.d.ts"
// Loaded on demand: the ladder imports only the rung that wins, so a page that never caches --
// or lands on the first rung, which is every modern browser -- pays for nothing else.

// Every browser API is reached through `window`, which is the gate as well as the accessor: no
// CLI runtime defines it (checked on Node 26, Bun and Deno), and a worker has `self` instead, so
// a store that would be process-wide can never be picked by accident. Node exposes a global
// `sessionStorage` and Deno exposes `caches`, both of which a bare `typeof` check would accept.
const indexedDb = async () => {
  if (typeof window === 'undefined' || !window.indexedDB) return undefined;
  const {indexedDbStorage} = await import('./indexed-db.js');
  return indexedDbStorage();
};

const cacheApi = async () => {
  if (typeof window === 'undefined' || !window.caches) return undefined;
  const {cacheApiStorage} = await import('./cache-api.js');
  return cacheApiStorage();
};

const sessionStorage = async () => {
  if (typeof window === 'undefined' || !window.sessionStorage) return undefined;
  const {webStorage} = await import('./web-storage.js');
  return webStorage();
};

const memory = async () => {
  const {memoryStorage} = await import('./memory.js');
  return memoryStorage();
};

// order settled by the 2026-09-19 browser benchmark: IndexedDB leads every question, the Cache
// API trails it by two to three times, Web Storage flips with body size. OPFS is omitted -- it
// was last on all five, and keys() over 200 entries cost 162 ms against IndexedDB's 955 us,
// which sweep, remove and eviction all route through.
export const defaultCandidates = [indexedDb, cacheApi, sessionStorage, memory];
