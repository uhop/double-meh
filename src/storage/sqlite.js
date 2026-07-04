// @ts-self-types="./sqlite.d.ts"
import fs from 'node:fs/promises';
import path from 'node:path';

import {appCacheDir} from './cache-dir.js';

const runtime = /** @type {{Bun?: unknown, Deno?: unknown}} */ (globalThis);

const openDatabase = async file => {
  if (runtime.Bun !== undefined) {
    const {Database} = await import('bun:sqlite');
    return new Database(file);
  }
  try {
    const {DatabaseSync} = await import('node:sqlite');
    return new DatabaseSync(file);
  } catch (error) {
    throw new Error('io: the SQLite backend needs node:sqlite (Node ≥ 22.5) or bun:sqlite', {
      cause: error
    });
  }
};

const toArrayBuffer = bytes =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

export const sqliteStorage = async (options = {}) => {
  const {database, name = 'double-meh'} = /** @type {{database?: string, name?: string}} */ (
    options
  );
  // never Deno: no built-in driver, and a dependency is off the zero-dep path
  if (runtime.Deno !== undefined)
    throw new Error('io: the SQLite backend is not supported on Deno');
  let file = database;
  if (!file) {
    const dir = appCacheDir(name);
    await fs.mkdir(dir, {recursive: true});
    file = path.join(dir, 'cache.sqlite');
  }
  const db = await openDatabase(file);
  db.exec(
    'CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, meta TEXT NOT NULL, body BLOB NOT NULL)'
  );
  const getStmt = db.prepare('SELECT meta, body FROM entries WHERE key = ?');
  const setStmt = db.prepare('INSERT OR REPLACE INTO entries (key, meta, body) VALUES (?, ?, ?)');
  const deleteStmt = db.prepare('DELETE FROM entries WHERE key = ?');
  const clearStmt = db.prepare('DELETE FROM entries');
  const keysStmt = db.prepare('SELECT key FROM entries');

  return {
    database: file,
    get: key => {
      const row = /** @type {{meta: string, body: Uint8Array} | undefined} */ (getStmt.get(key));
      if (!row) return undefined;
      let meta;
      try {
        meta = JSON.parse(row.meta);
      } catch {
        return undefined;
      }
      return {
        status: meta.status,
        statusText: meta.statusText,
        headers: meta.headers,
        etag: meta.etag ?? undefined,
        lastModified: meta.lastModified ?? undefined,
        // JSON has no Infinity: null marks "never expires"
        expiresAt: meta.expiresAt == null ? Infinity : meta.expiresAt,
        vary: meta.vary ?? undefined,
        body: toArrayBuffer(row.body)
      };
    },
    set: (key, entry) => {
      const meta = {
        status: entry.status,
        statusText: entry.statusText,
        headers: entry.headers,
        etag: entry.etag,
        lastModified: entry.lastModified,
        expiresAt: entry.expiresAt === Infinity ? null : entry.expiresAt,
        vary: entry.vary
      };
      setStmt.run(key, JSON.stringify(meta), new Uint8Array(entry.body));
    },
    delete: key => void deleteStmt.run(key),
    clear: () => void clearStmt.run(),
    keys: () => keysStmt.all().map(row => row.key),
    close: () => db.close()
  };
};
