// @ts-self-types="./zlib.d.ts"
// opt-in CLI module: keeps node:zlib out of the default browser graph (same pattern as storage/sqlite.js)

let loaded;
const load = () =>
  (loaded ??= Promise.all([import('node:zlib'), import('node:stream')]).then(
    ([zlib, {Duplex}]) => ({zlib, Duplex}),
    error => {
      throw new Error('io: the zlib encoders need node:zlib (Node, Bun, or Deno)', {cause: error});
    }
  ));

const wrap = (Duplex, create) => source => source.pipeThrough(Duplex.toWeb(create()));

export const gzipEncoder = async (options = {}) => {
  const {zlib, Duplex} = await load();
  return wrap(Duplex, () => zlib.createGzip(options));
};

export const deflateEncoder = async (options = {}) => {
  const {zlib, Duplex} = await load();
  return wrap(Duplex, () => zlib.createDeflate(options));
};

// brotli's default quality (11) is for static assets; 5 is the on-the-fly convention
export const brotliEncoder = async (options = {}) => {
  const {quality = 5, ...rest} = /** @type {import('./zlib.d.ts').BrotliEncoderOptions} */ (
    options
  );
  const {zlib, Duplex} = await load();
  const params = {[zlib.constants.BROTLI_PARAM_QUALITY]: quality, ...rest.params};
  return wrap(Duplex, () => zlib.createBrotliCompress({...rest, params}));
};

export const zstdEncoder = async (options = {}) => {
  const {level, ...rest} = /** @type {import('./zlib.d.ts').ZstdEncoderOptions} */ (options);
  const {zlib, Duplex} = await load();
  if (typeof zlib.createZstdCompress !== 'function') {
    throw new Error('io: this runtime ships no zstd in node:zlib');
  }
  const params = /** @type {Record<number, number>} */ ({...rest.params});
  if (level !== undefined) params[zlib.constants.ZSTD_c_compressionLevel] = level;
  return wrap(Duplex, () => zlib.createZstdCompress({...rest, params}));
};

export const installZlibEncoders = async (io, options = {}) => {
  const {zlib} = await load();
  io.encoders.br = await brotliEncoder(options.br);
  if (typeof zlib.createZstdCompress === 'function') {
    io.encoders.zstd = await zstdEncoder(options.zstd);
  }
  // the platform CompressionStream pair has no knobs: zlib-backed gzip/deflate register only on explicit options
  if (options.gzip) io.encoders.gzip = await gzipEncoder(options.gzip);
  if (options.deflate) io.encoders.deflate = await deflateEncoder(options.deflate);
  return io.encoders;
};
