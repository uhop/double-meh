# double-meh [![NPM version][npm-img]][npm-url]

[npm-img]: https://img.shields.io/npm/v/double-meh.svg
[npm-url]: https://npmjs.org/package/double-meh

`double-meh` is a modern, **fetch-native** HTTP I/O library for **browsers and CLIs** (Node, Bun,
Deno) — a thin, DX-first layer over `fetch()`. Spend the effort on _setup_ (inspectors, services,
defaults) so that _use_ stays trivial: `const person = await io.get(url)`. REST correctness —
conditional writes, idempotency, `problem+json`, content negotiation — is a per-call one-liner, not
a project.

The name is the `://` symbol — Alex Sexton's "walrus", a.k.a. a "double meh".

Why it might be for you:

- **The method declares the return shape.** `io.get(url)` → parsed data; `io.full.get(url)` → the
  full response envelope; `io.stream.get(url)` → a `ReadableStream`. Options tune _behavior_, never
  the return type — no `resolveWithFullResponse`-style flags.
- **One envelope contract.** `{data, status, ok, headers, response}` plus lazily-parsed validators,
  `Link` pagination, `Retry-After`, `Server-Timing` — and a thrown `BadStatus` carries the _same_
  shape, so error handling reads like success handling.
- **Composable services.** In-flight dedup and an app-governed cache (both on by default for GETs),
  verb-safety-aware retry, and a mock service that runs through the real pipeline — your tests need
  no server, and a mocked 503 really gets retried.
- **Web-native streaming, both directions.** Response streams, request streams, and
  `{writable, readable, response}` duplexes that drop straight into a
  [stream-chain](https://github.com/uhop/stream-chain) pipeline — plus parsed record iteration
  (JSONL / `json-seq`) and a reconnecting SSE client on top.
- **Solid.** Zero dependencies, ESM, bundled TypeScript typings, tested across Node, Bun, and Deno.

## Examples

The everyday path — and the envelope when you need metadata:

```js
import io from 'double-meh';

const person = await io.get('https://api.example.com/people/42'); // parsed data

const {data, etag} = await io.full.get('https://api.example.com/people/42');
```

Safe writes — the library lowers intent to the correct headers and refuses unsafe retries:

```js
// conditional update: If-Match from the read above; a lost race is a 412, not a lost write
await io.put('https://api.example.com/people/42', {...data, email}, {ifMatch: etag});

// or the whole read → apply → conditional PUT loop, with 412 → re-read → retry built in
await io.update('https://api.example.com/people/42', person => ({...person, email}));

// effectively-once POST: one Idempotency-Key minted per logical op, reused across retries
await io.post('https://api.example.com/orders', order, {idempotencyKey: true, retry: true});
```

Failures carry the envelope — `problem+json` is already parsed:

```js
try {
  await io.get('https://api.example.com/missing');
} catch (error) {
  if (error instanceof io.BadStatus) console.error(error.status, error.data?.detail);
}
```

Stream a request body up and the response back down through one duplex:

```js
const {writable, readable, response} = io.stream.put('https://api.example.com/bulk', {as: 'jsonl'});
source.pipeTo(writable); // request streams up
const envelope = await response; // status/headers arrive before the body drains
```

## The lay of the land

- **Verbs**: `get`, `head`, `post`, `put`, `patch`, `delete` (+ `del`/`remove`), `options` — on the
  callable `io`, mirrored under `io.full` (envelopes) and `io.stream` (streams/duplexes). A reusable
  options bag makes an [endpoint descriptor](https://github.com/uhop/double-meh/wiki/Core-API)
  shared across verbs.
- **Options** lower intent: `ifMatch`, `ifNoneMatch`, `idempotencyKey`, `accept`, `as`, `decode`,
  `timeout`, `retry`, `cache`, `track`, `bust`, `fields`/`sort`/`expand` query builders — the
  [full reference](https://github.com/uhop/double-meh/wiki/Requests-and-options).
- **Services**: [track](https://github.com/uhop/double-meh/wiki/services-track) (dedup + `adopt`),
  [cache](https://github.com/uhop/double-meh/wiki/services-cache) (TTL, 304 revalidation, pattern
  invalidation), [retry](https://github.com/uhop/double-meh/wiki/services-retry) (incl. polling),
  [mock](https://github.com/uhop/double-meh/wiki/services-mock). Scope defaults per host with
  predicates, or isolate consumers entirely with `io.create()`.
- **Code-forward**: an inline `<head>` prelude fires requests _before_ the library loads; the
  library adopts them seamlessly —
  [Concepts: code-forward](https://github.com/uhop/double-meh/wiki/Concepts%3A-code-forward).
- **Extensible everywhere**: transports, request/response inspectors (URL-scoped), data & MIME
  processors, lifecycle events.

## Install

```bash
npm i double-meh
```

ESM-only. CJS consumers can `require('double-meh')` on Node ≥ 20.19 (`require(esm)`).

## Documentation

The canonical documentation lives in the
**[project wiki](https://github.com/uhop/double-meh/wiki)** — guides, concepts, cookbooks, and the
per-module reference, with
[ranked search](https://uhop.github.io/wiki-search/app/?wiki=uhop/double-meh).

Migrating from `heya/io` / `heya/io-node`? `double-meh` is their fetch-native successor — the
feature parity map is in the repo at
[`dev-docs/heya-io-parity.md`](https://github.com/uhop/double-meh/blob/main/dev-docs/heya-io-parity.md).

## Release history

- 1.0.0 _The initial release._

## License

BSD-3-Clause © [Eugene Lazutkin](https://www.lazutkin.com/)
