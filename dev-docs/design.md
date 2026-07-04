# `double-meh` — design

> Status: design consolidation, pre-implementation. This is the living design note for the
> first real release; it captures decisions, scope, and open research items. Usage docs go to
> the wiki once the API lands.

`double-meh` is a modern, fetch-native, ESM HTTP I/O library for browsers **and** CLIs. It is a
thin layer over `fetch()` with great DX: spend the effort on _setup_ (registering inspectors,
encoders, data types, services) so that _use_ stays trivial — `import io; await io.get(url)`.

The name is the symbol `://`, which Alex Sexton coined a name for at TexasJS — a "walrus", or a
"double meh". We borrowed the latter.

## Lineage

It supersedes three of Eugene's older, XHR-era packages and merges their ideas onto one fetch core:

- `heya/io` (1.9.3) — the browser library: core pipeline, services, transports.
- `heya/io-node` (1.3.0) — the Node transport: streaming, transparent compression.
- `heya/bundler` (1.1.4) — the Express endpoint for the bundle protocol.

The article [`web-apps-client-server-api-design-v2`](../../articles/design/web-apps-client-server-api-design-v2.md)
is the design north star. `heya/io` was that paper's _browser_ client (the article cites it for
application-level caching); `dynamodb-toolkit` is the same paper applied _server-side_. `double-meh`
is the article's client, modernized — built to **produce and consume** the request/response shapes
the article describes, ergonomically. `heya/io` predates the v2 article, so much of the new work is
adding the REST-correctness primitives the paper now calls for (conditional writes, idempotency,
cursor pagination, `problem+json`, content negotiation).

## Principles

- **Thin over `fetch()`.** No XHR emulation. Wrap the real `Response`; never fabricate one.
- **DX-first / intentional programming.** A method's _return shape_ is fixed by the method, never
  by an option. Options tune _behavior_, not _shape_.
- **REST-aware both ways.** Every request the article describes is a one-liner: the library lowers a
  _semantic intent_ (`ifMatch`, `idempotencyKey`, `fields`, `as`) down to the correct header/query.
  Every response shape (paged envelope, `problem+json`, validators) is read back ergonomically.
- **Compose, don't silo.** Retry / conditional writes / idempotency are one safety story; cache /
  events / inspectors / compression are cross-cutting seams; verbs + `.full` + option-lowering are
  the skin. Everything threads through one request pipeline.
- **Earliest-possible I/O ("code-forward").** Let a page fire requests and apply config _before_ the
  library and app code finish loading, then adopt them seamlessly. The network shouldn't wait on
  script download → parse → execute.
- **Extensible everywhere.** Pluggable transports, services, request/response inspectors, data &
  MIME processors, compression encoders.
- **Zero runtime dependencies. ESM. Fleet standards.**

## Dropped from `heya/io`

| Dropped                                                                                                                                         | Why                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| XHR transport + `FauxXHR` + all XHR-isms (`responseType`, `overrideMimeType`, `withCredentials` shim, `user`/`password`, header-string parsing) | `Response` provides `.json/.text/.blob/.body` and real `Headers`; the emulation layer collapses. |
| `jsonp` transport                                                                                                                               | Obsolete.                                                                                        |
| `load` (`<script>`) transport                                                                                                                   | Too exotic now.                                                                                  |
| `heya-async` / swappable `io.Deferred` / `AbortRequest`                                                                                         | Native `Promise` + `AbortController` everywhere.                                                 |
| Node `http`/`https` transport                                                                                                                   | `fetch()` is universal; one transport.                                                           |

`del` / `remove` aliases for DELETE are **kept** — `delete` is no longer a language hazard, but some
prefer naked verbs. (Note: `delete` works as a method/property and a verb in `io.full`, but cannot be
a bare named ESM export — `import {delete}` is a syntax error — so the named export for it is `del`
or `remove`.)

## Core API & return model

Verbs: `get`, `head`, `post`, `put`, `patch`, `delete` (+ `del`/`remove`), `options`. Available as
named ESM exports and on the default `io` object. Exotic verbs via a `makeVerb`-style helper.

**Signature: `verb(url, data?, options?)`.** `url` is required (a string, a `URL`, or an options bag);
`data` is the frequent optional (the query for reads, the body for writes); `options` is the rarely-used
override bag (`stream`, `ifMatch`, `accept`, `signal`, `cache`, …) — typed to **exclude `url`**, and the
`url` always comes from the 1st arg. Supply only options with `io.get(url, null, {stream: true})`, or as
one bag: `io.get({url, stream: true})`. So behavior flags never collide with the query.

**`data` empties differ by direction.** For **reads**, `null` _or_ `undefined` → no query. For
**writes**, `undefined` → no body, but **`null` is a valid body** (sent as JSON `null`). (`PATCH` with
`null` is passed through the same way — whether a top-level-`null` merge-patch is meaningful is the
server's call, not ours.) Args are combined with a small `deepMerge` (endpoint ← overrides), so nested
`headers`/`query` merge per-key while `url` is pinned to the 1st arg.

**One shared instance by default; isolation on demand.** The default export is one configured
instance — apps configure it once (inspectors, defaults) and every module shares it. For genuine
isolation (a CLI/server process hosting several independent consumers), `io.create()` returns a
fully-equipped independent instance (own registries, services, cache), and `createIO()` (from
`io.js`) returns a bare pipeline with no transport/services for minimal builds. Per-host
configuration on the shared instance does **not** need instances: inspectors take an optional
scope — `io.inspect.request(fn, match)` where `match` is a URL prefix string, a RegExp, or a
predicate — so an SDK registers its `Authorization` inspector scoped to its own host, and
per-service defaults (`theDefault`, below) accept predicates for the same purpose.

**`io` is the low-level callable; the verbs are sugar.** `io(options)` ≡ `io({...options, method:
'GET'})`-style dispatch (returns `data`), and `io.full(options)` returns the envelope —
`io.get(x)` is just `io({...x-as-options, method: 'GET'})`. This makes a **reusable endpoint descriptor**
natural: `const endpoint = {url, headers, ...}` reused across verbs with their own data —
`io.get(endpoint, query)`, `io.put(endpoint, body)`, `io.patch(endpoint, delta)`. The descriptor is
spread (never mutated), so one object defines an I/O op that several verbs share. The **3rd arg
overrides** that descriptor per call: scalar flags (`cache`, `signal`, `timeout`, `accept`, …)
shallow-override, `headers`/`query` merge **per-key** (override an individual header, keep the
endpoint's `Authorization`), and `url` stays from the 1st arg — `io.get(endpoint, q, {cache: false})`,
`io.get(endpoint, q, {headers: {'X-Trace': id}})`.

**Return rule** — every verb returns what that verb is _about_:

- `io.get(url)` → the parsed body (`data`). The 99% path: `const person = await io.get(url)`.
- `io.post/put/patch/delete(...)` → the parsed body too (the created/updated representation, or
  `undefined` when there is none).
- `io.head(url)` / `io.options(url)` → their _derived metadata_ (validators / a capabilities object),
  because they carry no body.
- `io.full.verb(...)` → the full **envelope** (below), for any verb.

The bare verb is exactly the envelope's `.data`: **`io.get(url)` ≡ `(await io.full.get(url)).data`** —
one source of truth.

`io.full` is a namespace so the envelope variants destructure by name: `const {get, post} = io.full`.
It leaves room for sibling modifier-namespaces later (e.g. `io.stream`).

**Options tune behavior, never shape.** `withEtag`, `stream`, `ifMatch`, `as`, `retries`, `cache`,
`signal`, `timeout`, `fields`, `sort`… change _what a call does_, not _what type comes back_. (This is
why a `{withEtag}` flag belongs on `io.full.get` — the type is already the envelope; the flag only
adds work — and never on bare `io.get`, where it would flip the return type.)

## The response envelope

The single response contract — returned by every `io.full.*` call **and** carried by a thrown
`BadStatus` (so a non-2xx failure reads the same way as a success). Transport failures
(`FailedIO` / `TimedOut`) are the exception: no HTTP response arrived, so they carry only `.response`
(possibly `undefined`) and `.options`, not the envelope.

**Error taxonomy.** `IOError` is the neutral base (one `instanceof` catches everything the library
throws); `FailedIO` (transport/network failure, subclass `TimedOut`) and `BadStatus` are siblings
under it — a 404 is a _successful_ I/O, so it is not a `FailedIO`. Every wrap preserves the
original error on `.cause` (undici's syscall detail, the `SyntaxError` of a malformed JSON body).
**Aborts are never wrapped and never retried** — a user abort surfaces as the platform's
`AbortError` as-is; `options.timeout` (via `AbortSignal.timeout`, composed with the user's signal
through `AbortSignal.any`) surfaces as `TimedOut`.

```js
const envelope = {
  // eager core (always present, cheap)
  data, // parsed body (JSON fast-path / mimeProcessor / a stream if {stream:true}); undefined if none
  status, // 200, 204, 404 …
  ok, // status in 200–299
  headers, // parsed, case-insensitive dict (set-cookie → array); response.headers holds the raw Headers
  response, // the raw fetch Response — escape hatch (.body stream, .url, .redirected, .type)

  // well-known, lazy getters (parsed on access; free if untouched)
  etag, // ETag, as received (quotes/`W/` included, so it echoes back verbatim) → conditional writes
  weak, // is `etag` a weak validator? (If-Match needs strong; the ifMatch lowering warns on weak)
  lastModified, // Last-Modified → conditional GET / caching
  location, // Location (resolved absolute) → create / 202 status-resource / redirect
  links, // Link (RFC 8288) → {next, prev, first, last} → header-based pagination
  contentType, // parsed media type + charset/params
  retryAfter, // Retry-After → seconds or Date
  serverTiming // parsed [{name, dur, desc}] — observability; best-effort in browser (see note)
};
```

**Selection rule for the hoisted set:** a value gets a top-level slot iff (a) an article client-pattern
needs it (conditional writes, paging, create, rate-limiting, negotiation) **and** (b) it benefits from
_parsing_, not just raw passthrough. Everything else stays on `headers[...]` / `response`
(`cache-control`, `vary`, `content-length` are read internally by the cache, not hoisted).

**Lazy getters** reconcile "rich" with "cheap": destructuring `const {data, etag} = env` parses only
`etag`; `links`/`retryAfter` cost nothing untouched. The shape is still fixed (all keys present).

**A failed-status error _is_ the envelope.** A thrown `BadStatus` carries `status`, `headers`,
`response`, `etag`, and `data` = the parsed `problem+json` — so `catch (e) { e.status; e.data.detail }`
works identically to a success envelope. Transport failures (`FailedIO` / `TimedOut`) have no response
to model, so guard with `instanceof io.BadStatus` before reading envelope fields. This is the
article's "one-place error handling" landing as a shape.

**`serverTiming` caveats:** it is the lone observability (not control-flow) member. The browser
surfaces `Server-Timing` mainly via `PerformanceServerTiming`, and the raw header is often not
JS-readable cross-origin — so the accessor is reliable in Node/CLI and best-effort in the browser (the
browser build may fall back to the Performance API).

## Request ergonomics — producing the article's requests

The bar is "trivial," with the library lowering intent to the right header/query.

**Conditional writes / ETag** (capture on read, thread into the next write):

```js
const {data, etag} = await io.full.get('/users/42');
await io.put('/users/42', next, {ifMatch: etag}); // → If-Match
await io.put('/orders/{uuid}', body, {ifNoneMatch: '*'}); // create-if-absent (412 if it exists)

// or the whole read-modify-write loop, with 412 → re-read → re-apply → retry:
await io.update('/users/42', cur => ({...cur, dob}));
```

`withEtag` on `io.full.get` is the _generate-when-absent_ half: if the server sent no validator,
compute a strong one by hashing the body (opt-in, because hashing isn't free).

**Idempotency:** `{idempotencyKey: true}` mints a UUID once per logical op and reuses it across retries.

**Content negotiation & PATCH formats** (semantic, not stringly):

```js
io.full.get('/export', {accept: 'application/json-seq'}); // → Accept
io.patch('/users/42', delta, {as: 'merge-patch'}); // → Content-Type: application/merge-patch+json
io.patch('/users/42', ops, {as: 'json-patch'}); // → application/json-patch+json
```

**Query builders** (no hand-concatenation):

```js
io.get('/products', {
  query: {category: 'audio', maxPrice: 200}, // app-specific filter
  fields: ['name', 'price', 'rating'], // → ?fields=name,price,rating
  sort: ['-rating', 'price'], // → ?sort=-rating,price
  expand: ['brand'], // → ?expand=brand
  page: {offset: 40, limit: 20} // → ?offset=40&limit=20  (or {cursor})
});

io.getByIds('/products', ['ap-31', 'ap-77']); // GET ?ids=… , auto POST-body fallback when the URL overflows
```

`makeQuery` learns comma-joined arrays for `fields`/`sort`/`expand`/`ids` (still repeated-key for plain
multi-value). `url\`\`` tagged template for sanitized interpolation stays.

## Response handling — consuming the article's shapes

- **JSON fast path** — plain object out → `JSON.stringify` + `application/json`; `application/json`
  in → parsed. 204 / HEAD / OPTIONS → `undefined`. Well-known types (`FormData`, `Blob`,
  `URLSearchParams`, `ArrayBuffer`, typed arrays, `ReadableStream`) pass through; `Form` and friends
  encode with the right MIME.
- **`problem+json` normalization** — RFC 9457 → the error's `data`. Centralized error display becomes
  a response inspector, not per-call handling.
- **Pagination iteration** — `for await (const row of io.paginate('/products', {...}))` follows
  `links.next` / the opaque `cursor` and stops on absence. Encodes "page by `items.length`, never by
  your requested limit."
- **Record streaming (decode side) — `io.records`** _(built 2026-07-03)_.
  `io.records.get/post(url, data?, options?)` → a lazy async iterable of **parsed records**; the
  request fires on first iteration. Framing is negotiated from the response content type — JSONL /
  NDJSON by default, **RFC 7464 `application/json-seq`** when the type says so — and forceable via
  `{framing}`. The default `Accept` advertises both. Errors are first-class: a non-2xx **reads the
  streamed error body** and throws a `BadStatus` with parsed data (never an unread stream), a
  malformed record throws `FailedIO` with the `SyntaxError` on `.cause`, breaking out of the loop
  cancels the response stream, and aborts surface even when a transport ignores the signal (the
  reader races the signal).
  **Build-vs-adopt split with `stream-chain`:** double-meh owns the _protocol/consume_ layer (this
  simple iteration, content-type negotiation, json-seq, parsed errors — zero-dep); record
  _processing_ and the _encode/upload_ side are delegated to `stream-chain` — pipe
  `io.stream.get(...)` through `parserWebStream()` for transform pipelines, terminate a
  `stringerWebStream()` pipe into `io.stream.put` for uploads. No JSONL stringer or record
  pipeline machinery is duplicated here.

## The safety story — retry × conditional × idempotency

These are one story, not three services. Retry is **verb-aware** (a safety _upgrade_ over `heya/io`,
which would re-fire a bare POST).

**One option:** `retry: true | n | {retries, initDelay, force, nextDelay, continueRetries}` —
`true` uses `io.retry` defaults, a number caps the retries, the bag tunes everything per request.
`retries: 0` with a `continueRetries(response, attempt, options)` predicate is the **polling mode**
(iterate until the predicate declines, e.g. `response.status === 202`). `force: true` is the
explicit override of the verb-safety gate below. `Retry-After` is honored but clamped to
`io.retry.maxDelay`; **an abort is never retried** and a streamed request body stands retry down.

**Two retry modes:**

- **Transient-failure retry** — re-send the _same_ request on network error / timeout / 5xx / 429;
  honor `Retry-After`. Safe iff the request is idempotent.
- **Conflict retry (412)** — a conditional `PUT`/`PATCH` that loses optimistic concurrency is _not_
  re-sent verbatim; it is re-read → re-apply → resubmit with the fresh ETag. (This _is_ `update()`.)

**Per-request safety gate:**

| Verb                 | Auto-retry?                                                                             |
| -------------------- | --------------------------------------------------------------------------------------- |
| GET / HEAD / OPTIONS | always (safe)                                                                           |
| PUT / DELETE         | yes (idempotent); a 404 on a retried DELETE → success                                   |
| PATCH                | yes _if_ `If-Match` (or a stable merge body)                                            |
| POST                 | only with `Idempotency-Key` (effectively-once) or `If-None-Match: *` (create-if-absent) |
| non-idempotent POST  | no — explicit opt-in required                                                           |

The article's **resumable bulk** (cursor-driven `202` + status-resource) is the same machinery: retry
per chunk, each unit idempotent, the cursor as the resume point.

## Request identity — `makeKey`

Cache hits, `track` dedup, and code-forward adoption all hinge on two requests computing the **same
key** — so the key must be **canonical**, which `heya/io`'s was not (it concatenated `method + buildUrl`
with query params in object-insertion order, no sorting, raw-appending any `?…` already on the URL). So
`io.get('/x', {a: 1, b: 2})` and a prelude's `fetch('/x?b=2&a=1')` would miss each other.

Formal key: `METHOD` (upper) + a canonical URL, normalized via the WHATWG `URL`:

- lowercase scheme + host, strip the default port, resolve `.`/`..`, normalize percent-encoding;
- **sort query params by name** (stable — same-name value order preserved, so comma-joined
  `fields`/`sort`/`ids` keep their order); merge any `?…` already on the URL with the
  `query`/`data`-derived params before sorting;
- **drop the fragment** (never sent).

Computed on the **post-inspector** URL, so a virtual-host/rewrite inspector and a prelude that fired the
already-final URL still match (the code-forward seam). Key only — the **wire URL is sent as built**, so
signed URLs (SigV4 query, presigned links) aren't reordered. The **cache** extends the base key with a
`Vary` dimension (the request-header values the response's `Vary` names); `track`/`adopt` use the base
key. `io.makeKey(options)` is exposed so callers can compute it themselves.

## Services (priority middleware)

Each is attachable/detachable. Most are **`Response`-level middleware** in a priority onion
(`handle(request, ctx, next)`); **`track` is the exception** — a run-level dedup that shares the decoded
**envelope** (see below).

**Opt-in protocol (the `heya/io` scaffold, carried over).** Per request, the service's own option
wins when present (`cache: false`, `track: true`, `mock: false`); otherwise the service consults its
`theDefault` — a boolean **or a predicate over the options** (`io.cache.theDefault = o =>
o.url.startsWith('https://api.mine/')`). The shipped default for cache and track is "plain GETs on
the default transport are **in**" — so **caching and dedup are on by default for GETs**, and
`cache: false` / `track: false` opt a request out. Two hard gates sit above the protocol: `stream`
requests are never cached/deduped (single-consumer), and track/cache are **GET-only regardless of
the flag** — sharing one decoded envelope or a stored body is only sound for safe reads, so
`track: true` on a POST does not dedup.

| Service                      | Disposition                  |
| ---------------------------- | ---------------------------- |
| **cache**                    | modernize — see below        |
| **track** (dedupe in-flight) | run-level — see below        |
| **mock** (test/proto)        | port                         |
| **bust** (cache-buster)      | port (or fold into cache)    |
| **retry**                    | enhance per the safety story |
| **bundle** (client)          | in this repo; see below      |

### track

`track` is **not** a `Response`-level service in the onion. It dedups at the **run level**, sharing the
decoded **envelope** — so the body is decoded **once** and every concurrent caller gets the same `.data`.
(The earlier `Response.clone()` approach shared the bytes but re-parsed per caller, defeating the point;
`heya/io` shared the decoded result for the same reason.) It is **GET-only and skips `stream: true`** — a
stream is single-consumer, so it can't be handed to two readers (matching the original "streams aren't
deduped" behavior). On by default; `io.track.detach()` turns it off. `io.adopt` / `fly` / `arrived` build
on its deferreds, which resolve to envelopes via `io.toEnvelope`.

### cache

The platform caught up, so the _storage_ is now the platform's and the _value-add_ is the control glue.

- **Backends behind one storage interface** (`get/set/delete/clear/keys`, sync or async), chosen per
  platform; the TTL / lazy-expiry / revalidation / invalidation / sweep logic above is
  backend-agnostic. **Shipped in `src/storage/`:** memory (default), filesystem, SQLite, Cache API
  — entry files are a JSON meta line + raw body bytes, written temp+rename for multi-process
  atomicity; `expiresAt: Infinity` maps to JSON `null`. IndexedDB / `Storage` remain possible
  additions.
  - _Browser:_ Cache API (the main/default), IndexedDB, `Storage` (local/session).
  - _CLI (Node/Bun/Deno):_ **in-memory** Map/LRU is the **default** — zero-dep, and the right fit for a
    long-running service (a browser-tab analogue) and intra-run dedup. Persistence is opt-in: a
    **filesystem** backend in the **OS cache dir** (`$XDG_CACHE_HOME`/`~/.cache`, macOS
    `~/Library/Caches`, Windows `%LOCALAPPDATA%`, app-namespaced — _not_ bare `os.tmpdir()`, which is for
    ephemeral only), one hashed-`makeKey` entry per file, written atomically (temp + rename) for
    multi-process safety; `node:fs`, so zero-dep across all three runtimes. **SQLite** is an optional,
    feature-detected backend (many small entries / concurrent writers / atomicity) — zero-dep _only_
    where the runtime ships it built-in (`node:sqlite` ≥ Node 22.5 experimental, `bun:sqlite`); Deno has
    no builtin, so it would need a dependency and stays off the zero-dep path. SQLite is a fast-follow,
    not a v1 blocker.
- **Time policy is app-governed (this is not an HTTP cache).** GETs are cached **by default** once
  the service is attached (`cache: false` opts a request out; `io.cache.theDefault` narrows the
  default set); `cache: {ttl}` overrides a configurable `io.cache.defaultTtl` per request. `ttl: Infinity` keeps
  `heya/io`'s "cache until explicitly invalidated" mode; a finite default is a safety net against
  _forgotten_ invalidation (the article's toxic-stale warning). `defaultTtl` is finite, value TBD —
  ~5 min as a working placeholder. Server `Cache-Control`/`Expires` may _seed_ a default at most — the
  app's `ttl` governs.
- **Expiry is timestamp-based (lazy); the sweeper is app-driven.** Store `expiresAt`; check it on read —
  this survives reloads and dodges `setTimeout` throttling/loss, and is the correctness mechanism on its
  own. `io.cache.sweep()` (reclaim expired entries) is exposed as a **function the app calls** — on its
  own timer, on `visibilitychange`, on route change — the library never schedules a timer itself. It is
  pure housekeeping, not correctness.
- **On expiry, revalidate — don't just drop.** Store `ETag`/`Last-Modified` beside the body; an expired
  entry _with_ a validator does a conditional `If-None-Match`/`If-Modified-Since` → **304** reuse + bump
  `expiresAt` + **merge the 304's headers into the stored entry** (RFC 9111 §3.2, sans
  `Content-Length`), **200** replace; expired _without_ a validator → miss/refetch; an explicit
  `remove`/prefix-evict deletes now. Key by `Vary`. A `bust: true|'key'` request appends a
  uniquifying query param (defeats intermediary caches) and is itself never stored. (Cache API stores `Response`s, so this metadata
  rides as synthetic headers on the stored response.)
- **App-level invalidation glue (the real value):** prefix eviction (`/users/*`), dropping derived
  values (a list's cached total), on-demand invalidation — the recall an HTTP cache never offers.
- **Freshness on reload (recipe, not code):** users who spot stale data (vs a coworker) refresh
  expecting fresh data, so a full reload should be able to clear/bypass the app cache. We ship
  per-backend snippets rather than build it in — `Storage.clear()` / drop `io-*` keys; `caches.delete()`;
  delete the IndexedDB store — optionally gated on a real reload via the Navigation Timing API. Prefix
  eviction scopes it (clear `/users/*`, not everything).
- **Service Worker:** see the Service-Worker section below.

### bundle (client)

The pre-HTTP/2 idea: batch same-host GETs in a debounced window, server fans out + compresses together,
client unbundles transparently (realistic gain historically ~10–20%, more for many small bodies). The
client transport ships **here**; the example server endpoint is a **separate repo**. We will benchmark
it against HTTP/2 multiplexing; worst case we keep it but do not promote it. Not much code.

Three motivations drove it, and benchmarking sorted out which mattered. (1) The **per-host concurrent
connection cap** of HTTP/1.1 — brutal on old IE (~4), looser elsewhere (~6–8) — serialized bursts of
small requests. (2) **Connection setup overhead** per request. (3) **Better compression** of many small
bodies batched into one. Measurement showed the wins came from **(2) + (3)**, not the connection cap
(browsers with a higher cap still benefited). HTTP/2 multiplexing nullifies (1) outright and dents (2) —
which is exactly why the promote-or-not call is benchmark-gated against it.

## Transports

`fetch()` is _the_ core transport and default; `jsonp`/`load` are gone. The pluggable registry stays
(selected by `options.transport`) for `mock`, the `bundler`, and custom transports.

**Contract — prepared request in, `Response` out:**

```js
// transport(request, ctx) => Promise<Response>
//   request: { url, method, headers, body, signal }  — final (post-inspector, body encoded)
//   ctx:     { options, key }                         — original intent (bundler/mock need it)
const fetchTransport = (request, ctx) => fetch(request.url, request);
```

The transport is deliberately thin: bytes out, `Response` in. The core does the rest **once** —
envelope-wrap, JSON fast-path, error-throw, services — so no transport reimplements it. Crucially,
**`new Response(body, {status, headers})` replaces `FauxXHR`**: mock, bundler, and cache-hit transports
mint a _real_ `Response`, so there is no fake-XHR shim anywhere. SSE is _not_ a transport (see below) —
it rides the fetch transport.

## Inspectors / hooks

First-class, ordered request- and response-inspector registries — replacing `heya/io`'s AOP
monkeypatching of `processOptions`/`processSuccess`/`processFailure`.

- **Request inspectors:** URL transform (virtual `$api` hosts), header injection (`Authorization` from
  `cognito-toolkit`), default `Accept`, `Idempotency-Key` minting.
- **Response inspectors:** `problem+json` normalization, lifting `ETag` into the result and the cache.

The `ifMatch`/`idempotencyKey`/`as` options are sugar the inspector layer applies; raw `headers`/`query`
remain the escape hatch.

## Events

A first-class, lightweight lifecycle emitter built into the core (`io.on/off/emit`). Wired events:
`request` (a network run starts), `success` (envelope produced), `failure` (any throw), `retry`
(per retry attempt, from the retry service), `ready` (code-forward drain complete); `io.inFlight`
counts active network runs. The activity indicator / warn-before-unload pattern becomes a 3-line
subscriber instead of an ad-hoc counter wired through inspectors. A cache hit still runs the
pipeline, so it emits `request`/`success` — a `non-network` flag on the event payload is a
possible refinement, not yet wired.

## Code-forward (early init & request hoisting)

A page-load latency technique: move the network — and config — to the very top of the page, before the
library and app code finish loading, then hand the in-flight/completed work to the library seamlessly.
Motivating case: a dashboard batched several endpoints, but the batch fired _late_ (after the lib
loaded, after app code loaded and ran). Hoisting the requests to an inline `<head>` script started data
acquisition immediately, overlapping it with script download/parse/execute — faster, no app rewrite.
(`heya/io` did this; the worked example is its bundle cookbook's "Pre-fetching" section, and the
standalone primitive was `track.fly` — "register an I/O already in progress started outside of `io`".)

Two channels, both via a well-known global the library drains on load:

- **Setup** — config that must apply before the lib processes _anything_ (register inspectors:
  `Authorization` injection, URL transforms; set defaults), so the library never runs uninitialized.
  Drained **first**.
- **Prefetch** — requests fired _now_ (the inline script calls `fetch()` itself, since only an actually
  issued request hoists the network), stashed for **adoption**. On load the library registers each in
  `track` as in-flight and, on settle, stores the result in `cache` — keyed by the same
  `makeKey(method, url)` the app uses. So later app code calling `io.get('/me')` transparently adopts
  the pending promise or the cached body. The handover is seamless and the app code is unchanged.

Primitives: **`fly(target)`** registers a request as in-flight (a `track` deferred, so app code waits
instead of refetching) and returns the normalized key; **`arrived(target, response)`** delivers a
response for that `target` (resolves the deferred so waiters adopt it, and — once `cache` is attached —
stores it durably). `io.adopt(options, promise)` is the promise-based sugar — `fly(options)` then
`promise.then(r => arrived(options, r))`. A batch hoist delivers via `bundle.unbundle`. A separate
`ready` lifecycle **event** fires when the load-time drain completes. (`arrived` is dual-purpose: a queue
**array** pre-load, the delivery **function** post-load — the prelude tells them apart by `typeof`.)

```html
<head>
  <title>…</title>
  <script>
    // code-forward prelude — fire the network now; hand off whenever the library is ready
    window.__doubleMeh = window.__doubleMeh || {};
    const dm = window.__doubleMeh;
    const configure = io => io.inspect.request(injectAuth);
    if (dm.use) dm.use(configure);
    else (dm.setup = dm.setup || []).push(configure);
    for (const url of ['/me', '/menu', '/clients']) {
      // mark in-flight so app code adopts instead of refetching
      if (dm.fly) dm.fly(url);
      else (dm.inFlight = dm.inFlight || []).push(url);
      // deliver the response whenever it lands — before OR after the library loads
      fetch(url).then(response => {
        if (typeof dm.arrived === 'function') dm.arrived(url, response);
        else (dm.arrived = dm.arrived || []).push([url, response]);
      });
    }
  </script>
  <script type="module" src="app.js"></script>
</head>
```

```js
// double-meh, on load — drain the pre-load queues, then STAY LIVE for later deliveries
const dm = (globalThis.__doubleMeh = globalThis.__doubleMeh || {});
const fly = target => {
  io.track.fly(target);
  return io.makeKey(typeof target === 'string' ? {url: target} : target); // returns the key
};
const arrived = (target, response) => io.adopt(target, response); // resolve waiters (+ cache once attached)
const pending = Array.isArray(dm.arrived) ? dm.arrived : [];
dm.setup?.forEach(fn => fn(io)); // config first
dm.inFlight?.forEach(fly); // register the still-pending ones
pending.forEach(([target, response]) => arrived(target, response)); // deliver the ones that already landed
delete dm.setup;
delete dm.inFlight;
dm.use = fn => fn(io);
dm.fly = fly;
dm.arrived = arrived; // array → function: a response arriving post-drain now has a home
io.emit('ready');
```

**The global is a protocol marker, not the library.** `__doubleMeh` carries only the transfer
protocol — the queue arrays pre-load, the three functions (`use`, `fly`, `arrived`) post-load. It
is deliberately **not** upgraded into the `io` object (no `Object.assign(dm, io)`): a copied
handle diverges from the live instance the moment `io` is reconfigured, and inline scripts that
want the API can get it through `dm.use(io => …)`.

**Why dual-mode (order-independent), not a one-shot drain.** Responses land at arbitrary times — the 2nd
can arrive _after_ the library has drained — and, defensively, the library could initialize _before_ the
prelude runs (we haven't seen every future browser). So **every operation checks "is the live function
there? call it : queue it,"** in _both_ directions: registration (`fly` vs `inFlight`) and delivery
(delivery: the `arrived` function vs the `arrived` queue array). On load the library drains the queues
**and leaves `fly`/`arrived`/`use` installed**, so a response arriving post-drain calls `arrived`
directly instead of dropping into a queue nobody re-reads. This generalizes the `heya/io` bundle-cookbook pre-fetch pattern (it stashed
`__io_initial_options` to fly + `__io_initial_bundle` for arrived data, with an
`if (loaded) unbundle() else store` check). The single `__doubleMeh` is thus a command-queue pre-load
and the three-function protocol surface post-load (see "protocol marker" above).

**Build-vs-adopt note.** For a plain GET, the platform now hoists the _network_ on its own — a
`<link rel="preload" as="fetch">` or a 103 Early-Hints preload warms the HTTP cache, and a later
same-URL `fetch()` reuses it. Where that suffices, lean on it rather than reimplement the commodity.
Code-forward's distinct value is the **app layer**: adopting into `track`/`cache` so app code gets
_parsed_ data with dedup (not just a warm HTTP cache), carrying `Authorization` and other inspector
concerns a `<link>` can't, **batching** N endpoints into one hoisted request, and the config-forward
half. They cooperate only for **simple public GETs**: a `rel=preload` (or 103 Early-Hints) preload
takes no custom request headers, is GET-only with no body, and controls credentials only coarsely via
`crossorigin` — and the later `fetch()` must match its URL + mode or the browser double-fetches (the
"preloaded but not used" warning). The moment a request needs `Authorization`, a custom `Accept`, a
non-GET method, or a body, the only full-fidelity hoist is an inline `fetch()` — i.e. the standalone
code-forward path.

## Service Worker & cross-tab coherence

So far the posture is **compatibility + a defined contract**, not a bundled SW. A Service Worker is
shared across every tab of an origin and can intercept `fetch`, so it unlocks what the per-tab in-page
cache can't:

- **Cross-tab cache coherence** — invalidate `/users/42` in one tab and evict it in all of them. A SW
  (or, with no SW, a `BroadcastChannel('io')`) propagates the invalidation; each tab drops its in-page
  mirror. This is the direct fix for the coworker-comparison/refresh complaint.
- **Network-layer cache** — the SW can own the Cache API tier (already a cache backend), so the cache
  survives navigations and is shared across tabs.
- **Offline + background-sync writes** — queue failed writes, replay when back online. Clean synergy
  with the safety story: an `Idempotency-Key` makes that replay safe by construction.
- **Push-driven invalidation** — the article's push channel: the SW receives a server push (or SSE) and
  broadcasts "evict X" to all clients, decoupling invalidation from the freshness clock.

**Defined here (main repo):** a small **message contract** the page ↔ SW speak (`io:invalidate
{key|pattern}`, `io:invalidated …`, `io:adopt …`) plus a cache-backend hook so `io.cache` can post and
receive it. **Shipped elsewhere:** the **reference SW** itself (separate repo/example), because scope,
routes, and offline policy are app-specific. The main project must work with **no SW**, with a
`BroadcastChannel` for cross-tab only, or with a full SW — same cache API either way.

## Streaming & compression (CLI / Node)

- **`io.stream` write verbs** — the Duplex source/sink (`io.stream.put/post/patch` → `{writable,
readable, response}`), rebuilt on fetch/undici streams (`duplex:'half'`). Pipe a request body in,
  pipe a response body out; `io.stream.get` is the read-side sibling (`Promise<ReadableStream>`).
  One namespace, per-verb shapes — "the method declares the return shape" already licenses that.
- **Pipeline** — `decompress → reframe (JSONL/json-seq) → parse` inbound; `encode → send` outbound.
- **Encoders** — pluggable, feature-detected registry: gzip, deflate, br, and **zstd** (where the
  runtime has it). CLI-only; the browser owns `Accept-Encoding` and we don't infringe.

## Cancellation & progress

- **Cancellation** — native `AbortSignal` passthrough (no shim).
- **Download progress** — opt-in, via a `Response.body` reader. Simple code; **in v1**.
- **Upload progress** — `fetch` has none natively. Possible approach to **research**: a stream-oriented
  upload that inserts a technical pass-through stream into the body pipe purely to report bytes. Later.

## SSE

**Built 2026-07-03, and not a transport.** Server-Sent Events ride the fetch transport — SSE is a
small layer over fetch + streaming, exactly as anticipated. The name is **`io.sse(url, data?,
options?)`** (the design floated `io.events` / `io.sse`; `events` was taken by the core lifecycle
emitter `io.on/off/emit`, so `sse` won to avoid two unrelated "events" concepts on one object).
Semantics, EventSource-compatible where it matters:

- an async-iterable of `{data, event, id}` frames — full parser (`data:` multiline join, `event:`,
  `id:` incl. the NUL guard, `retry:`, `:` comments/keep-alives, `\r\n|\n|\r` line endings);
- a **reconnect loop**: a dropped stream reconnects after `reconnect` ms (default
  `io.sse.reconnectDelay` = 3000, server `retry:` hint overrides) carrying `Last-Event-ID` (seed a
  resume with `{lastEventId}`); `reconnect: false` for one-shot reads; **204 ends the
  subscription** (per spec); a non-2xx is fatal and throws `BadStatus` with the **parsed** error
  body; a wrong content type is fatal; an abort passes through and never reconnects.
- Because each reconnect re-runs the full pipeline, request inspectors re-fire — fresh
  `Authorization` per reconnect, the very thing native `EventSource` (GET-only, no custom headers)
  can't do. The article's push channel for cache-invalidation is then a consumer of `io.sse`.

## Out of scope (the server's job)

`double-meh` only _consumes/produces_ these wire shapes; it does not implement them: pagination /
filtering / sorting / subsetting / expansion logic, hashids, rate-limit enforcement, idempotency
storage, `Server-Timing` generation, CORS policy, security, DB choice. Its role here is query-encoding
helpers and reading the envelopes back.

## Scope

| Tier                           | Items                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v1 (this repo)**             | fetch transport; verbs + `io.full` + the envelope; JSON fast path; data/MIME processors; request ergonomics (conditional, idempotency, query builders, `as`, `accept`); safety-aware retry; `problem+json`; inspectors; events; cache (browser: Cache API + IndexedDB + Storage; CLI: in-memory default + filesystem; app-governed TTL, 304 revalidation, invalidation glue); track; mock; bust; `url`; download progress; pagination iteration; bundle client; compression encoders (CLI); JSONL/json-seq record iteration (`io.records`, decode side; processing/encode delegated to `stream-chain`); `io.stream` duplexes; code-forward (early-init + request adoption); canonical `makeKey`; SW invalidation message-contract + cross-tab (BroadcastChannel); SSE (`io.sse`, rides fetch+streaming) |
| **Spike to size, then decide** | — (SSE resolved → v1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Research / later**           | upload progress (stream-insertion); offline + background-sync writes (SW)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Separate repos**             | bundle _server_ example; reference Service Worker; possibly SSE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Benchmark-gated**            | bundle promotion (vs HTTP/2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

REST-awareness target: as much as we can, **in layers**, modulo not bloating the codebase — kept in this
repo unless a piece proves large.

## Open research items

- Upload-progress via inserted technical stream.
- Reference Service Worker (separate repo) + offline/background-sync writes; main repo defines only the
  message contract.
- Bundle vs HTTP/2 benchmark (promote-or-not).

## Packaging / fleet standards

ESM throughout; zero runtime dependencies; Prettier (100 width, single quotes, no bracket spacing, no
trailing commas, arrow-parens avoid); `tape-six` across node/bun/deno + TS typing tests; naked version
tags (no `v` prefix); BSD-3-Clause. **ESM-only, decided:** no CJS build — `require(esm)` covers CJS
consumers, backed by the declared `engines.node >= 20.19` floor and the standing invariant that the
module graph carries **no top-level await** (a sync `require` path must stay sync).

### Bundlers

ESM is universal here: it loads directly in browsers (`<script type=module>`) **and** is what every
modern bundler natively consumes (Vite/Rollup, esbuild, webpack, Parcel, Bun). UMD is legacy — bundlers
don't need it; it's only for a CDN `<script>` global build (optional, post-v1). We ship **plain ESM
source with no build step** (the published package _is_ the source), which bundlers prefer and which
matches the no-transpile ethos. The "special handling" is all `package.json` metadata, not code:

- **`exports`** map — the authoritative entry resolver (set once entry points settle).
- **`sideEffects`** honesty — the entry `index.js` _has_ import-time effects (registers the fetch
  transport, attaches services), so it is marked `["./src/index.js"]` in `package.json`. The main
  entry is deliberately **batteries-included** (the common configuration: fetch transport + track +
  cache + retry + mock + helpers + code-forward — ~1000 lines / a few KB gzipped total, so the
  stakes are kilobytes, not megabytes). Space-conscious consumers import the pieces directly:
  `createIO()` from `io.js` for the bare pipeline plus the `install*` modules they want — those
  stay side-effect-free and tree-shakeable.
- **`browser`** export condition for the browser/CLI forks (cache backends, the `Server-Timing`
  fallback).
- Optional **subpath exports** for the optional services and a tiny `/prelude`.
