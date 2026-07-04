// @ts-self-types="./fs.d.ts"
import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {appCacheDir} from './cache-dir.js';

const EXT = '.entry';

const fileName = key => createHash('sha256').update(key).digest('hex') + EXT;

const parseMeta = buffer => {
  const eol = buffer.indexOf(10);
  if (eol < 0) return null;
  try {
    const meta = JSON.parse(buffer.subarray(0, eol).toString());
    return meta && typeof meta.key === 'string' ? {meta, eol} : null;
  } catch {
    return null;
  }
};

export const fsStorage = (options = {}) => {
  const {directory, name = 'double-meh'} = /** @type {{directory?: string, name?: string}} */ (
    options
  );
  const dir = directory || appCacheDir(name);
  let prepared;
  const prepare = () => (prepared ||= fs.mkdir(dir, {recursive: true}));

  const read = async file => {
    try {
      return await fs.readFile(file);
    } catch {
      return undefined; // missing or unreadable → miss
    }
  };

  const list = async () => {
    try {
      return (await fs.readdir(dir)).filter(file => file.endsWith(EXT));
    } catch {
      return [];
    }
  };

  return {
    directory: dir,
    get: async key => {
      const buffer = await read(path.join(dir, fileName(key)));
      if (!buffer) return undefined;
      const parsed = parseMeta(buffer);
      if (!parsed || parsed.meta.key !== key) return undefined;
      const {meta, eol} = parsed;
      const bytes = buffer.subarray(eol + 1);
      return {
        status: meta.status,
        statusText: meta.statusText,
        headers: meta.headers,
        etag: meta.etag ?? undefined,
        lastModified: meta.lastModified ?? undefined,
        // JSON has no Infinity: null marks "never expires"
        expiresAt: meta.expiresAt == null ? Infinity : meta.expiresAt,
        vary: meta.vary ?? undefined,
        body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      };
    },
    set: async (key, entry) => {
      await prepare();
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
      const file = path.join(dir, fileName(key));
      const temp = file + '.' + randomUUID() + '.tmp'; // same dir: rename stays atomic
      await fs.writeFile(
        temp,
        Buffer.concat([Buffer.from(JSON.stringify(meta) + '\n'), new Uint8Array(entry.body)])
      );
      await fs.rename(temp, file);
    },
    delete: async key => {
      try {
        await fs.unlink(path.join(dir, fileName(key)));
      } catch {}
    },
    clear: async () => {
      await Promise.all(
        (await list()).map(file => fs.unlink(path.join(dir, file)).catch(() => {}))
      );
    },
    keys: async () => {
      const result = [];
      for (const file of await list()) {
        const buffer = await read(path.join(dir, file));
        const parsed = buffer && parseMeta(buffer);
        if (parsed) result.push(parsed.meta.key);
      }
      return result;
    }
  };
};
