# Architecture

<!-- TODO: Replace with actual architecture description -->

`double-meh` — HTTP I/O. A lightweight, zero-dependency micro-package. It has **zero runtime dependencies** — only dev dependencies for testing and type-checking.

## Project layout

<!-- TODO: Update with actual project structure once modules are added -->

```
package.json              # Package config; "tape6" section configures test discovery
src/                      # Source code
├── index.js              # Main entry point
└── index.d.ts            # TypeScript declarations for the public API
tests/                    # Test files (test-*.mjs, test-*.mts, using tape-six)
dev-docs/                 # Internal developer documentation
wiki/                     # GitHub wiki documentation (git submodule)
.github/                  # CI workflows, Dependabot config
```

## Core concepts

<!-- TODO: Describe the core concepts, data flow, and module interactions -->

## Module dependency graph

<!-- TODO: Add module dependency graph once modules are added -->

```
src/index.js
```

## Testing

- **Framework**: tape-six (`tape6`)
- **Run all**: `npm test` (parallel workers via `tape6 --flags FO`)
- **Run single file**: `node tests/test-<name>.mjs`
- **Run with Bun**: `npm run test:bun`
- **Run with Deno**: `npm run test:deno`
- **Run sequential**: `npm run test:seq` (also `test:seq:bun`, `test:seq:deno`)
- **TypeScript check**: `npm run ts-check`
- **TypeScript tests**: `npm run ts-test` (also `ts-test:bun`, `ts-test:deno`)
- **Lint**: `npm run lint` (Prettier check)
- **Lint fix**: `npm run lint:fix` (Prettier write)

## Import paths

<!-- TODO: Add import path examples once modules are added -->

```js
// Main API
import doubleMeh from 'double-meh';
```
