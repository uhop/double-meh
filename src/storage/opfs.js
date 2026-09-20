// @ts-self-types="./opfs.d.ts"
// one file per entry, as in the filesystem backend: a JSON metadata line, then the raw body bytes
const EXT = '.entry';

const encoder = new TextEncoder();

const fileName = async key => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(key));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') + EXT;
};

const parseMeta = buffer => {
  const bytes = new Uint8Array(buffer);
  const eol = bytes.indexOf(10);
  if (eol < 0) return null;
  try {
    const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(0, eol)));
    return meta && typeof meta.key === 'string' ? {meta, eol} : null;
  } catch {
    return null;
  }
};

export const opfsStorage = ({name = 'double-meh'} = {}) => {
  let opened;
  const dir = () =>
    (opened ||= navigator.storage
      .getDirectory()
      .then(root => root.getDirectoryHandle(name, {create: true})));

  const read = async file => {
    try {
      const handle = await (await dir()).getFileHandle(file);
      return await (await handle.getFile()).arrayBuffer();
    } catch {
      return undefined; // missing or unreadable → a miss
    }
  };

  const list = async () => {
    const names = [];
    try {
      for await (const file of (await dir()).keys()) if (file.endsWith(EXT)) names.push(file);
    } catch {}
    return names;
  };

  return {
    get: async key => {
      const buffer = await read(await fileName(key));
      const parsed = buffer && parseMeta(buffer);
      if (!parsed || parsed.meta.key !== key) return undefined;
      const {meta, eol} = parsed;
      return {
        status: meta.status,
        statusText: meta.statusText,
        headers: meta.headers,
        etag: meta.etag ?? undefined,
        lastModified: meta.lastModified ?? undefined,
        // JSON has no Infinity: null marks "never expires"
        expiresAt: meta.expiresAt == null ? Infinity : meta.expiresAt,
        vary: meta.vary,
        body: buffer.slice(eol + 1)
      };
    },
    set: async (key, entry) => {
      const handle = await (await dir()).getFileHandle(await fileName(key), {create: true});
      const meta = {
        key,
        status: entry.status,
        statusText: entry.statusText,
        headers: entry.headers,
        etag: entry.etag,
        lastModified: entry.lastModified,
        expiresAt: entry.expiresAt === Infinity ? null : entry.expiresAt,
        vary: entry.vary
      };
      // createWritable() stages into a swap file: the stored entry stays whole until close()
      const writable = await handle.createWritable();
      try {
        await writable.write(encoder.encode(JSON.stringify(meta) + '\n'));
        await writable.write(entry.body);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
    },
    delete: async key => {
      try {
        await (await dir()).removeEntry(await fileName(key));
      } catch {}
    },
    clear: async () => {
      const root = await dir();
      const files = await list();
      const failures = [];
      for (const file of files) {
        try {
          await root.removeEntry(file);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) {
        throw new AggregateError(
          failures,
          'io.opfsStorage.clear: ' + failures.length + ' of ' + files.length + ' entries failed'
        );
      }
    },
    // the weak spot: the key lives in the file, so listing them means opening every entry
    keys: async () => {
      const result = [];
      for (const file of await list()) {
        const buffer = await read(file);
        const parsed = buffer && parseMeta(buffer);
        if (parsed) result.push(parsed.meta.key);
      }
      return result;
    }
  };
};
