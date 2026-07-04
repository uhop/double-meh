import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// OS cache dir, not os.tmpdir(): tmp is for ephemeral files only
export const osCacheDir = () => {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches');
  if (process.platform === 'win32')
    return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
};

export const appCacheDir = name => path.join(osCacheDir(), name);
