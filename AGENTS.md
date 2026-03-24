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
- **TypeScript check:** `npm run ts-check`
- **TypeScript tests:** `npm run ts-test` (also `ts-test:bun`, `ts-test:deno`)
- **Lint:** `npm run lint` (Prettier check)
- **Lint fix:** `npm run lint:fix` (Prettier write)

## Project structure

<!-- TODO: Update with actual project structure once modules are added -->

```
double-meh/
├── package.json          # Package config; "tape6" section configures test discovery
├── src/                  # Source code
│   └── index.js          # Main entry point
├── tests/                # Test files (test-*.mjs, test-*.mts)
├── dev-docs/             # Internal developer documentation
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

<!-- TODO: Replace with actual architecture description once modules are added -->

This section will describe the core modules, their relationships, and the data flow.

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
