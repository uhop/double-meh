// @ts-self-types="./indexed-db.d.ts"
// structured clone stores the entry verbatim: ArrayBuffer body, Infinity expiry, headers array
const STORE = 'entries';

export const indexedDbStorage = ({name = 'double-meh'} = {}) => {
  let opened;
  const open = () =>
    (opened ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));

  const run = async (mode, act) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = act(tx.objectStore(STORE));
      // settle on the transaction, not the request: an abort is where a quota failure arrives
      tx.oncomplete = () => resolve(request && request.result);
      const fail = () => reject(tx.error || (request && request.error));
      tx.onabort = fail;
      tx.onerror = fail;
    });
  };

  return {
    get: key => run('readonly', store => store.get(key)),
    set: (key, entry) => run('readwrite', store => store.put(entry, key)).then(() => undefined),
    delete: key => run('readwrite', store => store.delete(key)).then(() => undefined),
    clear: () => run('readwrite', store => store.clear()).then(() => undefined),
    keys: () => run('readonly', store => store.getAllKeys())
  };
};
