---
name: write-tests
description: Write or update tape-six tests for a module or feature. Use when asked to write tests, add test coverage, or create typing tests for double-meh.
---

# Write Tests for double-meh

Write or update tests using the tape-six testing library.

## Steps

1. Read `node_modules/tape-six/TESTING.md` for the full tape-six API reference (assertions, hooks, patterns, configuration).
2. Identify the module or feature to test. Read its source code to understand the public API.
3. Check existing tests in `tests/` for double-meh conventions and patterns.
4. Create or update the test file in `tests/`:
   - For runtime tests use `.mjs`, for typing tests use `.mts`.
   - Import the module under test with relative paths: `import doubleMeh from '../src/index.js';`
5. Run the new test file directly to verify: `node tests/test-<name>.mjs`
6. Run the full test suite to check for regressions: `npm test`
   - If debugging, use `npm run test:seq` (runs sequentially, easier to trace issues).
7. Report results and any failures.

## double-meh conventions

- Test file naming: `test-*.*js` and `test-*.*ts` in `tests/`.
- Runtime tests (`.mjs`): ESM imports, `import test from 'tape-six'`.
- TypeScript typing tests (`.mts`): verify type declarations and type-safe API usage. See `tests/test-typings-*.mts`.
- Tests run on Node, Bun, and Deno.
