# Contributing to double-meh

Thank you for your interest in contributing!

## Getting started

This project uses a git submodule for the wiki. Clone recursively:

```bash
git clone --recursive git@github.com:uhop/double-meh.git
cd double-meh
npm install
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the module map and dependency graph.

## Development workflow

1. Make your changes.
2. Lint: `npm run lint:fix`
3. Test: `npm test`
4. Type-check: `npm run ts-check`

## Code style

- ESM (`import`/`export`) in all files.
- Formatted with Prettier — see `.prettierrc` for settings.
- No unnecessary dependencies — the library has zero runtime dependencies.
- Keep `.js` and `.d.ts` files in sync for all modules under `src/`.

## AI agents

If you are an AI coding agent, see [AGENTS.md](./AGENTS.md) for detailed project conventions, commands, and architecture.
