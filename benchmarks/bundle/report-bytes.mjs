// Bundle-vs-individual byte report: (1) compressed body bytes per codec — N cold windows vs one
// shared window; (2) real h2 wire bytes per arm from socket counters (frames + HPACK included).

import {gzipSync, brotliCompressSync, zstdCompressSync, constants} from 'node:zlib';
import {makeCorpus, makeBundle} from './corpus.js';
import {startServer, connect, request} from './wire.js';

const CODECS = {
  'gzip-6': b => gzipSync(b, {level: 6}),
  'br-5': b => brotliCompressSync(b, {params: {[constants.BROTLI_PARAM_QUALITY]: 5}}),
  'zstd-3': b => zstdCompressSync(b)
};

const SIZES = ['small', 'medium', 'large'];
const COUNTS = [5, 20, 50];

const encode = value => Buffer.from(JSON.stringify(value));
const kb = bytes => (bytes / 1024).toFixed(1).padStart(7) + 'k';
const pct = (individual, bundled) =>
  (((individual - bundled) / individual) * 100).toFixed(1).padStart(5) + '%';

console.log('== compressed body bytes: sum of N individual responses vs one bundled body ==\n');
console.log('size    N     raw-sum  codec    individual   bundled    saving');

for (const size of SIZES) {
  for (const count of COUNTS) {
    const corpus = makeCorpus({count, size});
    const parts = corpus.map(encode);
    const rawSum = parts.reduce((acc, part) => acc + part.length, 0);
    const bundleRaw = encode(makeBundle(corpus));
    let first = true;
    for (const [name, compress] of Object.entries(CODECS)) {
      const individual = parts.reduce((acc, part) => acc + compress(part).length, 0);
      const bundled = compress(bundleRaw).length;
      console.log(
        `${first ? size.padEnd(7) : '       '} ${String(count).padStart(2)}  ${first ? kb(rawSum) : '        '}  ` +
          `${name.padEnd(7)} ${kb(individual)}    ${kb(bundled)}    ${pct(individual, bundled)}`
      );
      first = false;
    }
  }
  console.log('');
}

// wire bytes: fresh session per arm (comparable HPACK state); totals include preface/SETTINGS,
// identical in both arms, so the delta is pure per-stream overhead + body difference
const measureArm = async (port, paths) => {
  const session = await connect(port);
  const socket = session.socket;
  await Promise.all(paths.map(path => request(session, path)));
  await new Promise(resolve => setTimeout(resolve, 50));
  const result = {written: socket.bytesWritten, read: socket.bytesRead};
  await new Promise(resolve => session.close(resolve));
  return result;
};

console.log('== h2 wire bytes per arm (gzip-6 bodies; socket totals incl. frames + HPACK) ==\n');
console.log('size    N    ind-up   ind-down   bun-up   bun-down   down-saving');

for (const size of SIZES) {
  for (const count of COUNTS) {
    const corpus = makeCorpus({count, size});
    const parts = corpus.map(r => CODECS['gzip-6'](encode(r)));
    const bundle = CODECS['gzip-6'](encode(makeBundle(corpus)));
    const server = await startServer({parts, bundle});
    const port = server.address().port;
    const individual = await measureArm(
      port,
      parts.map((_, i) => `/one/${i}`)
    );
    const bundled = await measureArm(port, ['/bundle']);
    await new Promise(resolve => server.close(resolve));
    console.log(
      `${size.padEnd(7)} ${String(count).padStart(2)}  ${kb(individual.written)}  ${kb(individual.read)}   ` +
        `${kb(bundled.written)}  ${kb(bundled.read)}     ${pct(individual.read, bundled.read)}`
    );
  }
  console.log('');
}
