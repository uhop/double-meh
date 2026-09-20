// @ts-self-types="./candidates.d.ts"
// Loaded on demand: the ladder imports only the rung that wins, so a page that never caches --
// or lands on the first rung, which is every modern browser -- pays for nothing else.

// The browser tier is gated on `window` rather than on each API being present, because presence
// is not the question. Node 26 exposes a process-global `sessionStorage`, and Deno exposes
// `caches` and (with --location) Web Storage, so a per-API check hands a CLI a store every
// instance in the process shares. A worker has the APIs and no `window`; set io.cache.storage
// explicitly there.
const inBrowser = () => typeof window !== 'undefined' && typeof window.document !== 'undefined';

const indexedDb = async () => {
  if (!inBrowser() || typeof indexedDB === 'undefined') return undefined;
  const {indexedDbStorage} = await import('./indexed-db.js');
  return indexedDbStorage();
};

const cacheApi = async () => {
  if (!inBrowser() || typeof caches === 'undefined') return undefined;
  const {cacheApiStorage} = await import('./cache-api.js');
  return cacheApiStorage();
};

const sessionStorage = async () => {
  if (!inBrowser() || typeof globalThis.sessionStorage === 'undefined') return undefined;
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
