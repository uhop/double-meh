# Architecture

`double-meh` — a modern, fetch-native, ESM HTTP I/O library for browsers and CLIs (Node/Bun/Deno).
It has **zero runtime dependencies** — only dev dependencies for testing and type-checking.
The deep design record lives in [dev-docs/design.md](./dev-docs/design.md).

## Project layout

```
package.json              # Package config; "tape6" section configures test discovery
src/                      # Source code (plain ESM, no build step; published as-is)
├── index.js              # Main entry: assembles the default instance (batteries included)
├── io.js                 # Core pipeline + createIO() factory (verbs, run, dispatch, events)
├── envelope.js           # Response envelope + error taxonomy (IOError/FailedIO/TimedOut/BadStatus)
├── key.js                # URL building, canonicalization, request identity (makeKey)
├── helpers.js            # io.update() (conditional RMW), io.paginate() (row iterator), io.getByIds()
├── encoders.js           # io.encoders registry + compress option (gzip/deflate via CompressionStream)
├── encoders/
│   └── zlib.js           # Opt-in br/zstd via node:zlib (kept out of browser bundles)
├── code-forward.js       # __doubleMeh prelude protocol (early network hoisting)
├── services/             # Response-level middleware (priority onion) + run-level track
│   ├── track.js          # In-flight GET dedup (decoded-envelope level) + adopt
│   ├── cache.js          # App-governed cache (on by default for GETs, TTL, 304 revalidation)
│   ├── retry.js          # Verb-safety-aware retry (+ polling via continueRetries)
│   └── mock.js           # Serverless mocking; composes with the real pipeline
├── storage/              # Swappable cache backends (get/set/delete/clear/keys)
│   ├── memory.js         # Map-backed default (per instance, no persistence)
│   ├── fs.js             # One file per entry in the OS cache dir; atomic temp+rename writes
│   ├── sqlite.js         # Feature-detected node:sqlite / bun:sqlite (not Deno); async factory
│   ├── cache-api.js      # Browser Cache API; metadata as synthetic x-io-* headers
│   └── cache-dir.js      # OS cache-dir resolution (XDG, ~/Library/Caches, %LOCALAPPDATA%)
├── transports/
│   └── fetch.js          # The one core transport
└── *.d.ts                # Hand-written TypeScript declarations (kept in sync per module)
tests/                    # Universal tests (tape-six); cli/ = Node/Bun/Deno-only, web/ = browser-only,
                          # server/ = tape6-server wire fixtures (echo/status/delay/etag/jsonl/sse/upload)
dev-docs/                 # Internal developer documentation (design.md, parity survey)
wiki/                     # GitHub wiki documentation (git submodule)
.github/                  # CI workflows, Dependabot config
```

## Core concepts

- **One pipeline:** `verb sugar → buildOptions → prepare (headers/body/url) → request inspectors →
track (run-level dedup) → services onion (cache → retry → mock) → transport → decode →
envelope → response inspectors`.
- **The method declares the return shape:** `io.get` → parsed data, `io.full.get` → the envelope,
  `io.stream.get` → a `ReadableStream`, `io.stream.put/post/patch` → a duplex. Options tune
  behavior, never shape.
- **Services opt in per request** (the service's own option wins) or by `theDefault`
  (boolean/predicate). Cache and track are on by default for plain GETs.
- **Instances:** the default export is one shared configured instance; `io.create()` gives an
  isolated equivalent; `createIO()` gives a bare pipeline.

## Module dependency graph

```
src/index.js
├── src/io.js
│   ├── src/key.js
│   └── src/envelope.js
├── src/transports/fetch.js
├── src/services/track.js
├── src/services/cache.js   → src/key.js, src/storage/memory.js
├── src/services/retry.js   → src/envelope.js
├── src/services/mock.js    → src/key.js
├── src/helpers.js
├── src/encoders.js
└── src/code-forward.js

src/storage/fs.js           → src/storage/cache-dir.js   (opt-in import)
src/storage/sqlite.js       → src/storage/cache-dir.js   (opt-in import)
src/storage/cache-api.js                                 (opt-in import)
src/encoders/zlib.js                                     (opt-in import)
```

## Testing

- **Framework**: tape-six (`tape6`)
- **Run all**: `npm test` (parallel workers via `tape6 --flags FO`)
- **Run single file**: `node tests/test-<name>.mjs`
- **Run with Bun**: `npm run test:bun`
- **Run with Deno**: `npm run test:deno`
- **Run in a browser**: `npm run test:browser` (Chromium via tape-six-playwright, h1);
  `npm run test:browser:h2` switches the test server to HTTP/2, which un-skips the Chromium-only
  `io.stream` duplex upload-streaming suite (`tests/web/test-web-duplex.mjs`)
- **Run sequential**: `npm run test:seq` (also `test:seq:bun`, `test:seq:deno`)
- **TypeScript check**: `npm run ts-check`
- **JS implementation check**: `npm run js-check` (checkJs over `src/`)
- **TypeScript tests**: `npm run ts-test` (also `ts-test:bun`, `ts-test:deno`)
- **Lint**: `npm run lint` (Prettier check)
- **Lint fix**: `npm run lint:fix` (Prettier write)

## Import paths

```js
// Main API — the shared, fully configured instance
import io from 'double-meh';

// Named pieces
import {get, full, stream, update, adopt, create, IOError, BadStatus} from 'double-meh';

// Minimal build — bare pipeline plus only the services you want
import {createIO} from 'double-meh/io.js';
import {fetchTransport} from 'double-meh/transports/fetch.js';
import {installCache} from 'double-meh/services/cache.js';

// Persistent cache backends — opt-in, swapped via io.cache.storage
import {fsStorage} from 'double-meh/storage/fs.js';
import {sqliteStorage} from 'double-meh/storage/sqlite.js';
import {cacheApiStorage} from 'double-meh/storage/cache-api.js';

// CLI compression encoders (br/zstd) — opt-in, registered into io.encoders
import {installZlibEncoders} from 'double-meh/encoders/zlib.js';
```
