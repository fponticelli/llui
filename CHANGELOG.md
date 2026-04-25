---
title: Changelog
description: Release history for LLui packages
---

# Changelog

All notable changes to LLui packages are documented here. LLui is a pre-1.0 project — every release may include breaking changes, though we try to call them out explicitly.

**How to read this file:** entries are anchored by **release date**. Inside each release, fixes are grouped by **`@llui/<package>@<version>`** sub-sections so you always know exactly which package and version a bullet applies to. Cross-cutting changes that affect every package (like build-output fixes) live under a shared "All packages" section. Breaking changes and migration notes sit at the top of each release block because they usually cut across multiple packages.

Packages version in lockstep at release time: `@llui/dom`, `@llui/vite-plugin`, `@llui/test`, `@llui/router`, `@llui/transitions`, `@llui/components`, `@llui/vike` share a version line. `@llui/effects`, `@llui/mcp`, `@llui/eslint-plugin`, `@llui/agent`, and `llui-agent` have their own cadence.

## 2026-04-25 — peer-dep packaging fix

**Released:** `@llui/vite-plugin@0.0.31`, `@llui/test@0.0.31`, `@llui/vike@0.0.32`, `@llui/mcp@0.0.25`, `@llui/eslint-plugin@0.0.15`, `@llui/agent@0.0.32`

Critical packaging fix for `@llui/{vike,test,mcp,agent}`: ship `@llui/dom` as a peer dependency instead of a runtime dependency. The old packaging caused dual `@llui/dom` installs in any consumer whose own `@llui/dom` version differed from what the package was pinned to at publish time, producing `provide() can only be called inside a component's view() function` errors from inside view callbacks where the call was manifestly correct.

### Breaking

- **`@llui/vike@0.0.32`, `@llui/test@0.0.31`, `@llui/mcp@0.0.25`, `@llui/agent@0.0.32`** — `@llui/dom` is now a peer dependency, not a transitive runtime dep. Consumers who relied on transitive resolution must declare `@llui/dom` explicitly in their own project's `dependencies`.

### Migration

- Add `@llui/dom` to your project's dependencies if it isn't there: `pnpm add @llui/dom`. Most projects already import from `@llui/dom` directly and have it declared — only ones that relied purely on transitive resolution will hit "cannot find module".
- If you'd applied a `pnpm.overrides` workaround to force a single `@llui/dom` instance, you can remove it — the peer pattern handles deduplication natively.

### `@llui/vite-plugin@0.0.31`

- **Fixed** `transform.ts` picked up a `.js` extension on one relative import that `add-js-extensions.mjs` had missed.

### `@llui/test@0.0.31`

- **Fixed** `@llui/dom` ships as `peerDependencies` + `devDependencies` instead of `dependencies`. Same dual-install fix as `@llui/vike`.

### `@llui/vike@0.0.32`

- **Fixed** `@llui/dom` ships as `peerDependencies` + `devDependencies` instead of `dependencies`. Resolves dual-install / `provide()`-from-view errors. See top of release block for migration.
- **Added** Cloudflare Workers section in the README — documents the `worker.ts` pattern with `import.meta.env.PROD` guard around the `dist/server/entry.mjs` import. Without the guard, dev workerd loads the stale prod build and trips Vike's prod-in-dev detector. The brillout-recommended `process.env.NODE_ENV` snippet silently fails under workerd (no Node `process`).

### `@llui/mcp@0.0.25`

- **Fixed** `@llui/dom` ships as `peerDependencies` + `devDependencies` instead of `dependencies`. Type-only usage in mcp's source, but the packaging anti-pattern was identical.

### `@llui/eslint-plugin@0.0.15`

- **Fixed** 11 source files now have explicit `.js` extensions on relative imports. The `add-js-extensions.mjs` build pass had been silently skipping this package since the `lint-idiomatic` → `eslint-plugin` rename — its hardcoded list still pointed at the old name. No runtime effect (the package is CommonJS), but now consistent with the rest of the monorepo.

### `@llui/agent@0.0.32`

- **Fixed** `@llui/dom` ships as `peerDependencies` + `devDependencies` instead of `dependencies`. Type-only consumer (`Send`, `AppHandle` from agent's client adapters).
- **Fixed** removed phantom `@llui/effects` dependency. The package never imported from `@llui/effects` — only the README example does, and that's user-side app code. Consumers using `handleEffects` in their own app should declare `@llui/effects` themselves (most already do).

### Docs

- **Improved** root `README.md` package table: replaced the stale `@llui/lint-idiomatic` row with `@llui/eslint-plugin`, and added `@llui/agent` + `llui-agent` rows that had been missing.
- **Improved** `/publish` skill now refuses to bump versions if any non-private package has `@llui/dom` in `dependencies` instead of `peerDependencies`. Cascade list derived from `package.json` files instead of a hand-maintained enumeration, so a newly-added peer can't be silently skipped on the next release.

## 2026-04-24 — @llui/agent@0.0.31

**Released:** `@llui/agent@0.0.31`

Cross-runtime portability rework: `@llui/agent` now runs on Cloudflare Workers (via Durable Objects), Deno / Deno Deploy, and Bun in addition to Node. The `ws` library and `node:crypto` are no longer load-bearing in the runtime-neutral path — only the Node adapter imports them.

### Breaking

- **`@llui/agent@0.0.31` direct consumers of `signToken` / `verifyToken` / `signCookieValue`:** these are now async (return `Promise<T>`). The signatures use `crypto.subtle` HMAC-SHA256, which is web-standard and async by design. Wrap call sites in `await`. LAP server usage via `createLluiAgentServer` is unchanged — the async migration is handled internally.

### Migration

- `signToken(payload, key)` → `await signToken(payload, key)` — same for `verifyToken` and `signCookieValue`.
- No changes needed if you only use `createLluiAgentServer({ ... })` at the top level. The Node path signature is unchanged.
- Non-Node deployments: see [Runtime support](https://llui.dev/api/agent#runtime-support) for the Cloudflare / Deno / Bun recipes.

### `@llui/agent@0.0.31`

- **Added** `@llui/agent/server/core` sub-path — runtime-neutral entry that builds the LAP router, registry, and accept-connection primitive without importing `ws` or any `node:*` module. Works on Node, Bun, Deno, and Cloudflare.
- **Added** `@llui/agent/server/web` sub-path — WHATWG WebSocket adapters. Exports `createWHATWGPairingConnection` (wraps any standard `WebSocket` in a `PairingConnection`), `handleCloudflareUpgrade` (uses `WebSocketPair`), `handleDenoUpgrade` (uses `Deno.upgradeWebSocket`), and `extractToken`.
- **Added** `@llui/agent/server/cloudflare` sub-path — `AgentPairingDurableObject` class + `routeToAgentDO` Worker helper. A single Cloudflare Durable Object owns one session `tid`'s in-memory registry; the Worker's fetch handler routes LAP + WebSocket upgrade calls to the DO by token. Full recipe + `wrangler.toml` snippet in the docs.
- **Added** `AgentCoreHandle.acceptConnection(token, conn)` primitive. Runtime adapters call this after accepting a WebSocket in their native way; it validates the token, updates the token store, writes an audit entry, and registers the `PairingConnection`.
- **Added** `PairingRegistry` interface extracted from the `WsPairingRegistry` class. The in-memory implementation is now `InMemoryPairingRegistry` (backward-compatible `WsPairingRegistry` alias preserved). External implementations (e.g. the Durable Object registry) implement the interface directly. Routing primitives (`register`, `send`, `subscribe`, `onClose`) are separate from request/response helpers (`rpc`, `waitForConfirm`, `waitForChange`), which live in `server/ws/rpc.ts` and can be reused across registries.
- **Improved** WebCrypto migration — HMAC sign/verify now go through `crypto.subtle` (standard across Node ≥ 15, Cloudflare, Deno, Bun). Removed `node:crypto` import. `crypto.randomUUID()` (global web standard) replaces `require('node:crypto').randomUUID`.
- **Improved** LAP handler internals — the registry no longer owns in-flight RPC promise tracking or long-poll wait entries. Each handler subscribes to frames via `registry.subscribe(tid, filter)` for the duration of its call, then unsubscribes. This keeps the registry interface small enough that a Cloudflare Durable Object can implement it cleanly.

### Docs

- **Added** Runtime support matrix and full deployment recipes for Node, Deno, Bun, and Cloudflare + Durable Objects in [`/api/agent`](https://llui.dev/api/agent).

---

## 2026-04-24 — 0.0.30

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components}@0.0.30`; `@llui/vike@0.0.31`; `@llui/mcp@0.0.24`; `@llui/eslint-plugin@0.0.14`; `@llui/agent@0.0.30`; `llui-agent@0.0.2`

Two headline changes: `@llui/mcp` grows from 23 → 38+ tools across four new phases (CDP screenshots + a11y, compiler cache introspection, source grep + test/lint, SSR hydration + render). `@llui/agent` adds the `observe` tool and drained `send_message` semantics, cutting the "check state → act → check state" loop from five MCP round-trips to two.

### Breaking

- **`@llui/lint-idiomatic` is gone.** The rules have been migrated into `@llui/eslint-plugin`. Drop the `@llui/lint-idiomatic` dependency, replace imports with `@llui/eslint-plugin`, and remove the old package from any `eslint.config.ts` entries — the rule ids stay the same.

### Migration

- Remove `@llui/lint-idiomatic` from your `devDependencies`, add `@llui/eslint-plugin`, and adjust your ESLint config imports.
- No code changes required for `@llui/agent` users: the new `observe` tool is additive and the new `waitFor: 'drained'` default for `send_message` is a faster, backward-compatible drop-in.

### `@llui/dom@0.0.30`

- **Added** `getCompiledSource`, `getMsgMaskMap`, `getBindingSource`, and `getHydrationReport` on `LluiDebugAPI` — the runtime hooks that back the new `@llui/mcp` compiler/SSR tools. Zero cost in production; only populated when `installDevTools` runs.

### `@llui/vite-plugin@0.0.30`

- **Added** 50-entry LRU compiler cache storing per-component pre/post transform source, Msg→mask map, and binding source locations. Emitted as non-enumerable `Object.defineProperty` calls so production bundles aren't bloated but MCP tooling can read them in dev.

### `@llui/mcp@0.0.24`

- **Added** 15 new tools across four phases:
  - **CDP (6)** — `llui_screenshot`, `llui_a11y_tree`, `llui_network_tail`, `llui_console_tail`, `llui_uncaught_errors`, `llui_browser_close`. Backed by a lazy Playwright attach (`:9222` user-chrome first, fallback to headless) with ring buffers for console/network/errors.
  - **Compiler (3)** — `llui_show_compiled`, `llui_explain_mask`, `llui_goto_binding_source`. Read from the vite-plugin's new compiler cache.
  - **Source (4)** — `llui_find_msg_producers`, `llui_find_msg_handlers`, `llui_run_test`, `llui_lint_project`. Grep + vitest + ESLint at workspace scope.
  - **SSR (2)** — `llui_hydration_report` (diff client vs server-rendered HTML from `data-llui-ssr-html`), `llui_ssr_render`.
- **Added** CLI flags `--url` (dev-server target for Playwright) and `--headed` (visible browser window) so the CDP fallback can point at an existing dev server or run visibly for debugging.

### `@llui/agent@0.0.30`

- **Added** `observe` LAP endpoint + browser RPC handler. One call returns `{state, actions, description, context}`, folding in what used to take three separate calls (`describe_app` + `get_state` + `list_actions`).
- **Added** drain semantics to `send_message`. The default `waitFor: 'drained'` waits for the message queue to go idle (http/delay/debounce round-trips feed back as messages, then quiesce), then returns the fresh state, actions, and a `drain` block with `effectsObserved`, `durationMs`, `timedOut`, and any unhandled effect errors captured during the window. New params: `drainQuietMs` (default 100ms) and `timeoutMs` (default 5000ms, down from 15s).
- **Improved** Response envelope on `dispatched` now carries `actions` alongside `stateAfter`, so the LLM rarely needs a follow-up `observe` after a send.

### `llui-agent@0.0.2` (agent-bridge)

- **Added** `observe` MCP tool routed to `/lap/v1/observe`. `bridge.ts` caches the returned `description` so subsequent `describe_app` calls short-circuit.
- **Improved** `send_message` tool schema advertises `waitFor: 'drained' | 'idle' | 'none'`, `drainQuietMs`, and `timeoutMs` controls. Tool descriptions updated to steer Claude toward the efficient path.

### `@llui/eslint-plugin@0.0.14`

- **Added** Rules migrated from the removed `@llui/lint-idiomatic` package: `agent-exclusive-annotations`, `agent-missing-intent`, `agent-nonextractable-handler`, `each-closure-violation`, and related idiomatic-LLui rules. Rule ids unchanged — only the importing package moved.

### `@llui/vike@0.0.31`, `@llui/test@0.0.30`, `@llui/router@0.0.30`, `@llui/transitions@0.0.30`, `@llui/components@0.0.30`

- **Improved** Cascade from `@llui/dom@0.0.30`. No user-visible behavior changes; `components`, `router`, `transitions` pick up the new `^0.0.30` peer range.

### Docs

- **Added** [`/api/agent`](https://llui.dev/api/agent) adoption guide (install, dev middleware, client wiring, `@intent` / `@requiresConfirm` / `@humanOnly` annotations, `agentDocs` / `agentContext` / `agentAffordances`, DOM tagging, production server setup, efficient tool usage, security).
- **Added** [`/api/agent-bridge`](https://llui.dev/api/agent-bridge) CLI + Claude Desktop config + tool reference.
- **Updated** Package table on the index page and `llms.txt` to list the agent stack.

---

## 2026-04-22 — @llui/vike@0.0.30

**Released:** `@llui/vike@0.0.30`

Point-fix release for a client-navigation regression introduced in 0.0.26 that broke content-driven sites where multiple routes share a single `ComponentDef`. Reported against the llui.dev docs site; other lockstep packages ship unchanged at 0.0.29.

### `@llui/vike@0.0.30`

- **Fixed** Page layer is no longer counted as a "surviving layer" by the chain diff on client navigation. Since 0.0.26, two routes whose `+Page.ts` files resolved to the same `ComponentDef` reference — the normal pattern for content-driven sites where every page re-exports a shared component (e.g. `DocPage`) and per-route `+data.ts` supplies the content — were treated as a matching chain entry. `firstMismatch` advanced past the page slot, the adapter hit the `isNoOp` short-circuit, and only `onMount` fired: URL bar advanced, DOM stayed frozen on the previous route. The chain diff now bounds `firstMismatch` to the layout prefix, so the page slot is always divergent and `init(data)` re-runs on every nav regardless of `ComponentDef` identity — matching the contract the README already documented ("Navigating from `/dashboard/reports` to `/dashboard/overview` only disposes the `Page`"). Persistent layouts, `propsMsg` dispatch on surviving layouts, hydration envelope handling, and chain growth/shrink semantics are unchanged. Three regression tests cover the same-def nav scenario end-to-end.

---

## 2026-04-21 — 0.0.29

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.29`; `@llui/mcp@0.0.23`; `@llui/lint-idiomatic@0.0.13`; **`@llui/agent@0.0.29`** _(first release)_; **`llui-agent@0.0.1`** _(first release)_

Inaugural release of the LLui agent stack: a full LAP (LLui Agent Protocol) server + browser client + Claude Desktop bridge that lets Claude drive any LLui app directly.

### `@llui/agent@0.0.29` _(new package)_

First release. Provides both the server-side LAP endpoint and the browser-side client slices needed to make a LLui app driveable by Claude.

**Server (`@llui/agent/server`)**

- **Added** `createLluiAgentServer(opts)` factory — mounts a full HTTP+WS agent server. HTTP routes: `POST /agent/mint`, `POST /agent/revoke`, `GET /agent/sessions`, `POST /agent/resume/list`, `POST /agent/resume/claim`. LAP routes: `/lap/v1/describe`, `/lap/v1/message`, `/lap/v1/wait`, `/lap/v1/confirm-result`.
- **Added** WebSocket upgrade handler at `/agent/ws` — authenticates via HMAC token, pairs the browser to a Claude session, relays RPC frames.
- **Added** `signToken` / `verifyToken` — HMAC-SHA256 mint/verify with configurable signing key; falls back to a random per-session key in dev.
- **Added** `InMemoryTokenStore` — default token store; pluggable via the `tokenStore` option.
- **Added** `defaultIdentityResolver` — signed-cookie identity; pluggable via `identityResolver`.
- **Added** `defaultRateLimiter` — 60 req/min per identity; pluggable via `rateLimiter`.
- **Added** `consoleAuditSink` — logs every LAP action to stdout; pluggable via `auditSink`.
- **Added** 6 LAP RPC handlers: `get_state` (JSON-pointer path resolution), `list_actions` (bindings + affordances + annotations), `describe_context`, `query_dom`, `describe_visible_content`, `send_message` (annotation gating + confirm-propose flow).
- **Added** `WsPairingRegistry` — tid→pairing map with rpc correlation and pending-confirmation long-poll support.

**Client (`@llui/agent/client`)**

- **Added** `createAgentClient(opts)` factory — composes the WebSocket client with the HTTP effect handler; accepts `wrapConnectMsg`, `wrapConfirmMsg`, `wrapLogMsg` slices for integration with the host app's `update()`.
- **Added** `agentConnect` headless component — manages WS lifecycle (`awaiting-ws → awaiting-claude → active`), token minting, and the connect-snippet for Claude Desktop.
- **Added** `agentConfirm` headless component — handles the pending-confirmation UI flow (propose → user accept/reject → resolved).
- **Added** `agentLog` headless component — ring-buffered action log (`entries: LogEntry[]`); updated via `wrapLogMsg`.
- **Added** `ws-client` — hello frame dispatch, RPC round-trip, `log-append` frame emission with human-readable intent labels built from `@intent` annotations and fixed labels for read tools (`"Read app state"`, `"List available actions"`, etc.).
- **Added** State-update and log-append frame emission so the host app's local `agent.log` slice mirrors Claude's actions in real time.
- **Fixed** Claude-bound activation signal — `ActivatedByClaude` fires only after the server sends `{t: "active"}`, preventing premature `active` status.
- **Fixed** `WsOpened` / `WsClosed` dispatched to `agentConnect` slice on WebSocket events.
- **Fixed** Unknown msg variants rejected early with a structured error; 500 responses now include real `Error` name/message/stack (first 5 frames) in `detail` so Claude sees actionable diagnostics.

### `llui-agent@0.0.1` _(new package)_

First release. A Claude Desktop MCP bridge CLI (`npx llui-agent`) that connects Claude to any running LLui app's agent endpoints.

- **Added** stdio MCP transport — lists and calls LAP tools on behalf of Claude Desktop.
- **Added** `BindingMap` — per-session `{url, token, describe}` state keyed by session ID.
- **Added** `forwardLap` — generic POST dispatcher that proxies tool calls to the app's LAP routes.
- **Added** `/llui-connect` MCP prompt — guides Claude through the connection handshake.
- **Added** Full MCP tool surface: `llui_connect_session`, `get_state`, `list_actions`, `send_message`, `describe_context`, `query_dom`, `describe_visible_content`, `wait`, `confirm_result`.

### `@llui/dom@0.0.29`

- **Added** `AppHandle.subscribe(listener)` — post-update state-change listener. Called after every update cycle with `(newState, prevState)`. Returns an unsubscribe function. Safe to call from outside `view()`.
- **Added** `LluiComponentDef.__msgAnnotations`, `.__bindingDescriptors`, `.__schemaHash` — injected by the compiler; consumed by `@llui/agent` to populate the hello frame without runtime reflection.

### `@llui/vite-plugin@0.0.29`

- **Added** `extractMsgAnnotations` — reads JSDoc tags (`@intent`, `@humanOnly`, `@alwaysAffordable`, `@readSurface`) from the `Msg` union and emits them as `__msgAnnotations` on the compiled `component()` call.
- **Added** `extractBindingDescriptors` — walks `view()` to collect bound message variants and emits them as `__bindingDescriptors`.
- **Added** `computeSchemaHash` — stable SHA-256 over the message schema; emitted as `__schemaHash` so the agent can detect schema drift without a full describe round-trip.
- **Added** `agent?: boolean | AgentPluginConfig` — extends the existing `agent: true` shorthand with an object form accepting `signingKey`. When set, also auto-mounts `@llui/agent/server` HTTP and WS handlers on the Vite dev server so plain `vite dev` has working agent endpoints without a custom `server.ts`.

### `@llui/lint-idiomatic@0.0.13`

- **Added** Rule `agent-missing-intent` — warns when a user-dispatchable `Msg` variant lacks an `@intent` JSDoc tag, which Claude needs to understand what the action does.
- **Added** Rule `agent-exclusive-annotations` — warns when `@humanOnly` and `@alwaysAffordable` appear on the same variant (mutually exclusive).
- **Added** Rule `agent-nonextractable-handler` — warns when an `onEffect` handler can't be statically associated with an effect type, preventing the compiler from extracting its affordances.
- **Fixed** `@humanOnly` variants are now exempt from `agent-missing-intent` — intent annotations on human-only messages were never required.
- **Improved** Perfect-score threshold updated to 20 to account for the new agent rules.

### `@llui/mcp@0.0.23`

- **Improved** Perfect-score threshold updated to 20 to match the new `@llui/lint-idiomatic` rule set.

### `@llui/{test,router,transitions,components,vike}@0.0.29`

- Rebuilt against `@llui/dom@0.0.29`. No source changes.

---

## 2026-04-19 — 0.0.28

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.28`; `@llui/mcp@0.0.22`

Three consumer-reported issues fixed with TDD-first discipline — each lands with failing-test-then-implementation and no workarounds left in the library.

### Breaking

- **`@llui/components@0.0.28`** — `SortableMsg.start` and `SortableMsg.move` gain required `x: number`. Consumers using `connect()` for their handle/root wiring (the 99% case) see no change — `connect` fills `x` from `e.clientX` automatically. Hand-wired dispatchers that construct these messages directly get a TS error pointing at the missing field; add `x: <number>` alongside the existing `y`.

### Migration

- **Hand-wired sortable dispatchers** — add `x: <clientX or 0>` to every `SortableMsg.start` and `.move` literal in your app. `DragState` fixtures in tests get `startX` / `currentX` alongside the existing `startY` / `currentY` (both default to `0` when you don't have a meaningful position).

### `@llui/dom@0.0.28`

- **Fixed** `branch` and `each` disposers now remove their DOM nodes from the parent, not just their scopes. When an outer structural primitive swaps an arm whose children spread a nested `branch` / `each` directly (no wrapping element), nodes the nested primitive inserted AFTER the outer's initial render — each-reconciled rows, inner-branch post-mount case swaps — used to leak. The parent's cleanup only walked its initial-render `currentNodes` snapshot; anything the nested primitive inserted later was invisible to it. The disposer now walks live entries/nodes + anchor and removes them via `parentNode.removeChild`, guarded so cascade-removed subtrees no-op. `show` and `scope` ride this fix through `branch`. 6 new tests in `test/branch-nested-swap.test.ts` pinning every failure mode the repro covered.
- **Added** `AppHandle.getState(): unknown` — sanctioned escape hatch for reading state outside `view()`. Safe from event handlers, adapter `send` wrappers, async callbacks, timers. Returns the current instance state; throws after `dispose()` so stale reads fail loud. Wired into all four mount paths (`mountApp`, `hydrateApp`, `mountAtAnchor`, `hydrateAtAnchor`) plus the HMR replacement handle.
- **Improved** `sample()`'s "called outside view" error now points specifically at `AppHandle.getState()` with an example. The previous message told users "you called a primitive outside a render context" but didn't say what to do instead; the common-case shape (adapter wraps `send`, needs current state) now gets inline migration guidance with copy-pasteable code.

### `@llui/components@0.0.28`

- **Added** `layout: '2d'` option on `sortable.connect(get, send, { id, layout })`. Opt-in 2D support for flex-wrap and grid layouts where same-row items share a Y coordinate. Under the flag: `findTargetAt` ranks by Euclidean distance instead of Y-only; the dragged item's `style.transform` is `translate(dx, dy)` instead of `translateY(dy)`; non-dragged items between source and target get per-item `style.transform = translate(snapshotDelta)` that opens the correct gap regardless of row wrap; `data-shift` is suppressed in 2D so CSS `translateY(var(--sortable-shift))` rules don't fight with the computed transform. `DragState` now always tracks `{startX, startY, currentX, currentY}` — 1D ignores X at render time. Keyboard `moveBy` stays linear-array in both modes (screen-reader-correct; 2D-spatial keyboard nav is a separate feature).
- **Breaking** `SortableMsg.start` and `.move` gain required `x: number`. See top of release block.

### `@llui/{vite-plugin,test,router,transitions,vike}@0.0.28`

- Rebuilt against the new `@llui/dom` version. No source changes.

### `@llui/mcp@0.0.22`

- Rebuilt against the new `@llui/dom` version. No source changes.

---

## 2026-04-19 — 0.0.27

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.27`; `@llui/mcp@0.0.21`

Tightens the `DomEnv` contract introduced in 0.0.24 — follow-up hardening after the portal SSR fix in 0.0.26.

### Breaking

- **`@llui/dom@0.0.27`** — `DomEnv.querySelector(selector)` is now a required method on the interface. Previously optional, with `portal()` silently falling back to `globalThis.document` when a custom env didn't implement it. That fallback was exactly the shape that let a Workers-hostile env slip to production without an error — which is the failure mode 0.0.26 had to fix in the first place. Making the method required means any custom env that forgets to wire up selector resolution fails TS compile instead of crashing at render time. Consumers on the three LLui-shipped envs (`browserEnv`, `jsdomEnv`, `linkedomEnv`) need no action; they already implement it.

### Migration

- **Hand-rolled `DomEnv` implementations** — add `querySelector(selector: string): Element | null` that resolves against your env's document (or returns `null` if your env has no meaningful document concept — portal treats `null` as a no-op).

### `@llui/dom@0.0.27`

- **Breaking** `DomEnv.querySelector` required. See top of release block.
- **Improved** Portal's string-target resolution is now a straight `ctx.dom.querySelector` call with no fallback branches — one less silent-failure mode.

### `@llui/{vite-plugin,test,router,transitions,components,vike}@0.0.27`

- Rebuilt against the new `@llui/dom` version. No source changes.

### `@llui/mcp@0.0.21`

- Rebuilt against the new `@llui/dom` version. No source changes.

---

## 2026-04-19 — 0.0.26

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.26`; `@llui/mcp@0.0.20`

Fixes two SSR crashes under Cloudflare Workers + `linkedomEnv` that shipped in 0.0.24 / 0.0.25.

### `@llui/dom@0.0.26`

- **Fixed** `<select value={accessor}>` no longer throws under linkedomEnv. Two-part fix: (1) the element helper now defers applying `value` on a `<select>` until after its children are appended — in real browsers and jsdom, setting `select.value` on an empty select was already a silent no-op (value fell through to the first option once options arrived), and on linkedom it was a hard throw. Deferring makes every env agree; the matching `<option>` ends up `selected` regardless. (2) `linkedomEnv()` now patches `HTMLSelectElement.prototype.value` with a custom get/set pair that walks `<option>` children and toggles `[selected]` per HTML-spec semantics. The patch is idempotent and only runs when the descriptor has no setter, so jsdom / real browser envs routed through the factory are untouched.
- **Fixed** `portal()` no longer reaches for bare `document` at render time, which crashed SSR with `ReferenceError: document is not defined` whenever a portal call appeared inside a `show` / `branch` / overlay render callback on Workers. `DomEnv` gains an optional `querySelector?(selector): Element | null`; `browserEnv`, `jsdomEnv`, and `linkedomEnv` all implement it. Portal resolves string targets via `ctx.dom.querySelector` first, falls back to `globalThis.document` for legacy envs that predate the method, and returns `[]` when neither is available — consistent with portal's existing "target not found" branch. Portal is semantically a client-only primitive; SSR emitting nothing is correct.
- **Added** Optional `querySelector?(selector): Element | null` method on the `DomEnv` interface. Added as optional so pre-existing consumer envs built by hand continue to type-check. All LLui-shipped envs implement it.

### `@llui/{vite-plugin,test,router,transitions,components,vike}@0.0.26`

- Rebuilt against the new `@llui/dom` version. No source changes.

### `@llui/mcp@0.0.20`

- Rebuilt against the new `@llui/dom` version. No source changes.

---

## 2026-04-19 — 0.0.25

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.25`; `@llui/mcp@0.0.19`

Follow-up to 0.0.24 — fixes a pre-existing `@llui/vike` package.json bug that survived the DomEnv refactor. No API changes.

### `@llui/vike@0.0.25`

- **Fixed** `jsdom` moved from `dependencies` to `peerDependencies` with `peerDependenciesMeta.jsdom.optional: true`. Before this release, installing `@llui/vike` auto-pulled jsdom into `node_modules` even when the consumer used `createOnRenderHtml({ domEnv: linkedomEnv })` on Cloudflare Workers. Now Workers consumers can skip jsdom entirely — matching `@llui/dom`'s shape, where jsdom and linkedom are both optional peers. Consumers using the default `onRenderHtml` export see the standard peer-dep install prompt (`pnpm install jsdom`).

### `@llui/dom@0.0.25`

- **Fixed** Dropped a stale `@ts-expect-error` directive in `src/ssr/linkedom.ts` that became an unused-directive lint error once pnpm started hoisting linkedom via the optional peer declaration. Replaced with an explicit `as unknown as …` cast that tolerates both resolved and unresolved module shapes at build time. Compiled JS is identical to 0.0.24 — this is a TS-only cleanup.

### `@llui/{vite-plugin,test,router,transitions,components}@0.0.25`

- Rebuilt against the new `@llui/dom` version. No source changes. Compiled output identical to 0.0.24.

### `@llui/mcp@0.0.19`

- Rebuilt against the new `@llui/dom` version. No source changes. Compiled output identical to 0.0.18.

---

## 2026-04-18 — 0.0.24

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.24`; `@llui/mcp@0.0.18`

Removes `globalThis` mutation from SSR. `@llui/dom` now threads a `DomEnv` through its render pipeline as a context object instead of patching the process's window. Ships new sub-entries `@llui/dom/ssr/jsdom` + `@llui/dom/ssr/linkedom` for per-call env construction, which fixes a 9+ MiB Cloudflare Workers bundle regression (the old `initSsrDom` pulled jsdom's `tr46` / `whatwg-url` / `punycode` transitive chain into the Worker bundle even when consumers used linkedom at runtime).

### Breaking

- **`@llui/dom@0.0.24`** — `renderToString(def, state?)` → `renderToString(def, state, env)`. The third `env: DomEnv` argument is required. Same change applies to `renderNodes`. Get an env from `@llui/dom/ssr/jsdom` (`jsdomEnv()`), `@llui/dom/ssr/linkedom` (`linkedomEnv()`), or the new `browserEnv()` helper for client-side tests.
- **`@llui/vike@0.0.24`** — `createOnRenderHtml({ Layout, document })` → `createOnRenderHtml({ domEnv, Layout, document })`. The `domEnv: () => DomEnv | Promise<DomEnv>` factory is required. The default `onRenderHtml` export still ships with a built-in jsdom env for zero-config setups; Workers consumers must use `createOnRenderHtml({ domEnv: linkedomEnv })`.

### Migration

- **Direct SSR users (jsdom):** replace `await initSsrDom()` + `renderToString(def, state)` with `const env = await jsdomEnv()` + `renderToString(def, state, env)`. Import `jsdomEnv` from `@llui/dom/ssr/jsdom`.
- **Cloudflare Workers / strict-isolate runtimes:** switch to `linkedomEnv()` from `@llui/dom/ssr/linkedom`. Your Worker bundle no longer pulls jsdom — the rollup graph walker only sees linkedom.
- **Vike consumers:** add `domEnv: jsdomEnv` (or `linkedomEnv`) to your `createOnRenderHtml` options. Import the factory from `@llui/dom/ssr/jsdom` (or `/linkedom`).
- **Hand-patched globals (legacy linkedom workaround):** delete the `Object.assign(globalThis, …)` shim. `linkedomEnv()` returns a self-contained env that the renderer uses directly.
- **`initSsrDom` callers:** update the import path from `@llui/dom/ssr` to `@llui/dom/ssr/legacy`. The shim still works, but living behind its own sub-entry means `@llui/dom/ssr` no longer pulls jsdom into bundles that don't explicitly opt in. Plan a real migration to `jsdomEnv()` before the shim is removed.

### `@llui/dom@0.0.24`

- **Breaking** `renderToString` / `renderNodes` require a `DomEnv`. See top of release block.
- **Added** `clientOnly({ render, fallback? })` primitive for browser-only subtrees. SSR emits `<!--llui-client-only-start-->` + optional fallback + `<!--llui-client-only-end-->` and never invokes `render`; on the client `render` runs inline, participating in the host component's `View<S, M>` bag and bitmask update cycle normally. Pair with dynamic `import()` inside `render` to keep browser-only libraries (Leaflet, Chart.js, Monaco, etc.) out of the SSR bundle's module graph. Discriminates SSR vs client via `ctx.dom.isBrowser` — `browserEnv()` sets it, `jsdomEnv`/`linkedomEnv` don't. Also available as `bag.clientOnly` on the `View<S, M>` helper (destructured form inside `view`).
- **Added** `foreign.mount` now accepts `Instance | Promise<Instance>` return values. When the promise is pending, the container element is inserted into the DOM immediately and `sync` is deferred; the initial `sync` fires on resolve with whatever props the binding observed during the await. Dispose-before-resolve correctly destroys the instance once it arrives. Rejected promises log to `console.error` (they can't reach `errorBoundary` through the microtask queue). Removes the workaround where users had to structure `foreign.mount` as a synchronous closure that referenced a pre-loaded imperative handle — now `await import('leaflet')` inline works directly.
- **Added** `__clientOnlyStub(name)` helper + `'use client'` module directive handled by `@llui/vite-plugin`. A file whose first non-comment statement is `'use client'` is replaced entirely during SSR builds: every `export const NAME = ...`, `export function NAME`, `export class NAME`, and named `export { ... }` list is rewritten to `export const NAME = __clientOnlyStub('NAME')`, and `export default` becomes `export default __clientOnlyStub('default')`. Top-level imports in the directive'd module are dropped from SSR output — any library that crashes on Node/Workers module-init no longer poisons the SSR bundle. Client builds are unaffected (directive is a no-op); atomic-swap hydration replaces the stub's empty placeholder with the real component DOM. Warns on `export ... from '...'` re-exports that bypass the stubbing pass.
- **Added** `DomEnv` interface + `browserEnv()` factory, both exported from `@llui/dom` and `@llui/dom/ssr`. Defines a minimal DOM contract (createElement, createTextNode, createComment, createDocumentFragment, Element, Node, Text, Comment, HTMLElement, HTMLTemplateElement, ShadowRoot, MouseEvent, parseHtmlFragment) that the runtime consumes instead of reaching for `globalThis`.
- **Added** `@llui/dom/ssr/jsdom` sub-entry exporting `jsdomEnv(): Promise<DomEnv>`. Lazy-imports jsdom on call; each call returns a fresh env.
- **Added** `@llui/dom/ssr/linkedom` sub-entry exporting `linkedomEnv(): Promise<DomEnv>`. Lazy-imports linkedom on call; safe on workerd and other strict-isolate runtimes where jsdom's transitive deps can't resolve.
- **Improved** Every internal `document.*` reference migrated to `ctx.dom.*` threading — 19 files, ~40 call sites. `mountApp` / `hydrateApp` / `renderToString` each seed the render context with a `dom: DomEnv` field the primitives read. Concurrent SSR with different DOM implementations in a single process works correctly.
- **Improved** `elTemplate`'s template cache is now per-env (WeakMap keyed on `DomEnv`) so concurrent SSR across jsdom + linkedom never cross-pollinates HTMLTemplateElement instances between envs.
- **Breaking** `initSsrDom()` moved from `@llui/dom/ssr` → `@llui/dom/ssr/legacy`. The shim still works (emits a one-time `console.warn` pointing at the migration path) but must be imported from the new path. Rationale: co-locating the shim with the clean entry meant `await import('jsdom')` stayed reachable from every Worker bundle that only wanted `renderToString`. Splitting into a named sub-entry ensures the jsdom chunk only appears in bundles that explicitly import the legacy path. Migrate: `import { initSsrDom } from '@llui/dom/ssr/legacy'`, then plan a proper migration to `jsdomEnv()` before it's removed.

### `@llui/vite-plugin@0.0.24`

- **Improved** Compiler replaces its internal `document.createElement('template')` IIFE emission with a call to `__cloneStaticTemplate(html)`, a new `@llui/dom` helper that threads through `ctx.dom`. Static-content template clones now work correctly under SSR without needing a patched globalThis. The plugin auto-injects the helper import when it emits the call.
- **Improved** `elTemplate` patch-function signature gains a third `__dom: DomEnv` parameter. Compiler-emitted patch bodies call `__dom.createTextNode(...)` instead of `document.createTextNode(...)` for reactive-text placeholders. App-authored `elTemplate` calls are unaffected — the new parameter is optional in positional terms (unused params don't need to be declared).

### `@llui/vike@0.0.24`

- **Breaking** `createOnRenderHtml` requires a `domEnv` option. See top of release block.
- **Improved** `pageSlot()` threads through `ctx.dom.createComment` for its anchor comment instead of touching `document` directly. Works under any env (jsdom, linkedom, or a custom one) without globalThis state.
- **Improved** Chain-composition `renderNodes` loop accepts an env parameter and uses it to synthesize end-sentinel comments. No more implicit dependency on a global document being alive during the composition pass.

### `@llui/{test,router,transitions,components}@0.0.24`

- Rebuilt against the new `@llui/dom` version. No source changes.

### `@llui/mcp@0.0.18`

- Rebuilt against the new `@llui/dom` version. No source changes.

---

## 2026-04-18 — 0.0.23

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.23`; `@llui/mcp@0.0.17`

Post-`0.0.22` polish pass. Ships a real bug fix: HTTP-mode `@llui/mcp` sessions used to route tool calls through dead relay instances (the per-session `LluiMcpServer`'s relay was never `startBridge()`'d), so any tool that needed the browser would fail with `RelayUnavailableError` even when a browser was attached. Upgrade strongly recommended for anyone running MCP in HTTP mode.

### `@llui/dom@0.0.23`

- **Added** `each.render`'s callback bag now carries `h: View<S, M>`. Inside each-render you can now reach for `h.text`, `h.scope`, `h.sample`, etc. without using the top-level imports — symmetric with how `branch.cases[k]`, `show.render`, and `scope.render` receive the View. Both forms still work; destructure whichever is cleaner.
- **Improved** `slice()` wraps the `each` render callback so a lifted `h: View<Sub, M>` is threaded through correctly — code that uses `slice(h, selector).each({ render })` now sees the Sub-typed View inside the render bag.
- **Improved** Dropped the placeholder `<_S, _M>` generics on the internal `BranchOptionsBase` interface — they weren't used in the body. The three variants that extend it (`BranchOptionsExhaustive`, `BranchOptionsNonExhaustive`, `BranchOptionsWide`) continue to carry S, M as before. No user-visible API change.

### `@llui/mcp@0.0.17`

- **Fixed** HTTP-mode session-relay bug. Each HTTP MCP session used to construct a fresh `LluiMcpServer`, which in turn constructed its own `WebSocketRelayTransport`. Only the `bridgeHost`'s relay ever had `startBridge()` called — session relays were dead instances. Any tool call that needed the browser failed even when a browser was attached because the dispatcher's `ctx.relay` pointed at the unstarted session relay. Fix: new `LluiMcpServer.createSessionMcp()` returns a fresh SDK `Server` routing through THIS instance's registry and relay. `cli.ts` calls it per session instead of spawning a new `LluiMcpServer`. A regression test in `test/http-transport.test.ts` pins the shape by asserting `bridge.running: true` in the error diagnostic (the discriminator between a live `bridgeHost` relay and a dead session-local one).
- **Fixed** MCP server version advertised in the `initialize` handshake is now read from `@llui/mcp/package.json` at module init instead of hardcoded as a literal — the hardcoded `'0.0.15'` silently drifted through the `0.0.16` release. Reads once, falls back to `'unknown'` on read failure.
- **Added** `llui-mcp doctor` honors the standard `NO_COLOR` env var and a new `--plain` flag. Falls back to `OK` / `FAIL` glyphs instead of emoji ✓/✗ for CI logs, screen readers, and corporate terminals that don't render U+2713/U+2717.
- **Deprecated** `new LluiMcpServer(<port>)` numeric-port constructor. The options form `new LluiMcpServer({ bridgePort, attachTo? })` is the only shape that expresses HTTP-transport port sharing; numeric form is mostly dead code outside a couple of bridge tests and will be removed in a future release. JSDoc carries the `@deprecated` tag.

### `@llui/{vite-plugin,test,router,transitions,components,vike}@0.0.23`

- Rebuilt against the new `@llui/dom` version. No source changes.

---

## 2026-04-18 — 0.0.22

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.22`; `@llui/mcp@0.0.16`

Follow-up pass on the dicerun2 feedback batch. The `branch()` exhaustiveness-typing gate lands (deferred from 0.0.21). `@llui/mcp` adopts `@modelcontextprotocol/sdk`, gains an HTTP transport, and becomes plugin-spawnable — one `pnpm dev` starts the whole stack. `@llui/vite-plugin` picks up `verbose`, auto-detects `@llui/mcp` as a dep, warns on mismatched MCP state, and auto-spawns the child in HTTP mode. `@llui/mcp` also ships a `doctor` CLI + structured bridge diagnostic for self-describing failures.

### Breaking

- **`@llui/dom@0.0.22`** — `branch.cases` now enforces exhaustiveness at the type level when `on` returns a literal string union. Existing calls with partial `cases` and no `default` that previously compiled silently now require a `default` builder. Wide `string` returns stay lenient (exhaustiveness can't be checked on an infinite domain).
- **`@llui/mcp@0.0.16`** — `LluiMcpServer.start()` is removed. The hand-rolled stdio JSON-RPC loop is replaced by SDK-backed transports; callers drive the protocol via `connect(transport)` (e.g. `StdioServerTransport`, `StreamableHTTPServerTransport`). Direct stdio consumers of the class must refactor; CLI users are unaffected.
- **`@llui/vite-plugin@0.0.22`** — when `@llui/mcp` is installed and `mcpPort` is omitted, the plugin now **spawns** `llui-mcp --http 5200` as a child of the dev server (previously: wire-only to an externally-managed server). If your `.mcp.json` already runs `llui-mcp` via stdio, the spawn is skipped when the marker file is already present — but switching to HTTP transport in `.mcp.json` (`{ "type": "http", "url": "http://127.0.0.1:5200/mcp" }`) is the recommended path forward.

### Migration

- `branch({ on, cases: { a: …, b: … } })` without `default` over a literal union like `'a' | 'b' | 'c'`: add `default: () => []` (or whatever the fallback should be) so the missing cases compile.
- If you embed `@llui/mcp` programmatically (rare — most consumers use the CLI), replace `server.start()` with `await server.connect(new StdioServerTransport())`. The `start()` method no longer exists.
- If you previously ran `npx llui-mcp` in a separate terminal plus configured the Vite plugin with `mcpPort: 5200`: keep that setup — the plugin detects the existing marker and won't double-spawn. Or switch to the plugin-spawn + HTTP `.mcp.json` flow to drop the second terminal.

### `@llui/dom@0.0.22`

- **Breaking** exhaustiveness typing for `branch()` — see top of release block.
- **Added** `ExhaustiveKeys<K, C>` type helper (public) surfaced for consumers composing their own `branch`-like abstractions.
- **Improved** `branch.ts` reconciler tags the Lifetime with `_kind: 'scope'` when `__disposalCause === 'scope-rebuild'`; devtools disposer-log now distinguishes scope rebuilds from branch swaps end-to-end (runtime side was right in 0.0.21; this fills in the kind-string missing link).
- **Fixed** `BranchOptionsBase<_S, _M>` stops tripping the no-unused-vars lint in downstream consumers.

### `@llui/vite-plugin@0.0.22`

- **Added** `verbose?: boolean` option — emits `[llui]`-prefixed `console.info` logs per compiled component file listing reactive state paths and their bit assignments. Off by default.
- **Added** auto-detect: when `mcpPort` is omitted and `@llui/mcp` resolves from the Vite project root, the plugin now defaults to enabling MCP — previously silent opt-out. Explicit `mcpPort: false` still disables, explicit numeric port still selects wire-only.
- **Added** auto-spawn: when auto-detect succeeds, the plugin reads `@llui/mcp`'s `bin.llui-mcp` entry and spawns `llui-mcp --http <port>` as a child of `server.httpServer`, piping stdout/stderr to Vite with `[mcp]` prefix, killing the child on server close. Skipped when the marker file already exists (something else is managing the server).
- **Added** MCP mismatch warning: when `mcpPort` resolves to null but the marker file exists, the plugin emits a one-shot `console.warn` explaining the opted-out state and how to wire things up.
- **Improved** `scope()` is recognized by the path scanner, `__mask` injection, and the static-`on` lint — it sees the same reactive-accessor treatment as `branch`, `show`, `each`, `memo`.
- **Improved** Pass 2 mask injection: new lint variant fires when `scope.on` / `branch.on` reads no state (key never changes, subtree mounts once and never rebuilds). Usually a bug.

### `@llui/mcp@0.0.16`

- **Breaking** `LluiMcpServer.start()` removed — see top of release block.
- **Added** `@modelcontextprotocol/sdk` dependency. `LluiMcpServer` wraps the SDK's `Server` class; tool list/call handlers register via `setRequestHandler` with Zod-backed schemas. The hand-rolled JSON-RPC loop is gone.
- **Added** HTTP transport via SDK's `StreamableHTTPServerTransport`. `llui-mcp --http [port]` (default 5200) listens on `POST /mcp` for JSON-RPC requests, emits SSE-framed responses, and upgrades `/bridge` for the browser WebSocket relay — one port, dual protocol.
- **Added** `llui-mcp doctor` subcommand — offline diagnostic that walks the full failure-mode tree (marker presence, JSON validity, plugin devUrl stamping, bridge-port TCP connectability, recorded-pid liveness). Prints a ✓/✗ punch list; exits 0 on all-pass.
- **Added** `RelayUnavailableError` (exported) — thrown when a tool call needs the browser and no browser is attached. Carries a `diagnostic: BridgeDiagnostic` payload (connection status, bridge state, browser tabs, marker state, `suggestedFix` sentence). The `tools/call` handler surfaces it as an MCP `isError: true` tool result whose content is JSON-serialized diagnostic — callers see _why_ the call failed, not just that it did.
- **Added** `BridgeDiagnostic` type (exported from `@llui/mcp/transports`) for consumers building their own diagnostics UI.
- **Added** `LluiMcpServerOptions` shape — constructor now accepts `{ bridgePort?, attachTo? }` to share an `http.Server` with an externally-managed HTTP transport. Numeric-port constructor still works for backward compat.
- **Improved** `WebSocketRelayTransport` gains an `attachTo: http.Server` mode alongside the standalone `port` mode — HTTP-transport deployments share a single port for MCP + bridge via upgrade routing on `/bridge`.

### `@llui/{test,router,transitions,components,vike}@0.0.22`

- Rebuilt against the new `@llui/dom` version. No source changes.

### Docs

- `@llui/mcp` README documents both usage patterns (plugin-launched HTTP and manual stdio) with `.mcp.json` examples and a `doctor` troubleshooting section.
- Site API docs + llms-full.txt regenerated.

---

## 2026-04-18 — 0.0.21

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.21`; `@llui/mcp@0.0.15`

Big release. Lands the `scope()` + `sample()` primitives for keyed subtree rebuild, renames the internal `Scope` disposal concept to `Lifetime`, threads the `D` (init-data) generic through every public API, and closes every item from the dicerun2 feedback batch — path-scanner false positives, spread-in-children noise, bitmask diagnostic improvements, plus new plugin options for CI (`failOnWarning`, `disabledWarnings`). Three breaking changes in `@llui/dom`; mechanical migrations.

### Breaking

- **`@llui/dom@0.0.21`** — Internal `Scope` disposal-lifetime type renamed to `Lifetime`. The rename surfaces in two public places: the exported `ScopeNode` type becomes `LifetimeNode`, and `MountOptions.parentScope` becomes `MountOptions.parentLifetime`. The runtime itself, DOM output, disposal semantics, and the `_kind` strings on nodes are unchanged — this is a pure naming fix.
- **`@llui/dom@0.0.21`** — `branch.on` narrows from `string | number | boolean` to `string`. Numeric/boolean discriminants coerce at the call site (`on: s => String(s.code)` or `on: s => s.flag ? 'yes' : 'no'`). `branch.cases` becomes optional, and a new `default?: (h) => Node[]` field runs whenever no case matches — the canonical "dynamic rebuild" shape `branch({ on, default })` works without enumerated cases.
- **`@llui/dom,@llui/test@0.0.21`** — Every public API that takes a `ComponentDef` now threads the `D` (init-data) generic. Covers `mountApp`, `mountAtAnchor`, `hydrateApp`, `hydrateAtAnchor`, `renderToString`, `renderNodes`, `addressOf`, `replaceComponent`, `testComponent`, `testView`. Previously a typed-data component required an `as unknown as ComponentDef<S, M, E>` cast at each call site; that cast is no longer needed (and, for non-void D, no longer compiles without it).

### Migration

- Replace every `MountOptions.parentScope` with `parentLifetime`; same for any `ScopeNode` type import (→ `LifetimeNode`). The only consumer outside `@llui/dom` is `@llui/vike`'s layout chain, which this release updates.
- Wrap numeric/boolean `branch({ on })` in `String(...)` and keep case keys as stringified literals. If `cases` didn't cover every possible key, add a `default` builder — the new runtime will now fall back to it instead of rendering nothing.
- Remove `as unknown as ComponentDef<S, M, E>` casts from `mountApp(container, MyDef, data)` and `testComponent(MyDef, data)` call sites; the `D` generic now flows through. Regenerate types (`pnpm turbo check --force`) to confirm nothing else was papering over a real mismatch.

### `@llui/dom@0.0.21`

- **Added** `scope({ on, render })` — rebuilds a subtree when the string-valued key returned by `on(state)` changes. Each rebuild runs in a fresh `Lifetime` with fresh bindings and `onMount` callbacks. Sugar over `branch({ on, cases: {}, default: render })` with the `'scope-rebuild'` disposer cause. Replaces the "each + epoch + closure-captured snapshot" workaround for "rebuild this region when this counter changes" use cases.
- **Added** `sample(selector)` — one-shot imperative state read inside a render context. Available as a top-level `@llui/dom` import and as `h.sample(...)` on the `View` bag (destructure-friendly inside builders). No binding is created, no mask is assigned; ideal for reading a whole-state snapshot inside a `scope()` arm without making the entire subtree reactive.
- **Added** `branch.default` — fallback builder described under Breaking. With `cases` also now optional, `branch({ on: s => String(s.epoch), default: render })` is a valid dynamic-rebuild shape (though `scope()` is the preferred spelling).
- **Added** `ItemAccessor<T>.current()` — returns the whole current item. Fixes primitive-T ergonomics (where the mapped-field branch collapses to method names like `toString`) and lets object-T callers sample the full record without writing `item(r => r)()`.
- **Improved** `D` generic threaded through every public `ComponentDef`-taking API (see Breaking / Migration). Also cascades into `createComponentInstance` internally — `child()` and `lazy()` widen their pre-existing casts to carry the `D` slot.
- **Improved** `View.branch` / `View.scope` / `View.sample` available on the destructured `h` bag.
- **Fixed** `show()` wraps the boolean `when` via `String(...)` internally to match the new string-only `branch.on` — runtime semantics unchanged for user code.

### `@llui/vite-plugin@0.0.21`

- **Added** `failOnWarning` plugin option — routes every diagnostic through `this.error` instead of `this.warn` so lint regressions fail CI without a custom `build.rollupOptions.onwarn` handler.
- **Added** `disabledWarnings` plugin option — silences specific rules without disabling the lint pass. Every diagnostic is tagged with a `DiagnosticRule` (also exported); the tag appears in brackets at the start of each warning message (e.g. `[spread-in-children]`), so authors know what to pass.
- **Added** `scope` recognized by the path scanner and `__mask` injection — the `on` accessor's state paths contribute to the component bitmask, and Phase 1 reconcile is gated by the same mask machinery `branch`/`each`/`show`/`memo` already use.
- **Added** `static-on` lint — warns when `scope.on` or `branch.on` reads no state. The key never changes, so the subtree mounts once and never rebuilds; usually a bug.
- **Improved** Every diagnostic message is now prefixed with `<file>:<line>:<col>: [<rule>] ` — survives custom `onwarn` handlers that log `warning.message` alone.
- **Improved** Bitmask-overflow diagnostic does co-occurrence analysis — when every sub-path of a top-level field always fires in the same set of accessors, suggests reading the parent object as a single unit (one bit vs. N bits) before recommending `child()` extraction. Cheaper refactor, same budget relief.
- **Fixed** Spread-in-children is now scope-aware. Identifier spreads (`...foo`) and array-method spreads (`...foo.map(...)`, `.concat(...)`, etc.) resolving to bounded bindings — array literal, function-call result, or `.map` on a named bounded receiver — no longer fire. Inline `...[…].map(...)` still warns. Closes four concrete noise cases reported from dicerun2: conditional `push` into a local `Node[]`, `.map` over a `const x = […] as const` tuple, storing a helper-call result in a local first, and `.concat` on two named `Node[]` arrays.
- **Fixed** Path scanner unified between `collect-deps.ts` (runtime bit assignment) and `diagnostics.ts` (bitmask-overflow warning). The diagnostics side previously had its own naïve walker that produced false positives for `each({ key })`, `item((t) => t.field)`, array-method callbacks (`.some`, `.filter`, etc.) inside reactive accessors, and user-land helper properties like `sliceHandler({ narrow })`. All four are now silent.
- **Fixed** `onMsg` handlers no longer inflate the path bitmask via the same unified-scanner change.

### `@llui/test@0.0.21`

- **Added** `reducer({ init, update, name? })` — builds a view-less `ComponentDef` so reducer-only suites can drop a definition into `testComponent()` without padding a `view: () => []` field. Default name `__reducer__` surfaces in devtools/HMR if one ever leaks into a real mount.
- **Improved** `testComponent` and `testView` thread the `D` generic through (see Breaking). Typed init data passes without a cast.

### `@llui/vike@0.0.21`

- **Breaking** Consumes the `Lifetime` rename via `MountOptions.parentLifetime` — see top of release block.

### `@llui/mcp@0.0.15`

- **Breaking** Consumes the `Lifetime` rename via `LifetimeNode` — see top of release block.

### `@llui/{router,transitions,components}@0.0.21`

- Rebuilt against the new `@llui/dom` version. No source changes.

### Docs

- New design spec `docs/superpowers/specs/2026-04-18-scope-primitive-design.md` and matching plan under `docs/superpowers/plans/`.
- Cookbook recipe "Rebuild a subtree when a derived value changes" documents the canonical `scope() + sample()` pattern and deprecates the old `each + epoch + closure-snapshot` workaround.
- Site footer exposes `llms-full.txt` alongside `llms.txt` for discoverability.

---

## 2026-04-18 — 0.0.20

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.20`; `@llui/mcp@0.0.14`

Anchor-based mount primitives land in `@llui/dom`, enabling `@llui/vike`'s `pageSlot()` to emit a bare comment marker instead of a wrapper div. Also in `@llui/dom`: a new `unsafeHtml` primitive for rendering trusted HTML strings (markdown output, syntax-highlighted code, server snippets).

### Breaking

- **`@llui/vike@0.0.20`** — `pageSlot()` now emits `<!-- llui-page-slot -->` instead of `<div data-llui-page-slot="">`. Apps that styled or queried the slot element directly must wrap `pageSlot()` in their own styled element. The scope-tree behavior is unchanged.

### Migration

- If you were styling the page slot (e.g. `.page-slot { display: flex }` or `[data-llui-page-slot] { ... }`), move the styles to an enclosing element you add inside your layout view: `main([pageSlot()])`, `div({ class: 'page-slot' }, [...pageSlot()])`, etc.
- If you were querying the slot via `document.querySelector('[data-llui-page-slot]')`, switch to walking comment nodes (`TreeWalker(..., SHOW_COMMENT)`) or query your own wrapping element.

### `@llui/dom@0.0.20`

- **Added** `mountAtAnchor(anchor, def, data?, opts?)` and `hydrateAtAnchor(anchor, def, serverState, opts?)` — mount or hydrate a component relative to a comment anchor rather than inside a container element. Uses a synthesized end sentinel (`<!-- llui-mount-end -->`) to bracket the owned DOM region; dispose walks between the sentinels so top-level `each` / `show` / `branch` mutations within the component are always cleaned up correctly. Publicly exported — usable outside `@llui/vike` for anywhere you want to embed a reactive component at a comment anchor (e.g. inside rendered markdown).
- **Added** `unsafeHtml(html, mask?)` primitive — escape hatch for rendering trusted HTML strings into the DOM. Accepts a static string or a reactive accessor. The reactive path short-circuits on strict string equality so unchanged HTML preserves subtree identity (focus, selection, listeners attached outside LLui). Callers own sanitization — the parsed subtree is opaque to the framework (no nested bindings, events, or primitives). Wired into `View<S, M>` and `slice()`'s view bag.
- **Improved** `HmrEntry` becomes a discriminated union (`kind: 'container' | 'anchor'`) with a new `registerForAnchor` export. `replaceComponent` handles both kinds with appropriate DOM cleanup + insertion strategies, so hot-swap works for anchor-mounted instances without touching their outer DOM.
- **Improved** new `_removeBetween` and `_findEndSentinel` helpers in `mount.ts`. Both guard a null `parentNode` defensively so a detached anchor at dispose time is a no-op rather than a thrown `TypeError`.

### `@llui/vike@0.0.20`

- **Breaking** `pageSlot()` emits a comment anchor. See top of release block.
- **Improved** SSR stitching in `on-render-html.ts` uses `insertBefore` relative to the anchor plus a synthesized end sentinel per layer, replacing the old `appendChild`-into-marker approach.
- **Improved** client adapter in `on-render-client.ts` dispatches between `hydrateApp`/`mountApp` (root container) and `hydrateAtAnchor`/`mountAtAnchor` (inner anchors) based on node kind. Nav swaps rely on per-layer `handle.dispose()` for region cleanup instead of the old top-down `leaveTarget.textContent = ''`.
- **Improved** exports `_renderChain` and `_mountChainSuffix` `@internal` for direct testing.

### `@llui/{vite-plugin,test,router,transitions,components}@0.0.20`

- **Added** cascade bump — no user-visible changes; picks up the new `@llui/dom@0.0.20` peerDependency range.

### `@llui/mcp@0.0.14`

- **Added** cascade bump — no direct changes. Picks up `@llui/dom@0.0.20` via workspace resolution.

## 2026-04-17 — 0.0.19

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.19`; `@llui/effects@0.0.9`; `@llui/mcp@0.0.13`

Phase 1 of the MCP debug-API expansion lands: 21 new MCP tools, 16 new `LluiDebugAPI` methods, four dev-mode runtime trackers in `@llui/dom`, and a dev-only effect interceptor hook in `@llui/effects`. Plus three correctness fixes carried along from parallel work on `child()`, per-case mask analysis, and Vike page context typing.

### `@llui/dom@0.0.19`

- **Added** 16 new `LluiDebugAPI` methods, populated on `installDevTools`:
  - DOM: `inspectElement`, `getRenderedHtml`, `dispatchDomEvent`, `getFocus`
  - Bindings/scope: `forceRerender`, `getEachDiff`, `getScopeTree`, `getDisposerLog`, `getBindingGraph`
  - Effects: `getPendingEffects`, `getEffectTimeline`, `mockEffect`, `resolveEffect`
  - Time-travel/utility: `stepBack`, `getCoverage`
  - Eval: `evalInPage` (runs user JS via `new Function()` with an observability envelope — state diff, new history entries, new pending effects, dirty bindings).
- **Added** four dev-mode ring-buffer trackers: each-diff log (100), disposer log (500), effect timeline (500), Msg coverage. All zero-cost in production — populated only when `installDevTools` runs, gated on a module-level flag.
- **Added** scope `_kind` tagging (`root | show | each | branch | child | portal | foreign`) set by each structural primitive at creation; reset on pool recycle. Powers `getScopeTree`'s classification without a separate lookup.
- **Added** new exported types: `ElementReport`, `ScopeNode`, `EachDiff`, `DisposerEvent`, `PendingEffect`, `EffectTimelineEntry`, `EffectMatch`, `StateDiff`, `CoverageSnapshot`, `MessageRecord`.
- **Added** `kind='effect'` binding variant for side-effect-only watchers. `applyBinding` is a typed no-op; Phase 2 runs the accessor without diffing or writing `lastValue`. Used internally by `child()`'s prop-watch binding, eliminating per-tick object stringification onto a detached anchor.
- **Fixed** `child()` propsMsg loop vector. Framework-synthesized propsMsg messages now dispatch through `originalSend`, bypassing the `onMsg` wrapper — a naive `onMsg: m => echo(m)` no longer bounces props/set back to the parent and loops forever.
- **Improved** mocked effects auto-deliver their response via the effect's own `onSuccess` callback on a microtask (same timing contract as a real async resolve), making `llui_mock_effect` usable as a testing primitive.

### `@llui/effects@0.0.9`

- **Added** `_setEffectInterceptor(hook | null)` dev-only hook. Zero-cost in production — one null check per dispatch; no allocation when the hook is null. Reserved for Phase 2 (Worker / off-loop effect interception); Phase 1 `@llui/dom` intercepts upstream at the update loop, so Phase 1 callers of the hook won't see invocations. Documented in JSDoc.

### `@llui/vite-plugin@0.0.19`

- **Added** MCP marker file now carries an optional `devUrl` field. The plugin stamps the dev URL when Vite's HTTP server starts listening; marker updates handle both orderings (MCP-before-Vite and MCP-after-Vite). The `llui:mcp-ready` HMR event broadcasts the full marker so the browser relay doesn't depend on `fs.watch` side-effects.
- **Added** diagnostic that warns when a `child()` `props` accessor returns an object literal whose values are themselves freshly-constructed object/array literals. Prop diffing compares top-level keys by `Object.is` — a fresh reference reports "changed" every render, firing `propsMsg` on every parent update.
- **Fixed** `analyzeModifiedFields` now bails out on `SpreadAssignment`s whose source isn't the state parameter (e.g. `...msg.props`). The previous code treated every spread as a noop, which produced narrow `caseDirty` masks excluding fields the spread actually overwrites. Symptom: stale DOM on props/set after a spread-based reducer. `show()` reconcile seemed to work only because mounting a fresh arm created new bindings that happened to read current state.

### `@llui/mcp@0.0.13`

- **Added** 21 new MCP tools routed through a new `ToolRegistry` with layer-tag dispatch (`debug-api | cdp | source | compiler`):
  - View/DOM (5): `llui_inspect_element`, `llui_get_rendered_html`, `llui_dom_diff`, `llui_dispatch_event`, `llui_get_focus`
  - Bindings/scope (6): `llui_force_rerender`, `llui_each_diff`, `llui_scope_tree`, `llui_disposer_log`, `llui_list_dead_bindings`, `llui_binding_graph`
  - Effects (4): `llui_pending_effects`, `llui_effect_timeline`, `llui_mock_effect`, `llui_resolve_effect`
  - Time-travel/utility (5): `llui_step_back`, `llui_coverage`, `llui_diff_state`, `llui_assert`, `llui_search_history`
  - Eval (1): `llui_eval`
- **Improved** internal layout: `packages/mcp/src/index.ts` shrinks from 747 → ~244 lines. Tool handlers live in `tools/debug-api.ts`; WebSocket relay lives in `transports/relay.ts` as `WebSocketRelayTransport implements RelayTransport`. Same public API (`LluiMcpServer`, `connectDirect`, `handleToolCall`).
- **Added** `setDevUrl(url)` on `LluiMcpServer`. Extends the marker write so CDP-fallback consumers (Phase 2) can find the dev URL.

### `@llui/vike@0.0.19`

- **Fixed** `pageContext.data` now honors `Vike.PageContext` augmentations. The server and client hook interfaces previously declared `data?: unknown` inline, so consumer augmentations of Vike's global namespace never reached the hook callbacks — every `document({ pageContext })` / nav callback had to cast. A conditional lookup on `Vike.PageContext` resolves to `unknown` when unaugmented and to the user's type when declared. An ambient stub of the `Vike` namespace lets the package type-check standalone and merge cleanly when `vike` is installed alongside.

### `@llui/{test,router,transitions,components}@0.0.19`

- **Added** cascade bump — no user-visible changes; picks up the new `@llui/dom@0.0.19` peerDependency range.

### Docs

- `packages/mcp/README.md`, `site/content/api/mcp.md`, `site/content/cookbook.md`, `site/content/llm-guide.md`, `CLAUDE.md`, `docs/designs/07 LLM Friendliness.md`, `docs/designs/09 API Reference.md` all updated with Phase 1 additions (tool tables, API types, browser console examples, package row).

## 2026-04-15 — 0.0.18

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.18`; `@llui/mcp@0.0.12`

Hotfix release for a compiler regression in 0.0.17 that silently broke form-error rendering inside child components whose view factored structural blocks into helper functions. Anyone running 0.0.17 against `@llui/components`'s `dialog.overlay` with a form body inside should upgrade.

### Migration

- **Delete any `stripFastPath`-style workaround** that strips `__update` / `__dirty` / `__handlers` from concrete `ComponentDef`s before passing them to `child({ def })`. The compiler fast path is now correct — pass the concrete def directly.
- **Delete any `widenDef`-style wrapper** still in use at a `child({ def })` boundary. 0.0.17's `AnyComponentDef` alias already made the wrapper unnecessary for typing; 0.0.18 removes the runtime reason it was accidentally helping (it was stripping the broken fast path, not widening).

### `@llui/vite-plugin@0.0.18`

- **Fixed** `detectArrayOp` no longer short-circuits structural reconcile when a case's `caseDirty` doesn't intersect the computed `structuralMask`. The optimization was unsafe because `computeStructuralMask` only walks the view function's lexical AST — it does not descend into helper function calls. A view like `view: () => [...show({ when: s => s.mode === 'signin', render: () => [signinFormBody(send)] })]` where `signinFormBody(send)` internally does `...show({ when: s => s.errors.email !== undefined, ... })` produces a `structuralMask` that contains the `mode` bit but misses `errors.email`. The submit case's `caseDirty` then had no overlap with `structuralMask` even though the inner show block's mask DOES depend on `errors`, and the compiler emitted `method = -1` ("skip structural blocks") for the submit handler. At runtime `_handleMsg` skipped Phase 1 entirely, the helper-hidden show blocks never reconciled, and error paragraphs never mounted despite state having changed. The symptom was "submit button click doesn't show validation errors" — reproducible against any component that factors its form body into a helper function. Fixed by removing the unsafe short-circuit. Non-empty cases now always fall through to `'general'` (`method = 0`) unless an explicit array op (clear/remove/mutate/strided) is detected. Phase 1 runs unconditionally; `_handleMsg`'s existing per-block `(block.mask & dirty)` check filters uninterested blocks at near-zero cost. The `modifiedFields.length === 0` short-circuit is preserved — a case that returns `[state, []]` unchanged is a real tautology and still emits `method = -1`. Regression tests in `packages/vite-plugin/test/show-helper-reconcile.test.ts` cover the helper-hidden shape, a minimal cross-function mode+errors variant, and the preserved noop tautology.

### `@llui/dom@0.0.18`

- **Improved** `useContextValue` docstring now has a dedicated "Value capture contract" section spelling out that the returned value is captured once at view-construction time. Storing the return in a closure inside `view()` and reading from event handlers is the correct and efficient pattern for stable dispatcher bags; consumers that need to see later re-publishes from a parent must use the reactive `useContext(ctx)` form. The docstring also documents the pairing rule: `useContextValue` must be used with `provideValue` on the producer side; using it against a state-reading provider will pass `undefined` to the accessor and likely throw or return garbage.

### `@llui/{test,router,transitions,components,vike}@0.0.18`

- **Improved** Cascade bump from `@llui/dom@0.0.18` (tier-1 lockstep). No direct code changes — same contracts as 0.0.17. `components`, `router`, and `transitions` also have their `peerDependencies["@llui/dom"]` range updated from `^0.0.17` to `^0.0.18`.

### `@llui/mcp@0.0.12`

- **Improved** Cascade bump from `@llui/dom@0.0.18` runtime dependency. No direct code changes — same contracts as 0.0.11.

### Docs

- **Improved** Cookbook "Persistent Layouts → Layout ↔ Page communication" recipe now documents the `useContextValue` capture contract inline — when to reach for it vs the reactive `useContext` form.
- **Improved** LLM guide rules bullet extended with the capture contract note so LLMs picking up the context-dispatcher pattern from the guide see the warning.

## 2026-04-15 — 0.0.17

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.17`; `@llui/mcp@0.0.11`

Follow-up release for four reports against 0.0.16's persistent-layout work. Covers a functional gap (no prop updates on surviving layers), a type-system ergonomics issue (`widenDef` invariance across three APIs), a docs filename collision (`+Layout.ts` vs Vike's own convention), and an API shape wart (`useContext` awkward for static dispatcher bags).

### Migration

- **Revert any `widenDef`-style helper** you wrote to pass a concrete `ComponentDef<S, M, E, D>` into `child({ def })`, `createOnRenderClient({ Layout })`, or `createOnRenderHtml({ Layout })`. Concrete component definitions now assign structurally into these APIs via the new `AnyComponentDef` alias — no widening needed.
- **Revert any module-level pub/sub bridge** you wrote to deliver nav data into a persistent layout. `createOnRenderClient` now pushes fresh `lluiLayoutData[i]` into surviving layers through their `propsMsg` handler on every nav — opt in by setting `propsMsg: (data) => ({ type: 'navChanged', data })` on the layout def.
- **Consider switching static dispatcher-bag contexts** from the reactive `provide(ctx, accessor, children)` / `useContext(ctx)` pair to the new `provideValue(ctx, value, children)` / `useContextValue(ctx)` forms. Call sites become `useContextValue(ctx).method(...)` instead of `useContext(ctx)(undefined as never).method(...)`. The reactive forms still exist for context values that track state.
- **Rename any layout file called `+Layout.ts`** (per the previous release's docs) to `Layout.ts` or similar — the `+` prefix is Vike's own framework-adapter convention and collides with `@llui/vike`'s `Layout` option.

### `@llui/vike@0.0.17`

- **Fixed** Surviving layers on client nav now receive fresh `lluiLayoutData[i]` through their `propsMsg` handler. Previously the chain diff identified which layers to keep alive but never delivered the updated data slice — a persistent layout tracking pathname, session, breadcrumbs, or nav-highlight state was frozen at whatever it initialized with on first mount. The adapter now walks the shared prefix after the diff, shallow-key `Object.is`-diffs each surviving layer's new data against its stored slice, and dispatches the layer's `propsMsg(newData)` result through the new `AppHandle.send` channel on change. Layers without `propsMsg` are skipped silently — opt-in. Mirrors `child()`'s prop-diff and dispatch behavior exactly.
- **Fixed** `createOnRenderClient({ Layout })` and `createOnRenderHtml({ Layout })` now accept concrete `ComponentDef<S, M, E, D>` without a widening helper. Previously the `Layout` option was typed as `ComponentDef<unknown, unknown, unknown, unknown>`, which uses property syntax and is contravariant in each type parameter — concrete definitions were rejected with "Type 'void' is not assignable to type 'unknown'" on the `init` field. The option is now typed as `AnyComponentDef` (a new type-erased alias exported from `@llui/dom` using method syntax for bivariance) so structural assignment succeeds without any `widenDef` wrapper. `ChildOptions.def` uses the same alias — the same gap in `child({ def })` is fixed by the same change.
- **Improved** Docs no longer recommend `pages/+Layout.ts` as the layout filename. Vike reserves the `+` prefix for its own framework-adapter config conventions, and `+Layout.ts` specifically is interpreted by `vike-react` / `vike-vue` / `vike-solid` as a framework-native layout config — collides with `@llui/vike`'s `Layout` option. All JSDoc examples, the README, cookbook recipe, LLM guide, and `pageSlot()` primitive doc now show `pages/Layout.ts` (no prefix) with an explicit warning paragraph explaining why.

### `@llui/dom@0.0.17`

- **Added** `AnyComponentDef` exported from `@llui/dom` (and from `@llui/dom/internal` for framework adapters). A type-erased component-definition shape using method syntax for bivariance — concrete `ComponentDef<S, M, E, D>`s assign structurally without any widening helper. Used by `child()`, `createOnRenderClient({ Layout })`, and `createOnRenderHtml({ Layout })` as the consumer-facing type for opaque component definitions at module boundaries. The existing `LazyDef<D>` (used by `lazy()`) remains parameterized on `D` for the lazy-loader case.
- **Added** `AppHandle.send(msg)` exposes the mounted instance's send channel through the handle object, allowing adapter-level code to dispatch messages into long-lived instances from outside their normal view-bound `send` path. No-op after `dispose()`. Used by `@llui/vike`'s persistent-layout chain to push layout-data updates into surviving layer instances on client navigation. `mountApp`, `hydrateApp`, and `hmr.replaceComponent` all populate the new method; existing consumers that only use `dispose()` and `flush()` are unaffected.
- **Added** `provideValue<T>(ctx, value, children)` and `useContextValue<T>(ctx)` as static-bag companions to the existing reactive `provide` / `useContext` primitives. For the common case of publishing a stable dispatcher record (toast queues, session managers, DI containers — anything that doesn't depend on parent state), `provideValue` wraps the value in a constant accessor and `useContextValue` resolves it with a single function call. Replaces the `useContext(ctx)(undefined as never).method(...)` pattern with `useContextValue(ctx).method(...)`. The reactive primitives still exist and are still the right call when the context value DOES need to track state.

### `@llui/{vite-plugin,test,router,transitions,components}@0.0.17`

- **Improved** Cascade bump from `@llui/dom@0.0.17` (tier-1 lockstep). No direct code changes — same contracts as 0.0.16. `components`, `router`, and `transitions` also have their `peerDependencies["@llui/dom"]` range updated from `^0.0.16` to `^0.0.17`.

### `@llui/mcp@0.0.11`

- **Improved** Cascade bump from `@llui/dom@0.0.17` runtime dependency. No direct code changes — same contracts as 0.0.10.

### Docs

- **Added** Doc updates across the `@llui/vike` README, cookbook "Persistent Layouts" recipe, LLM guide section + rules bullet: everything shows `provideValue` / `useContextValue` for the layout-owned dispatcher pattern, uses `pages/Layout.ts` as the filename with an explicit warning against `+Layout.ts`, and the cookbook + llm-guide spell out when to reach for the static-bag primitives vs the reactive ones.
- **Improved** `examples/vike-layout` switched both `ToastContext` and `SessionContext` to `provideValue` + `useContextValue`. Dropped `SessionDispatcher.getUser` from the contexts module with a note explaining why — context accessors can't reach across instance boundaries to read live layout state, so exposing a state-reader dispatcher from a layout context was always subtly broken.
- **Improved** `scripts/publish.sh` now runs `pnpm whoami` as an auth preflight and auto-runs `pnpm login` interactively when the token is expired or missing. Previously a stale token produced nine consecutive `E404` errors (npm returns 404 on PUT for unauthenticated writers to avoid leaking scope existence) which was confusing if you didn't know the pattern. Not a package change — only visible to maintainers running publish.

## 2026-04-15 — 0.0.16

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.16`; `@llui/mcp@0.0.10`; `@llui/lint-idiomatic@0.0.12`

Headline: **persistent layouts** in `@llui/vike`. Declare app chrome (header, sidebar, session state, portalled dialogs) as a `Layout` component that stays mounted across client navigation — only the route's page disposes and re-mounts. Nested layout chains and per-route chain resolvers both supported from day one. Plus the supporting runtime primitives in `@llui/dom`, a compiler walker fix, and two lint-rule false-positive fixes.

### `@llui/vike@0.0.16`

- **Added** `Layout` option on `createOnRenderClient` / `createOnRenderHtml`. Accepts a single `ComponentDef`, an array `[outer, ..., inner]` for nested chains, or a `(pageContext) => chain` function for per-route resolution. Persistent layouts stay mounted across client nav; only the divergent suffix of the chain disposes and re-mounts. Outer-layer DOM — and every portal, focus trap, scroll position, and effect subscription rooted inside it — survives page swaps.
- **Added** `pageSlot()` primitive (exported from `@llui/vike/client`) — a declarative structural marker a layout places in its view to declare where the nested Page or nested Layout renders. Creates its scope as a child of the current render scope so contexts flow from layout providers through the slot into the page via standard `useContext` lookups. Call exactly once per layout; layouts with zero or two-plus slots throw with descriptive errors.
- **Added** Chain diff on nav walks old and new chains in parallel by component identity and preserves every shared prefix layer. Navigating between `/dashboard/reports` and `/dashboard/overview` disposes only the innermost `Page`; navigating from `/dashboard/*` to `/settings` collapses the chain to `[AppLayout]`. Per-route resolvers enable this cleanly.
- **Added** Chain-aware hydration envelope: `window.__LLUI_STATE__` is now `{ layouts: [{ name, state }, ...], page: { name, state } }` for layout-using pages. Entries carry the component name so server/client chain mismatches fail loud with a clear error instead of silently binding wrong state to wrong instance. The legacy flat envelope shape is still read for pages without a configured `Layout` — no migration required for existing apps.
- **Added** Regression tests covering single-layout mount + nav, nested 3-layer chains, context flow through the slot, chain diffing with per-route resolvers, SSR composed rendering, and error paths (missing `pageSlot` in a layout, `pageSlot` called from the innermost page). 10 tests in `packages/vike/test/layout.test.ts`.

### `@llui/dom@0.0.16`

- **Added** `MountOptions.parentScope` on `mountApp` / `hydrateApp` — when provided, the mounted instance's `rootScope` becomes a child of that scope. This is the keystone that makes persistent layouts compose: `@llui/vike`'s `pageSlot()` uses it to parent a page instance into its enclosing layout's scope tree, so `useContext` lookups walk layer boundaries and scope disposal cascades in the right direction on nav.
- **Added** `@llui/dom/internal` subpath export. Surfaces low-level primitives (`getRenderContext`, `setRenderContext`, `clearRenderContext`, `createScope`, `disposeScope`, `addDisposer`) for framework-adapter packages that need to build structural primitives like `pageSlot()` on top of the runtime. Not part of the public app-author API — stability contract applies only to the main `@llui/dom` barrel.
- **Added** `renderNodes` and `serializeNodes` factored out of `renderToString`. Chain renders (e.g. `@llui/vike/server`'s layout-composed SSR) can now render multiple instances, append their outputs into each other's slot markers, and serialize the composed tree once with the union of every layer's bindings. `renderToString` is a trivial one-liner on top and its public contract is unchanged.
- **Fixed** `elSplit` children now flatten nested arrays one level, matching `createElement`'s existing behavior. Patterns like `main([helperReturningNodeArray()])` worked in unit tests (raw path flattens) but silently crashed at SSR build time because the compiled path didn't. Both paths now agree — catches this class of test-vs-production mismatch permanently.

### `@llui/vite-plugin@0.0.16`

- **Fixed** `computeAccessorMask`'s AST walker no longer crashes on chained method calls inside template literals inside reactive accessors. Previously a pattern like `text((_s) => \`$${item.x.toLocaleString()}\`)`inside an`each()`row crashed the whole build with "Cannot read properties of undefined (reading 'kind')" — the row-factory rewrite synthesizes new sub-trees whose inner`PropertyAccessExpression`nodes have no parent pointers, and the walker's`ts.isPropertyAccessExpression(node.parent)`crashed on undefined. Guarded every parent access in the walker; mask accounting is unchanged because resolving a chain from an inner PAE produces a prefix of the outer chain (idempotent`|=`). Regression tests in `accessor-walker-parent.test.ts`.

### `@llui/lint-idiomatic@0.0.12`

- **Fixed** `state-mutation` rule's "Increment/decrement on state" check no longer flags all prefix and postfix unary operators on state access — only `++` and `--` count as mutations. Before the fix, the canonical toggle reducer `return [{ ...state, flag: !state.flag }, []]` was flagged as a mutation because `!` is a prefix unary operator; `-state.x`, `~state.x`, `+state.x` were caught the same way.
- **Fixed** `spread-in-children` rule now exempts `provide` and `pageSlot` alongside the existing structural-primitive exemptions (`each`, `show`, `branch`, `virtualEach`, `onMount`). Both return `Node[]` and must be spread, and the rule was tripping on every layout authoring pattern that placed a context provider or page slot inside an element-helper children array.
- **Fixed** `@llui/lint-idiomatic/vite` plugin now reads source from disk via `readFileSync(id)` inside the transform hook instead of trusting the pipeline `code` argument. Before the fix, `enforce: 'post'` meant the plugin was linting the AST AFTER `@llui/vite-plugin` had rewritten component bodies — compiler-generated row-updater `++` / `--` loops triggered false-positive `state-mutation` warnings that didn't correspond to anything in user source. Reading from disk guarantees we only ever see what the author wrote.

### `@llui/mcp@0.0.10`

- **Improved** Cascade bump from `@llui/dom@0.0.16` and `@llui/lint-idiomatic@0.0.12` runtime dependencies. No direct code changes — same contracts as 0.0.9.

### `@llui/{test,router,transitions,components}@0.0.16`

- **Improved** Cascade bump from `@llui/dom@0.0.16` (tier-1 lockstep). No direct code changes — same contracts as 0.0.15. `components`, `router`, and `transitions` also have their `peerDependencies["@llui/dom"]` range updated from `^0.0.15` to `^0.0.16`.

### Docs

- **Added** New "Persistent Layouts" + "Layout → Page communication via context" recipes in the cookbook under the SSR section.
- **Added** New "Persistent layouts (@llui/vike)" section in the LLM guide with the canonical shape and a new rules bullet so LLMs reach for `pageSlot()` as the idiom.
- **Added** New "Cross-instance scope parenting" subsection in the architecture doc explaining how `parentScope` + `pageSlot()` make context flow layer → layer and how disposal cascades asymmetrically on nav.
- **Added** New `examples/vike-layout` workspace — full working example with root layout (toast stack + session context dispatchers from layout state), nested dashboard layout with sidebar, four routes exercising different chain shapes, per-route chain resolver. All four routes prerender via Vike SSG.

## 2026-04-14 — 0.0.15

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.15`; `@llui/mcp@0.0.9`

Addresses two production reports against `@llui/vike` + `@llui/transitions` page routing, and bakes the browser-e2e test back into the default `pnpm verify` pipeline.

### `@llui/vike@0.0.15`

- **Added** `RenderClientOptions.onLeave(el)` — awaited before dispose, so leave animations can run against the outgoing page's still-mounted DOM. Return a promise to defer the dispose-and-mount swap until the animation finishes.
- **Added** `RenderClientOptions.onEnter(el)` — fires after the new page mounts, for enter animations. Sync; promise returns are ignored. Neither hook fires on the initial hydration render.
- **Added** `fromTransition(t)` adapter — converts any `TransitionOptions` (the shape returned by `routeTransition`, `fade`, `slide`, etc. from `@llui/transitions`) into the `{ onLeave, onEnter }` pair, so wiring route transitions into Vike filesystem routing is one line: `createOnRenderClient({ ...fromTransition(routeTransition({ duration: 200 })) })`.
- **Improved** README documents the full client-navigation lifecycle: `onLeave` → `dispose` → `textContent = ''` → `mountApp` → `onEnter` → `onMount`, with notes on `AbortSignal` semantics for in-flight effects (the signal gates `send()` dispatches but does not cancel in-flight network requests — intentional, avoids losing a successful POST on nav) and scroll handling (Vike's problem via `scrollToTop`, not ours).

### `@llui/transitions@0.0.15`

- **Improved** `routeTransition()` JSDoc now documents both call sites: manual `branch()`-based routing (spread `{ enter, leave }` into the branch call) and `@llui/vike` filesystem routing (wrap via `fromTransition` from `@llui/vike/client`). Previous wording implied the primary path was `branch()` and left Vike users reaching for a helper with nowhere to plug it in.

### `@llui/components@0.0.15`

- **Added** `dialog-dispose.test.ts` regression test: asserts that disposing a mounted app with an open `dialog.overlay` leaves `document.body` clean — no leftover portal content, focus-trap stack empty, body scroll lock count zero, sibling `aria-hidden` / `inert` restored, idempotent on second `dispose()`. Empirically confirms the scope-disposer chain correctly tears down overlay state when `@llui/vike` clears a page during client navigation.

### `@llui/vite-plugin@0.0.15`

- **Fixed** `test/mcp-watch.test.ts` was leaking `fs.watch` handles on the marker directory's parent on every `setup()` call. Over ~200 test invocations the accumulated handles hit macOS's EMFILE cap and sporadically crashed other tests running in parallel. Track active fake servers per test and fire their registered `close` handlers in `afterEach` so the plugin's cleanup path runs.

### `@llui/mcp@0.0.9`

- **Fixed** `test/playwright-e2e.test.ts` reworked to use vite's programmatic `createServer` API with `server.watch: null` and `optimizeDeps.noDiscovery: true`. The previous `spawn('pnpm', ['dev'])` path was unreliable on macOS: vite's default chokidar watcher tries to register directory watches across the whole monorepo at startup and blows through the launchctl-default 256-fd soft limit before printing its ready message, surfacing as a spurious `vite startup timeout` that had broken this suite on every developer machine since it landed.
- **Fixed** Narrowly-scoped `process.on('uncaughtException')` filter installed during the suite swallows only `{ code: 'EMFILE', syscall: 'watch' }` errors originating from vite's `watchPackageDataPlugin`, which registers `fs.watch` on every `package.json` regardless of `server.watch`. Legit exceptions still propagate; the filter is removed in `afterAll`.
- **Improved** Suite is re-included in the default `pnpm verify` pipeline — runs in ~3s against a real Vite dev server and a real Chromium browser. The earlier `LLUI_RUN_E2E` opt-in flag is gone; `loadPlaywright()` probes `playwright.chromium.executablePath()` + `existsSync` so fresh checkouts (before `pnpm install`) and CI jobs without Chromium installed still skip the suite cleanly.
- **Added** `pnpm test:e2e` root script — shortcut for `pnpm --filter @llui/mcp test` when iterating on the browser-integration suite.

### CI

- **Added** Playwright Chromium install + cache step in `.github/workflows/ci.yml`. Cache keyed on `pnpm-lock.yaml`, stored at `~/.cache/ms-playwright`. Cold install is ~30s with `--with-deps`; cache hits run `install-deps chromium` only to refresh system libraries.

## 2026-04-14 — 0.0.14

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.14`; `@llui/{effects,mcp}@0.0.8`; `@llui/lint-idiomatic@0.0.11`

Ten production-sourced bug fixes spanning SSR, the compiler, structural reconciliation, runtime timing, and published build output.

### Breaking

- **`@llui/vite-plugin@0.0.14`** — `mcpPort` is now opt-in. Default is `null`. The `/__llui_mcp_status` middleware and WebSocket companion process are only installed when `mcpPort` is passed explicitly. If you were relying on MCP in dev, add `{ mcpPort: 5200 }` (or any port) to your `llui()` call in `vite.config.ts`. Fixes 404 noise in dev logs for apps that don't use MCP.

### Migration

- If you worked around the `show()` source-order bug by reordering sibling branches, you can revert that change — the original source order now works correctly.
- If you worked around the hoisted `class:` accessor bug by inlining the arrow or using a module-level variable, you can revert to the hoisted-`const`-arrow form.
- If you were using MCP in dev, add `{ mcpPort: <port> }` to `llui()` in `vite.config.ts` — the default is now opt-out rather than opt-in.

### `@llui/dom@0.0.14`

- **Fixed** `show()` / `branch()` block source-order reconciliation. Nested structural blocks were landing _before_ their parent in the flat `inst.structuralBlocks` array because every structural primitive did `blocks.push(block)` _after_ running its builder. When a parent reconciled and disposed nested children, the array collapsed mid-iteration and subsequent sibling blocks could be skipped entirely — a sibling `show()` placed after a form would silently fail to mount. All structural primitives (`branch`, `each`, `virtualEach`) now push their block _before_ running the builder, so parents always precede nested children. Parents now also reconcile before children, avoiding wasted work on subtrees the parent is about to unmount.
- **Fixed** `hydrateApp` dropped `init`-time effects. It was short-circuiting `init()` to reuse `serverState`, silently discarding any effects `init()` returned — so HTTP fetches, subscriptions, and timers never fired on the client after hydration. `hydrateApp` now runs the original `init()` purely to extract its effect list, discards the returned state, and dispatches those effects after mount.
- **Fixed** `elSplit` crashed on raw string children. The children parameter was typed `Node[]` but callers pass mixed `(Node | string)[]` arrays from template helpers. In jsdom (SSR), passing a raw string to `appendChild` throws. `elSplit` now accepts `Array<Node | string>` and wraps strings in `document.createTextNode(...)`.
- **Fixed** `onMount` microtask race. Callbacks were deferred via `queueMicrotask`, which meant a synchronous `dispatchEvent` fired immediately after mount (or a `branch()` case swap) could reach the DOM before the listener registered inside `onMount` had attached. `mountApp`, `hydrateApp`, and `branch()`'s reconcile path now push an `onMount` queue and flush it **synchronously** after new nodes are inserted. The `queueMicrotask` fallback still exists for callbacks registered outside any active mount cycle.
- **Improved** `getRenderContext` error message now enumerates the three common causes when a primitive is called outside a `view()` render context: (1) module-scope primitive calls, (2) module-scope overlay helpers like `dialog.overlay` / `popover.overlay` (which internally use `show()` / `branch()`), (3) primitives called from `setTimeout` / `Promise.then` / async event handlers.
- **Improved** `applyBinding` defensive guard. Throws a `TypeError` the moment any function value reaches the DOM-write layer, naming the binding kind, key, and a source snippet of the offending function. Catches future compiler paths that might leak a function value past the binding emitter.

### `@llui/vite-plugin@0.0.14`

- **Breaking** `mcpPort` is now opt-in. See top of release block.
- **Fixed** hoisted `class:` accessor miscompile. A reactive attribute whose value was an `Identifier` resolving to a `const`-bound arrow (e.g. `const cls = (s) => ...; a({ class: cls })`) compiled to `__e.className = cls` in the static setup, coercing the function to its source string at runtime and producing `<a class="(s) => ...">` in the DOM with no binding wired. The compiler now resolves local `const`-bound arrow identifiers to their initializer and emits a reactive binding identical to the inline-arrow form. Applies to both the `elSplit` split pass and the `elTemplate` subtree-collapse pass. Affects `class`, `style`, attribute, and reactive DOM-property accessors. Event handlers were never affected.
- **Fixed** per-item heuristic scope leak. `isPerItemFieldAccess` was detecting any `item.field` expression as a per-item binding candidate, regardless of whether `item` actually referred to an `each()` render-callback parameter. A plain `arr.map((item) => ...)` outside `each()` would produce a broken binding tuple and crash at runtime. The heuristic now walks up the AST and verifies `item` is bound as a parameter of an `each({ render })` callback, handling destructured and renamed bindings.

### All packages — build output

- **Fixed** ESM imports missing `.js` extensions. `moduleResolution: bundler` was stripping `.js` extensions from emitted `import`/`export` statements, breaking strict Node ESM consumers. A new `scripts/add-js-extensions.mjs` pass rewrites all relative imports during publish — 578 edits across 208 source files in all 10 packages. Published tarballs now resolve cleanly under Node's strict ESM loader.
- **Fixed** sourcemaps referenced missing `.ts` files. Published `.map` files referenced `../src/*.ts` paths not shipped in the tarball, breaking source-map debugging for downstream consumers. All 10 `tsconfig.build.json` files now set `inlineSources: true`, embedding the full TypeScript source inline via `sourcesContent`. Sourcemaps are self-contained.

## 2026-04-13 — @llui/lint-idiomatic@0.0.10, @llui/mcp@0.0.7

**Released:** `@llui/lint-idiomatic@0.0.10`; `@llui/mcp@0.0.7`

### `@llui/mcp@0.0.7`

- **Added** `llui_lint` tool; llm-guide reframed for the dual API.

### `@llui/lint-idiomatic@0.0.10`

- **Improved** Tightened rule set, fixed example snippets, adopted across all in-repo projects.

## 2026-04-13 — @llui/lint-idiomatic@0.0.9

**Released:** `@llui/lint-idiomatic@0.0.9`

### `@llui/lint-idiomatic@0.0.9`

- **Added** Ship as a Vite plugin via a `/vite` subpath export.
- **Improved** Publish flow uses `pnpm publish` and restores `workspace:*` in runtime deps.

## 2026-04-12 — 0.0.13

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.13`; `@llui/mcp@0.0.6`

### `@llui/mcp@0.0.6`

- **Added** Auto-connect MCP relay via Vite middleware + file marker; promoted auto-connect e2e to vitest CI.

### `@llui/dom@0.0.13`

- **Added** Bitmask diagnostic surfaced through MCP; `childHandlers` migration landed end-to-end.

## 2026-04-11 — 0.0.12

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.12`

### `@llui/dom@0.0.12`

- **Added** On-demand MCP relay with devtools documentation.
- **Added** `ChildState` / `ChildMsg` type utilities and `childHandlers` runtime.

### Docs

- **Improved** New cookbook recipes for `slice`, `selector`, `lazy`, `virtualEach`, and `sortable`.

## 2026-04-11 — 0.0.11

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.11`

### `@llui/dom@0.0.11`

- **Added** `sliceHandler` shorthand for child update wiring.
- **Improved** Clearer error messages across the runtime.

## 2026-04-11 — 0.0.10

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.10`

### `@llui/dom@0.0.10`

- **Added** `LazyDef<D>` type eliminates user-side casts when using `lazy()`.

### Docs

- **Fixed** Stale `ComponentDef` signature, component count, and version refs.

## 2026-04-11 — 0.0.9

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.9`

### `@llui/dom@0.0.9`

- **Fixed** Expose the `D` type parameter on the `component()` wrapper.

## 2026-04-11 — 0.0.8

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike,lint-idiomatic}@0.0.8`

### `@llui/dom@0.0.8`

- **Added** `virtualEach()` primitive for large-list windowing.
- **Fixed** Phase 1 iteration crash plus demo/theme bugs.

### `@llui/vite-plugin@0.0.8`

- **Fixed** `__handlers` now unions modified fields across all return paths.

### `@llui/components@0.0.8`

- **Added** `sortable` with visual drag feedback, cross-container drag-and-drop, and keyboard a11y (space to grab, arrows to move, escape to cancel).
- **Fixed** `sortable` snapshots item positions at drag start (no flicker) and resolves stale index after sequential drags.

### `@llui/lint-idiomatic@0.0.8`

- **Fixed** `spread-in-children` exempts structural primitives; `each-closure-violation` handles destructured params and render boundaries.

### Docs & examples

- **Added** Root exports for `validateSchema` / `reorder` / theme helpers; new `form-validation` and `i18n-lazy` example apps.
- **Improved** API reference and examples for `virtualEach`, `sortable`, `themeSwitch`, and `form`.

## 2026-04-10 — 0.0.7

**Released:** `@llui/{dom,effects,vite-plugin,test,router,transitions,components,vike,lint-idiomatic}@0.0.7`

### `@llui/dom@0.0.7`

- **Added** `lazy()` primitive for code-split component boundaries.

### `@llui/vite-plugin@0.0.7`

- **Fixed** SVG class binding.

### `@llui/components@0.0.7`

- **Added** `form` (Standard Schema), `sortable`, `themeSwitch`; dashboard example app.
- **Fixed** Accessibility audit: 13 violations → 0.

### `@llui/test@0.0.7`

- **Fixed** Typechecking enabled, fixing 109 latent type errors.

### `@llui/lint-idiomatic@0.0.7`

- **Added** Two new rules.

### Docs

- **Improved** Docs site — dark mode.

## 2026-04-09 — 0.0.6

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.6`

### `@llui/dom@0.0.6`

- **Added** SVG and MathML element helpers.

### `@llui/components@0.0.6`

- **Added** `inView` component; RTL keyboard navigation across all directional components.
- **Added** Locale context for i18n (English defaults, zero-setup for English apps) and locale-aware `format` utilities wrapping `Intl`.
- **Fixed** Benchmark chart animations and format stability.

### Docs & CI

- **Added** Animated benchmark charts.
- **Added** GitHub Actions workflow for format, build, check, lint, and test.
- **Fixed** Example app — use `ItemAccessor<Repo>` so `repoItem` shorthand type-checks.

## 2026-04-08 — 0.0.5

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.5`

### `@llui/vite-plugin@0.0.5`

- **Added** Compiler-generated per-message-type handlers (`__handlers`) and compiler-generated `__update` replacing the generic Phase 1/2 loop.
- **Added** Row factory: compiler-generated shared update function for `each()` rows with a runtime fast path (`entry + __rowUpdate`).
- **Added** Detects array operation patterns (e.g. filter) for specialized reconcilers.
- **Fixed** Row factory correctly scopes selector definitions (IIFE wrap), rewrites accessor calls, and preserves user variables.

### `@llui/dom@0.0.5`

- **Fixed** Restore per-row disposer with a generation guard, fixing the Clear memory leak.
- **Fixed** Selector memory leaks: lazy bucket compaction, empty bucket cleanup, bulk clear on `each()` reconcile.
- **Fixed** Set `currentDirtyMask` in `__handleMsg` for memo consistency.
- **Improved** Phase 1 mask gating skips structural blocks on irrelevant changes; shared Phase 2; swap reduced to O(2) with bulk scope disposal.
- **Improved** Scope pooling reuses disposed scope objects to reduce GC pressure; `reconcileRemove` walks in O(n) without a Map.
- **Improved** Strided `reconcileChanged` for every-Nth-item updates; item updaters moved from scope to entry for direct access; render bag object reused across `each()` entries.

### Docs & infra

- **Added** Docs site — benchmarks page auto-generated from `jfb-baseline.json`.
- **Improved** `bench:setup` script validates the detected `jfb` repo before use.

## 2026-04-07 — 0.0.4

**Released:** `@llui/{dom,effects,vite-plugin,test,router,transitions,components,vike}@0.0.4`

### `@llui/dom@0.0.4`

- **Added** `branch` / `show` callbacks receive the `View<S,M>` bag.

### `@llui/vike@0.0.4`

- **Added** Sub-path exports; SSG extensions powering the new `llui.dev` docs site with auto-generated API docs for all 10 packages.
- **Fixed** Dispose previous page on client navigation; enable Vike client routing for SPA navigation.

### Docs

- **Fixed** Shiki CSS variables theme (no `!important`, proper light/dark), strip duplicate `h1`, fix entity encoding and content accuracy.

## 2026-04-06 — 0.0.3

**Released:** `@llui/{dom,effects,vite-plugin,test,router,transitions,components,vike,lint-idiomatic}@0.0.3`

### Breaking

- **`@llui/effects@0.0.3`** — effects API v2: typed constructors, flexible body, adds `websocket` and `retry`. All existing effect call sites need to move to the typed constructors.

### `@llui/effects@0.0.3`

- **Added** `upload` effect with progress tracking; `clipboard`, `notification`, and `geolocation` effects.

### `@llui/router@0.0.3`

- **Added** Route guards via `beforeEnter` / `beforeLeave` hooks.

### `@llui/transitions@0.0.3`

- **Added** Route transitions and `stagger` for `each()`; spring physics.

### `@llui/components@0.0.3`

- **Added** Complete default theme for all 54 components; `aria-owns` wiring.

### `@llui/lint-idiomatic@0.0.3`

- **Added** 9 new rules: `effect-without-handler`, `forgotten-spread`, `string-effect-callback`, `nested-send-in-update`, `imperative-dom-in-view`, `accessor-side-effect`, plus 3 aria/error-message rules.

### `@llui/dom@0.0.3`

- **Improved** Runtime error messages.

### Docs

- **Improved** Document the styling layer in architecture, API reference, and README; update all effect examples for typed constructors; update system prompt for effects v2 + `View<S,M>`.

## 2026-04-06 — 0.0.2

**Released:** `@llui/{dom,effects,vite-plugin,test,router,transitions,components,vike,lint-idiomatic}@0.0.2`

Initial multi-package release — core TEA runtime (scope tree, bindings, update loop, `mountApp`), element helpers, structural primitives (`show`, `branch`, `each`, `memo`, `portal`, `onMount`), Vite plugin with prop-split and bitmask injection, test harness, effects builders, router, transitions, 54 headless components, idiomatic lint rules, and Vike SSR adapter. 977 tests at release.
