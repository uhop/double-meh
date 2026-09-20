import {memoryStorage} from '../src/storage/memory.js';
import {indexedDbStorage} from '../src/storage/indexed-db.js';
import {cacheApiStorage} from '../src/storage/cache-api.js';
import {webStorage} from '../src/storage/web-storage.js';
import {opfsStorage} from '../src/storage/opfs.js';

const unique = () => 'dm-bench-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

// why a backend is missing matters more than that it is: an absent global on an insecure origin is
// a property of the URL, not of the engine, and reads identically otherwise
const insecure = () =>
  globalThis.isSecureContext ? null : 'absent here: needs a secure context (https, or localhost)';

export const candidates = () => [
  {name: 'memory', skip: null, create: () => memoryStorage()},
  {
    name: 'indexed-db',
    skip: typeof indexedDB === 'undefined' ? 'no indexedDB' : null,
    create: () => indexedDbStorage({name: unique()})
  },
  {
    name: 'web-storage',
    skip: typeof sessionStorage === 'undefined' ? 'no sessionStorage' : null,
    create: () => webStorage({name: unique()})
  },
  {
    name: 'cache-api',
    skip: typeof caches === 'undefined' ? insecure() || 'no caches' : null,
    create: () => cacheApiStorage({name: unique()})
  },
  {
    name: 'opfs',
    skip: !globalThis.navigator?.storage?.getDirectory
      ? insecure() || 'no navigator.storage'
      : null,
    create: () => opfsStorage({name: unique()})
  }
];
