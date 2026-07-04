# AGENTS.md — double-meh

> <!-- TODO: Replace with actual project description -->
>
> `double-meh` — HTTP I/O. A lightweight, zero-dependency micro-package.

For project structure, module dependencies, and the architecture overview see [ARCHITECTURE.md](./ARCHITECTURE.md).
For detailed usage docs and API references see the [wiki](https://github.com/uhop/double-meh/wiki).

## Setup

This project uses a git submodule for the wiki:

```bash
git clone --recursive git@github.com:uhop/double-meh.git
cd double-meh
npm install
```

## Commands

- **Install:** `npm install`
- **Test:** `npm test` (runs `tape6 --flags FO`)
- **Test (Bun):** `npm run test:bun`
- **Test (Deno):** `npm run test:deno`
- **Test (sequential):** `npm run test:seq` (also `test:seq:bun`, `test:seq:deno`)
- **Test (single file):** `node tests/test-<name>.mjs`
- **Test (browser, Chromium via Playwright):** `npm run test:browser`; `npm run test:browser:h2` adds HTTP/2 (enables the duplex upload-streaming suite)
- **TypeScript check (`.d.ts`/`.mts` contracts):** `npm run ts-check`
- **JS implementation check (`checkJs` over `src/`):** `npm run js-check`
- **TypeScript tests:** `npm run ts-test` (also `ts-test:bun`, `ts-test:deno`)
- **Lint:** `npm run lint` (Prettier check)
- **Lint fix:** `npm run lint:fix` (Prettier write)

## Project structure

```
double-meh/
├── package.json          # Package config; "tape6" section configures test discovery
├── src/                  # Source code (plain ESM, no build step)
│   ├── index.js          # Main entry: assembles the default instance
│   ├── io.js             # Core pipeline + createIO() factory
│   ├── envelope.js       # Envelope + errors (IOError/FailedIO/TimedOut/BadStatus)
│   ├── key.js            # URL building + canonical request identity
│   ├── helpers.js        # io.update(), io.paginate(), io.getByIds()
│   ├── code-forward.js   # __doubleMeh prelude protocol
│   ├── services/         # track, cache, retry, mock
│   ├── storage/          # cache backends: memory (default), fs, sqlite, cache-api
│   └── transports/       # fetch
├── tests/                # Universal test files; cli/ = runtime-only, web/ = browser-only, server/ = wire fixtures
├── dev-docs/             # Internal developer documentation (design.md)
├── wiki/                 # GitHub wiki documentation (git submodule)
└── .github/              # CI workflows, Dependabot config
```

## Code style

- **ESM** throughout (`"type": "module"` in package.json). Use `import`/`export` in all files.
- **No transpilation** — code runs directly.
- **Prettier** for formatting (see `.prettierrc`): 100 char width, single quotes, no bracket spacing, no trailing commas, arrow parens "avoid".
- 2-space indentation.
- Semicolons are enforced by Prettier (default `semi: true`).
- The npm package name is `double-meh`.

## Critical rules

- **Zero runtime dependencies.** Never add packages to `dependencies`. Only `devDependencies` are allowed.
- **Do not modify or delete test expectations** without understanding why they changed.
- **Do not add comments or remove comments** unless explicitly asked.
- **Keep `.js` and `.d.ts` files in sync** for all modules under `src/`.

<!-- TODO: Add project-specific critical rules as the codebase develops -->

## Architecture

One pipeline: `verb sugar → prepare → request inspectors → track (run-level GET dedup) → services
onion (cache → retry → mock) → transport → decode → envelope → response inspectors`. The method
declares the return shape (`io.get` → data, `io.full.get` → envelope, `io.stream.*` →
stream/duplex); options tune behavior, never shape. Cache and track are on by default for plain
GETs (opt out per request or via `theDefault`). The default export is one shared configured
instance; `io.create()` makes an isolated one. Details: [ARCHITECTURE.md](./ARCHITECTURE.md) and
[dev-docs/design.md](./dev-docs/design.md).

## Writing tests

```js
import test from 'tape-six';

test('example', async t => {
  // TODO: Replace with actual test pattern once modules are added
  t.ok(true, 'placeholder');
});
```

- Test files use `tape-six`: `.mjs` for runtime tests, `.mts` for TypeScript typing tests.
- Test file naming convention: `test-*.*js` and `test-*.*ts`.
- Tests are configured in `package.json` under the `"tape6"` section.
- Test files should be directly executable: `node tests/test-foo.mjs`.

## Key conventions

- Do not add dependencies unless absolutely necessary — the library is intentionally zero-dependency.
- Wiki documentation lives in the `wiki/` submodule.
- The library supports both CommonJS (`require`) and ESM (`import`) consumers.
