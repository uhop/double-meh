// @ts-self-types="./zlib.d.ts"
// opt-in CLI module: keeps node:zlib out of the default browser graph (same pattern as storage/sqlite.js)
export const installZlibEncoders = async io => {
  let zlib, Duplex;
  try {
    [zlib, {Duplex}] = await Promise.all([import('node:zlib'), import('node:stream')]);
  } catch (error) {
    throw new Error('io: the br/zstd encoders need node:zlib (Node, Bun, or Deno)', {
      cause: error
    });
  }
  const wrap = create => source => source.pipeThrough(Duplex.toWeb(create()));
  // brotli's default quality (11) is for static assets; 5 is the on-the-fly convention
  io.encoders.br = wrap(() =>
    zlib.createBrotliCompress({
      params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 5}
    })
  );
  if (typeof zlib.createZstdCompress === 'function') {
    io.encoders.zstd = wrap(() => zlib.createZstdCompress());
  }
  return io.encoders;
};
