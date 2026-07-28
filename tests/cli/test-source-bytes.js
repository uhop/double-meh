import test from 'tape-six';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// invariant: no raw control bytes in source. A stray one is invisible everywhere it would normally
// surface — editors render nothing, prettier and tsc accept it, tests pass (the runtime value is
// correct), and grep/git go binary-silent rather than erroring. Write escapes instead: '\0', '\t'.

const ALLOWED = new Set([0x09, 0x0a, 0x0d]); // tab, LF, CR

const SOURCE_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.mts', '.cts', '.json'];

const findControlBytes = buffer => {
  const hits = [];
  for (let i = 0; i < buffer.length; ++i) {
    const byte = buffer[i];
    if (byte === 0x7f || (byte < 0x20 && !ALLOWED.has(byte))) {
      const line = buffer.subarray(0, i).toString('utf8').split('\n').length;
      hits.push({offset: i, line, byte});
    }
  }
  return hits;
};

const listSources = async dir => {
  const result = [];
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await listSources(full)));
    else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) result.push(full);
  }
  return result;
};

test('the guard itself spots a raw control byte', t => {
  const clean = Buffer.from("const name = '\\0submit-' + counter;\n", 'utf8');
  t.deepEqual(findControlBytes(clean), [], 'an escape sequence is two plain characters');

  const raw = Buffer.from([0x61, 0x20, 0x3d, 0x20, 0x27, 0x00, 0x27, 0x0a]);
  const hits = findControlBytes(raw);
  t.equal(hits.length, 1, 'flags a raw NUL');
  t.equal(hits[0].byte, 0x00, 'reports the offending byte');
  t.deepEqual(
    findControlBytes(Buffer.from('a\tb\r\nc\n', 'utf8')),
    [],
    'tab, CR and LF are allowed'
  );
});

test('no source file carries a raw control byte', async t => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const files = [
    ...(await listSources(path.join(root, 'src'))),
    ...(await listSources(path.join(root, 'tests')))
  ];
  t.ok(files.length > 40, 'the scan sees the source tree');
  for (const file of files) {
    const hits = findControlBytes(await fs.readFile(file));
    const where = hits
      .map(h => `line ${h.line} (0x${h.byte.toString(16).padStart(2, '0')})`)
      .join(', ');
    t.equal(hits.length, 0, path.relative(root, file) + (where ? ' has ' + where : ''));
  }
});
