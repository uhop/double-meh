// nano-bench module: wall time of N parallel h2 streams vs 1 bundled stream on one live session.
// Parameterize: BUNDLE_N=20 BUNDLE_SIZE=medium npx nano-bench benchmarks/bundle/bench-wire.js

import {gzipSync} from 'node:zlib';
import {makeCorpus, makeBundle} from './corpus.js';
import {startServer, connect, request} from './wire.js';

const N = Number(process.env.BUNDLE_N) || 20;
const SIZE = process.env.BUNDLE_SIZE || 'medium';

const corpus = makeCorpus({count: N, size: SIZE});
const parts = corpus.map(r => gzipSync(Buffer.from(JSON.stringify(r)), {level: 6}));
const bundle = gzipSync(Buffer.from(JSON.stringify(makeBundle(corpus))), {level: 6});

const server = await startServer({parts, bundle});
const session = await connect(server.address().port);
server.unref();
session.socket.unref();

const paths = parts.map((_, i) => `/one/${i}`);

export default {
  individual: async n => {
    for (let i = 0; i < n; ++i) await Promise.all(paths.map(path => request(session, path)));
  },
  bundled: async n => {
    for (let i = 0; i < n; ++i) await request(session, '/bundle');
  }
};
