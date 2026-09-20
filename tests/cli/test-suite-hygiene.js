import test from 'tape-six';
import {readdir, readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The shared `io` must come from helper.js, which pins its cache to memory. A file importing the
// default export straight from src gets the real default instead: an origin-scoped, persistent
// store that another test file has already written to. That is invisible wherever the runner
// keeps files in one worker and fails wherever it does not, so a static check is the only kind
// that catches it before a browser does.
const DIRECT_DEFAULT = /^\s*import\s+io\s+from\s+['"][^'"]*src\/index\.js['"]/m;

test('suite hygiene: the shared instance comes from the helper', async t => {
  const offenders = [];
  for (const dir of ['', 'cli', 'web']) {
    const here = join(ROOT, dir);
    for (const name of await readdir(here)) {
      if (!name.startsWith('test-') || !/\.m?js$/.test(name)) continue;
      const path = join(here, name);
      if (DIRECT_DEFAULT.test(await readFile(path, 'utf8'))) offenders.push(join(dir, name));
    }
  }
  t.deepEqual(offenders, [], 'no test file imports the default io straight from src/index.js');
});
