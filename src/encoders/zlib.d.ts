import type {IO, CompressionEncoders} from '../types.js';

/**
 * Registers `br` (always) and `zstd` (where `node:zlib` ships it) into `io.encoders`.
 * CLI-only: needs `node:zlib` (Node, Bun, or Deno).
 */
export declare function installZlibEncoders(io: IO): Promise<CompressionEncoders>;
