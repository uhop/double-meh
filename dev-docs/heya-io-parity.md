# `double-meh` vs `heya/io` + `heya/io-node` — feature parity

> Survey date: 2026-06-30. Goal: confirm `double-meh` is a **superset** of `heya/io` (1.9.3) +
> `heya/io-node` (1.3.0), modulo features **not yet implemented** or **deliberately dropped**.
> Sources: the two repos' source + the `heya/io` GitHub wiki (12 cookbooks + API refs); mapped
> against `double-meh`'s current `src/`. Companion to [design.md](./design.md) (§ "Dropped from
> heya/io") and the vault `projects/double-meh/decisions.md` § Streaming.

**Legend:** ✅ replicated · ➕ replicated + improved (superset) · 🔲 not yet (planned) · ❌ decided against (with reason)

**Verdict:** `double-meh` is a superset of the heya libraries on the _conceptual_ surface (pipeline,
services, extensibility, streaming, return model) and adds a whole REST-correctness layer heya
never had. The gaps are all either **queued** (bundle, compression, progress, persistent cache,
retry extras, fetch-init passthrough) or **intentional drops** (the XHR era: XHR/jsonp/load/node
transports, `FauxXHR`, swappable Deferred).

---

## Core pipeline & return model

| heya feature                                                              | double-meh                                                                                                    | Status                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `io(options)` callable; string or options-bag                             | `io(options)` callable; string, `URL`, or bag                                                                 | ✅                                                  |
| Verbs `get/head/post/put/patch/delete/options` + `del`/`remove`           | same set + `del`/`remove`                                                                                     | ✅                                                  |
| `verb(url, data)` signature                                               | `verb(url, data?, options?)` — adds an override bag                                                           | ➕                                                  |
| `requestHasNoBody` / `responseHasNoBody`                                  | `readVerbs` / `noResponseBody` / `metaVerbs`                                                                  | ✅                                                  |
| Return: `Result`/`BadStatus`/`TimedOut`/`FailedIO`, `returnXHR`, `Ignore` | **envelope** (`io.full` / errors share it), decode-once; `FailedIO`/`BadStatus`/`TimedOut` carry the envelope | ➕ (envelope > raw XHR; `problem+json` on `e.data`) |
| `io.processOptions` (request rewrite hook)                                | request inspectors (`io.inspect.request`)                                                                     | ✅                                                  |
| `io.processSuccess` / `io.processFailure`                                 | response inspectors (`io.inspect.response`) + throw-on-non-2xx                                                | ✅                                                  |
| `io.buildUrl` / `makeKey` / `makeQuery` / `makeVerb`                      | `io.buildUrl` / `io.makeKey` / `makeVerb` (`makeKey` = canonical sorted-query)                                | ➕                                                  |
| `returnXHR` (resolve raw XHR)                                             | ❌ — `io.full` returns the envelope; `.response` is the real `Response`                                       | ❌ raw-XHR concept obsolete                         |
| `Ignore` marker (send data unprocessed)                                   | dataProcessor returns the body as-is                                                                          | ✅ (folded into processors)                         |

**Net-new (no heya equivalent):** conditional writes (`ifMatch`/`ifNoneMatch`), `idempotencyKey`,
`io.update()` (conditional-PUT + 412 conflict-retry), query builders (`fields`/`sort`/`expand`),
`as` content-type shorthand + registry, lazy envelope getters (`etag`/`weak`/`lastModified`/
`location`/`links`/`contentType`/`retryAfter`/`serverTiming`), code-forward (`adopt`/`__doubleMeh`),
an events emitter, scalar query.

## Transports

| heya transport                                                                                                                                            | double-meh             | Status / reason                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `fetch`                                                                                                                                                   | the one core transport | ✅                                                                                                            |
| Transport registry (`io.transports`, `defaultTransport`, `registerTransport`)                                                                             | same                   | ✅                                                                                                            |
| XHR (`xhrTransport`) + `FauxXHR` + XHR-isms (`responseType`, `overrideMimeType`/`mime`, `withCredentials` shim, `user`/`password`, header-string parsing) | —                      | ❌ `fetch` + real `Response`/`Headers` make the emulation layer collapse; `new Response()` replaces `FauxXHR` |
| `jsonp` transport                                                                                                                                         | —                      | ❌ obsolete                                                                                                   |
| `load` (`<script>`) transport                                                                                                                             | —                      | ❌ too exotic now                                                                                             |
| Node `http`/`https` transport                                                                                                                             | —                      | ❌ `fetch()` is universal — one transport for browser + CLI                                                   |

## Services / middleware

| heya service                                                                   | double-meh                                                                                                   | Status                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `cache` (priority 50, GET-default, `save`/`remove`/`clear`, swappable storage) | `io.cache` — opt-in, app-governed TTL, 304 revalidation, prefix/regexp/fn invalidation, app-called `sweep()` | ✅ core; ➕ app-governed                                       |
| — storage backends (`sessionStorage`/`localStorage`)                           | in-memory only (v1)                                                                                          | 🔲 persistent backends (Cache API / fs / `node:sqlite`) queued |
| `track` (priority 40, dedupe in-flight, `wait`)                                | `io.track` — **run-level decoded-envelope** dedup (decode-once)                                              | ➕ (shares the decoded envelope, not a re-readable XHR)        |
| — `wait:true` (register interest without firing)                               | type-declared, **unwired**                                                                                   | 🔲 not yet                                                     |
| `retry` (retries, `continueRetries`, `nextDelay`, `initDelay`)                 | `io.retry` — verb-aware safety, `Retry-After`, DELETE-404→204, `retries`/`initDelay`/`nextDelay`             | ➕ core (safer); `continueRetries` predicate + polling mode 🔲 |
| `mock` (exact/prefix/regexp/fn; returns value/promise/XHR/redirect)            | `io.mock` — exact/prefix/regexp/fn; returns `Response`/value; composes with the real pipeline                | ✅ ➕ (mints real `Response`s)                                 |
| `bundle` (priority 10, request coalescing, `heya-bundler` server)              | —                                                                                                            | 🔲 bundle client queued (benchmark vs HTTP/2 first)            |
| `bust` (cache-busting query param)                                             | —                                                                                                            | 🔲 not yet (trivially doable via `query`)                      |
| `scaffold` (service factory: `optIn`/`attach`/`detach`)                        | `io.attach`/`detach` + per-service `optIn`, priority onion                                                   | ✅                                                             |

## Extensibility hooks

| heya hook                                          | double-meh                                | Status                                   |
| -------------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| `dataProcessors` (by constructor)                  | `io.dataProcessors` / `io.registerData`   | ✅                                       |
| `mimeProcessors` (by content-type)                 | `io.mimeProcessors` / `io.registerMime`   | ✅                                       |
| `processData` / `getData` / `getHeaders`           | `encodeBody` / `decode` / `makeEnvelope`  | ✅ (reworked)                            |
| Transport & service registration                   | `registerTransport` / `attach`+`detach`   | ✅                                       |
| `io.Deferred` / `FauxDeferred` (swappable promise) | —                                         | ❌ native `Promise` everywhere           |
| `io.AbortRequest()`                                | `options.signal` (native `AbortSignal`)   | ➕ native                                |
| Node `inspectRequest` / `inspectResult`            | request/response inspectors (generalized) | ✅                                       |
| Node `addEncoder` / `removeEncoder`                | —                                         | 🔲 pluggable compression encoders queued |

## Events & progress

| heya                              | double-meh                                   | Status                                                               |
| --------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| (no EventEmitter)                 | `io.on`/`off`/`emit` events emitter          | ➕ net-new                                                           |
| `onDownloadProgress`              | read `response.body` (manual; `stream:true`) | ✅ manual / 🔲 no callback sugar                                     |
| `onUploadProgress`                | —                                            | 🔲 upload progress (inserted technical stream) queued                |
| `onProgress`, `Deferred.progress` | —                                            | 🔲 (unified progress) / ❌ Deferred.progress (no swappable Deferred) |

## Streaming (heya/io-node) — **replicated + modernized this session**

| heya-io-node                                                        | double-meh                                                                                  | Status                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `responseType:'$tream'` (raw response stream)                       | `io.stream.get(url)` / `{stream:true}` → Web `ReadableStream`                               | ➕ Web-native                                                         |
| `heya-io-node/stream` `IO` Duplex + stream verbs (`.pipe()` in/out) | **`ios.put`/`post`/`patch` + `ios(options)`** → `{readable, writable, response}` Web duplex | ➕ Web-native, `stream-chain`-composable                              |
| Request-body streaming (pass `Readable`/`Buffer`)                   | pass a Web `ReadableStream`/`Blob`/`File` (body-type-driven) or a `{readable}` chain        | ➕                                                                    |
| `.meta` (response FauxXHR), `.getData()`/`.getHeaders()`            | `.response` promise (envelope: status/headers)                                              | ✅                                                                    |
| Node `Readable`/`Duplex` streams                                    | **Web streams only** — `node:stream` deliberately absent                                    | ❌ Node-stream code (browser target; `stream-chain` bridges Web→Node) |

## Compression (heya/io-node)

| heya-io-node                                                                 | double-meh                         | Status                            |
| ---------------------------------------------------------------------------- | ---------------------------------- | --------------------------------- |
| Auto response decompression (`content-encoding`)                             | `fetch` decompresses automatically | ✅ (via platform)                 |
| Request-body compression (`$-Content-Encoding`, `encodingThreshold`)         | —                                  | 🔲 queued (gzip/br/zstd encoders) |
| `io.node.encoders` / `addEncoder` / `acceptedEncoding` / `preferredEncoding` | —                                  | 🔲 pluggable encoders queued      |
| `compressor` / `decompressor` (zlib opts)                                    | —                                  | 🔲                                |

## Options — parity table

| heya option                                                                                                                           | double-meh                                                      | Status                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `url`, `method`, `query`, `data`, `headers`                                                                                           | same                                                            | ✅                                                                                                           |
| `signal`                                                                                                                              | native `AbortSignal`                                            | ✅                                                                                                           |
| `ignoreBadStatus`                                                                                                                     | `ignoreBadStatus`                                               | ✅                                                                                                           |
| `cache`, `track`, `mock` (opt-in)                                                                                                     | same                                                            | ✅                                                                                                           |
| `retries`, `nextDelay`, `initDelay`                                                                                                   | in the `retry` option bag (defaults on `io.retry`)              | ✅                                                                                                           |
| `bundle`                                                                                                                              | —                                                               | 🔲                                                                                                           |
| `wait`, `bust`                                                                                                                        | `track: 'wait'`, `bust`                                         | ✅                                                                                                           |
| `continueRetries`                                                                                                                     | same (in the `retry` bag; `retries: 0` = polling)               | ✅                                                                                                           |
| `timeout`                                                                                                                             | same (`options.timeout` → `TimedOut`)                           | ✅                                                                                                           |
| `returnXHR`, `processSuccess`/`processFailure` (per-req)                                                                              | `io.full` / response inspectors                                 | ➕ / ✅                                                                                                      |
| `responseType` (`blob`/`arraybuffer`/`document`/`json`/`text`)                                                                        | content-type-driven decode + `mimeProcessors` + `{stream:true}` | ⚙️ reworked — no `responseType` option; binary via a mimeProcessor or a stream                               |
| `withCredentials`, `fetchMode`/`fetchCache`/`fetchRedirect`/`fetchReferrer`/`fetchReferrerPolicy`/`fetchCredentials`/`fetchIntegrity` | —                                                               | 🔲 **fetch-init passthrough** not exposed (real gap for cross-origin `credentials`, `mode`, `redirect`, SRI) |
| `user`/`password`, `mime` (overrideMimeType)                                                                                          | —                                                               | ❌ XHR-isms (use `headers`/`Authorization`; content-type via `as`/`headers`)                                 |
| `callback` (jsonp), `responseType:'$tream'`, `$-Content-Encoding`, `compressor`/`decompressor`                                        | jsonp ❌; `$tream`→`io.stream`/`ios` ✅➕; compression 🔲       | mixed                                                                                                        |

**Net-new options:** `ifMatch`, `ifNoneMatch`, `idempotencyKey`, `as`, `fields`, `sort`, `expand`,
`withEtag`, `stream`.

## Cookbook recipes (heya/io wiki, 12) — can we replicate?

| Cookbook                                                                                      | double-meh                                                                        | Status                              |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------- |
| **main** (verbs, `query`/`headers`/`returnXHR`, error types, `FormData`, `Promise.all`)       | verbs + envelope/errors + `FormData` passthrough                                  | ✅ (`io.full` replaces `returnXHR`) |
| **manipulate requests** (`processOptions`: virtual hosts, auth injection)                     | request inspectors rewrite `url`/`headers`                                        | ✅                                  |
| **manipulate responses** (`processFailure` chain, `instanceof FailedIO`/`BadStatus`, 401/403) | response inspectors + `catch (e) { e instanceof io.BadStatus; e.status; e.data }` | ✅                                  |
| **bundle**                                                                                    | —                                                                                 | 🔲 bundle client queued             |
| **cache** (attach, `localStorage`, `cache:false`, `remove` exact/wildcard/regexp, `clear`)    | invalidation patterns ✅; `localStorage` backend 🔲                               | ✅ / 🔲 (in-memory now)             |
| **mock** (patterns, redirect, delay, error)                                                   | `io.mock` all four matchers; 503→200 gets retried                                 | ✅                                  |
| **track** (`wait:true` register interest)                                                     | dedup ✅; `track: 'wait'` register interest ✅                                    | ✅                                  |
| **bust** (`bust:true` / custom key)                                                           | same (`bust: true` / `'name'`), never cached                                      | ✅                                  |
| **retry** (`retries:0`, `continueRetries: r => r.status>=500`, delays)                        | all in the `retry` bag, incl. `continueRetries` polling                           | ✅                                  |
| **jsonp**                                                                                     | —                                                                                 | ❌ dropped                          |
| **load**                                                                                      | —                                                                                 | ❌ dropped                          |
| **fetch** (attach/detach, `fetchMode`/`fetchCredentials`/…)                                   | fetch is the default ✅; per-request fetch-init options 🔲                        | 🔲                                  |

## Summary — the delta

**❌ Decided against (intentional, see design.md § "Dropped from heya/io"):**
XHR transport + `FauxXHR` + all XHR-isms (`responseType` emulation, `mime`/overrideMimeType,
`withCredentials` shim, `user`/`password`, header-string parsing); `jsonp` and `load` transports;
Node `http`/`https` transport; swappable `io.Deferred`/`FauxDeferred` + `AbortRequest` (native
`Promise`/`AbortController` instead); `returnXHR` (the envelope instead). **Node streams** — Web
streams only.

**✅ Closed 2026-06-30 (from this survey's findings):** **fetch-init passthrough** — the `{fetch}`
option sub-bag spreads any `RequestInit` field (`credentials`/`mode`/`redirect`/`referrer`/
`integrity`/…) into `fetch()` (collision-free, forward-compatible); and **`wait`** — now wired into
`track` (register interest without firing; a later real request or `adopt` resolves all waiters;
spelled `track: 'wait'` since 2026-07-02). `bust`, `continueRetries` polling, and `timeout` followed
on 2026-07-02.

**🔲 Not yet implemented (queued — see `projects/double-meh/queue.md`):**
bundle client; `bust`; transparent request compression + pluggable encoders (`$-Content-Encoding`);
upload progress (+ progress-callback sugar for download); retry `continueRetries`/polling +
`options.timeout`; persistent cache backends + `Vary` keying.

**➕ Superset (no heya equivalent):** conditional writes + idempotency + `io.update()`; the response
envelope with lazy validators + `problem+json`; query builders (`fields`/`sort`/`expand`); the `as`
content-type registry; code-forward; the events emitter; canonical `makeKey`; and the Web-native
streaming duo (`ios` duplex + `io.stream`) that modernizes heya-io-node's `$tream`.

So: **`double-meh` ⊇ `heya/io` + `heya/io-node`** on everything that survives the fetch-native
redesign; the remaining gaps are the queued items above — all additive features, none of which a
migrating heya user hits on the common paths (the two that would, fetch-init passthrough and `wait`,
were closed as part of this survey).
