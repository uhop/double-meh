import type {ZlibOptions, BrotliOptions, ZstdOptions} from 'node:zlib';
import type {IO, CompressionEncoder, CompressionEncoders} from '../types.js';

export interface BrotliEncoderOptions extends BrotliOptions {
  /** Sugar for `params[BROTLI_PARAM_QUALITY]` (explicit `params` win). Default: 5 — the on-the-fly convention. */
  quality?: number;
}

export interface ZstdEncoderOptions extends ZstdOptions {
  /** Sugar for `params[ZSTD_c_compressionLevel]` (explicit `params` win). */
  level?: number;
}

export interface ZlibEncoderInstallOptions {
  br?: BrotliEncoderOptions;
  zstd?: ZstdEncoderOptions;
  /** When set, a parameterized `node:zlib` gzip replaces the knobless platform `CompressionStream` one. */
  gzip?: ZlibOptions;
  /** When set, a parameterized `node:zlib` deflate replaces the knobless platform `CompressionStream` one. */
  deflate?: ZlibOptions;
}

export declare function gzipEncoder(options?: ZlibOptions): Promise<CompressionEncoder>;
export declare function deflateEncoder(options?: ZlibOptions): Promise<CompressionEncoder>;
export declare function brotliEncoder(options?: BrotliEncoderOptions): Promise<CompressionEncoder>;
/** Throws where the runtime ships no zstd in `node:zlib`. */
export declare function zstdEncoder(options?: ZstdEncoderOptions): Promise<CompressionEncoder>;

/**
 * Registers `br` (always) and `zstd` (where `node:zlib` ships it) into `io.encoders`;
 * `gzip`/`deflate` only on explicit options. CLI-only: needs `node:zlib` (Node, Bun, or Deno).
 */
export declare function installZlibEncoders(
  io: IO,
  options?: ZlibEncoderInstallOptions
): Promise<CompressionEncoders>;
