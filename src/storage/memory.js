export const memoryStorage = () => {
  const map = new Map();
  return {
    get: key => map.get(key),
    set: (key, entry) => void map.set(key, entry),
    delete: key => void map.delete(key),
    clear: () => void map.clear(),
    keys: () => [...map.keys()]
  };
};
