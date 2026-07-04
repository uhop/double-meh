// @ts-self-types="./encoders.d.ts"
const isReadableStream = data =>
  data != null && typeof data === 'object' && typeof data.getReader === 'function';

const compressionStream = format => source => source.pipeThrough(new CompressionStream(format));

export const installEncoders = io => {
  io.encoders = {};
  if (typeof CompressionStream !== 'undefined') {
    io.encoders.gzip = compressionStream('gzip');
    io.encoders.deflate = compressionStream('deflate');
  }

  // registered at assemble time, so it runs before user inspectors: body signers see the final bytes
  io.inspect.request(async (request, options) => {
    if (!options.compress || request.body == null) return;
    const name = options.compress === true ? 'gzip' : options.compress;
    const encoder = io.encoders[name];
    if (typeof encoder !== 'function') {
      throw new TypeError('io: unknown compression encoder: ' + name);
    }
    if (typeof FormData !== 'undefined' && request.body instanceof FormData) {
      throw new TypeError('io: cannot compress a FormData body — the transport owns its encoding');
    }
    if (typeof URLSearchParams !== 'undefined' && request.body instanceof URLSearchParams) {
      throw new TypeError(
        'io: cannot compress a URLSearchParams body — the transport owns its encoding'
      );
    }
    const wasStream = isReadableStream(request.body);
    const source = wasStream ? request.body : new Response(request.body).body;
    if (!source) return; // new Response('').body is null on some platforms
    const compressed = await encoder(source, options);
    // a buffered body stays buffered: keeps Content-Length semantics and works over h1 everywhere
    request.body = wasStream ? compressed : await new Response(compressed).arrayBuffer();
    request.headers.set('Content-Encoding', name);
    return request;
  });

  return io.encoders;
};
