// @ts-self-types="./memory.d.ts"
const sizeOf = entry => entry.body.byteLength;

export const memoryStorage = ({maxBytes = Infinity} = {}) => {
  const map = new Map();
  let bytes = 0;

  const drop = key => {
    const entry = map.get(key);
    if (entry === undefined) return;
    bytes -= sizeOf(entry);
    map.delete(key);
  };

  return {
    /** Bytes of stored bodies, excluding metadata. */
    get bytes() {
      return bytes;
    },
    get: key => {
      const entry = map.get(key);
      if (entry === undefined) return undefined;
      // a Map iterates in insertion order, so re-inserting on read makes eviction least-recently-used
      map.delete(key);
      map.set(key, entry);
      return entry;
    },
    set: (key, entry) => {
      const size = sizeOf(entry);
      if (size > maxBytes) {
        throw new DOMException(
          'io.memoryStorage: the entry is larger than maxBytes',
          'QuotaExceededError'
        );
      }
      drop(key);
      for (const oldest of map.keys()) {
        if (bytes + size <= maxBytes) break;
        drop(oldest);
      }
      map.set(key, entry);
      bytes += size;
    },
    delete: key => void drop(key),
    clear: () => {
      map.clear();
      bytes = 0;
    },
    keys: () => [...map.keys()]
  };
};
