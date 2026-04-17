# `@llui/mcp` — Tool Expansion & CDP Transport

**Date:** 2026-04-17
**Status:** Design approved; pending implementation plan
**Scope:** 36 new MCP tools + Chrome DevTools Protocol (CDP) as a second transport.

---

## 1. Motivation

`@llui/mcp` currently exposes 23 tools over a single transport: stdio (JSON-RPC) → WebSocket relay → `globalThis.__lluiDebug` in the dev browser. This works beautifully for state-machine-level debugging (state, messages, effects, bindings, masks) but leaves three bug classes opaque to the LLM:

1. **View / DOM-level bugs** — rendered markup, computed styles, focus, event wiring. The LLM can reason about state perfectly but has no window into what the user actually sees.
2. **Browser-context bugs** — console errors, uncaught exceptions, network requests, layout. Impossible via page-context JS alone.
3. **Source-level navigation & compiler-transparency bugs** — which line dispatched this Msg, what the compiler output looks like, why a binding has the mask it has.

This design adds 36 new tools that cover all three classes, and introduces **CDP as a secondary transport** for the subset of tools that cannot be implemented via the existing in-page relay.

---

## 2. High-level architecture

### 2.1 Two transports coexisting

```
MCP client (Claude Code, etc.)
      │ stdio (JSON-RPC)
      ▼
┌─────────────────────────────────┐
│          @llui/mcp              │
│  LluiMcpServer.handleToolCall   │
│                │                │
│    ┌───────────┴────────────┐   │
│    ▼                        ▼   │
│  relayCall()           cdpCall()│  ← static tool-tag routing
│    │                        │   │
│    │ WebSocket              │ WebSocket (CDP)
│    ▼                        ▼   │
│  __lluiDebug          Chromium  │
│  (dev browser)        :9222 or  │
│                       Playwright│
└─────────────────────────────────┘
```

### 2.2 Tool tagging & routing

Every tool is registered with one of four **layer tags**:

- `debug-api` — goes through the existing WebSocket relay to `__lluiDebug`.
- `cdp` — goes through the new CDP transport.
- `source` — runs in-process in the MCP server using the `typescript` compiler API.
- `compiler` — reads metadata from `@llui/vite-plugin`'s in-memory cache (via the `debug-api` relay; the plugin attaches metadata to `ComponentDef`).

Routing is **static and deterministic** — no runtime fallback between transports. A tool whose transport is unavailable returns a structured error (see §5.5).

### 2.3 Package structure (single package, optional peer dep)

- `@llui/mcp` stays a single publishable package.
- `playwright` becomes an **optional peer dependency**: `peerDependenciesMeta.playwright.optional: true`. Loaded via dynamic `import('playwright')` on first CDP use; if import fails, every `cdp`-tagged tool returns `{ error: 'cdp_unavailable', hint: 'npm install playwright' }`.
- `typescript` is already transitively available via `@llui/lint-idiomatic` — no new dep for source-scan tools.
- Compiler-metadata tools reach `@llui/vite-plugin`'s cache by calling new getters on the debug API; no new dep edge between `@llui/mcp` and `@llui/vite-plugin`.

### 2.4 New internal layout of `packages/mcp/src/`

```
packages/mcp/src/
  index.ts                 ← LluiMcpServer (refactored, decomposed)
  cli.ts                   ← unchanged
  tool-registry.ts         ← NEW: tool defs + layer tag + dispatch
  tools/
    debug-api.ts           ← 23 debug-API-backed tool handlers (Phase 1 + Phase 5)
    cdp.ts                 ← 6 CDP-backed handlers (Phase 2; 5 CDP + browser_close)
    source.ts              ← 4 source-scan handlers (Phase 4)
    compiler.ts            ← 3 compiler-metadata handlers (Phase 3)
  transports/
    relay.ts               ← extracted from today's index.ts
    cdp.ts                 ← NEW: CDP attach, session, lifecycle
```

The existing 730-line `index.ts` is decomposed as part of Phase 1. Going to ~60 tool handlers in a single file would violate the "files should stay focused" guidance.

---

## 3. Tool catalog (36 tools, 5 phases)

### 3.1 Phase 1 — Debug-API expansion (21 tools)

All tagged `debug-api`.

| #   | Tool                      | Inputs                                                                | Semantic                                                                                                                                                            |
| --- | ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `llui_inspect_element`    | `selector`                                                            | Single-node report: tag, attrs, classes, `data-*`, text, computed subset (display / visibility / position / dimensions), bounding box, bindings targeting this node |
| 2   | `llui_get_rendered_html`  | `selector?`, `maxLength?`                                             | outerHTML of selector (default = mount root)                                                                                                                        |
| 3   | `llui_dom_diff`           | `expected`, `selector?`, `ignoreWhitespace?`                          | Structural diff expected-vs-actual HTML                                                                                                                             |
| 4   | `llui_dispatch_event`     | `selector`, `type`, `init?`                                           | Synthesize and dispatch a browser event; return the history indices of any `Msg`s the handler produced + resulting state                                            |
| 5   | `llui_get_focus`          | —                                                                     | `{ activeSelector, tagName, selectionStart, selectionEnd }`                                                                                                         |
| 6   | `llui_force_rerender`     | —                                                                     | Re-run phase 2 with `dirty = FULL_MASK`; report changed bindings                                                                                                    |
| 7   | `llui_each_diff`          | `sinceIndex?`                                                         | Per-`each` keys added / removed / moved / reused since given update index                                                                                           |
| 8   | `llui_scope_tree`         | `depth?`, `scopeId?`                                                  | Tree of `show` / `each` / `branch` / `child` scopes with active-branch + mounted-key state                                                                          |
| 9   | `llui_disposer_log`       | `limit?`                                                              | Recent `onDispose` firings with scope id + cause                                                                                                                    |
| 10  | `llui_list_dead_bindings` | —                                                                     | Bindings with `dead: true` OR never-matched-dirty OR never-changed-lastValue                                                                                        |
| 11  | `llui_binding_graph`      | —                                                                     | Edge list: state path → `bindingIndex[]`                                                                                                                            |
| 12  | `llui_pending_effects`    | —                                                                     | Effect-queue snapshot with id, type, dispatched-at, status                                                                                                          |
| 13  | `llui_effect_timeline`    | `limit?`                                                              | Ordered log: dispatched → in-flight → resolved/cancelled with timings                                                                                               |
| 14  | `llui_mock_effect`        | `match`, `response`, `opts?` ( `{persist?: boolean}` )                | Register match-predicate → response mock; next matching effect resolves with `response`                                                                             |
| 15  | `llui_resolve_effect`     | `effectId`, `response`                                                | Manually resolve one specific pending effect                                                                                                                        |
| 16  | `llui_step_back`          | `n?`, `mode?` ( `'pure'` default / `'live'` )                         | Rewind by replaying from init minus last `n`; pure mode suppresses effects                                                                                          |
| 17  | `llui_coverage`           | —                                                                     | Per-`Msg` variant: count fired, last fired index; list of never-fired variants                                                                                      |
| 18  | `llui_diff_state`         | `a`, `b` (state object or snapshot id)                                | Structured JSON diff                                                                                                                                                |
| 19  | `llui_assert`             | `path`, `op` (`eq` / `neq` / `exists` / `gt` / `lt` / `in`), `value`  | Evaluate predicate against current state; `{pass, actual, expected}`                                                                                                |
| 20  | `llui_search_history`     | `filter` ( `{type?, statePath?, effectType?, fromIndex?, toIndex?}` ) | Predicate-filtered message history                                                                                                                                  |
| 21  | `llui_eval`               | `code`                                                                | Arbitrary JS in page context via relay; returns `{ result, sideEffects }` with state diff, new history entries, new pending effects, dirty binding indices          |

### 3.2 Phase 2 — CDP transport + CDP-only tools (6 tools)

All tagged `cdp` (except `browser_close` which is a meta-tool on the CDP session).

| #   | Tool                   | Inputs                                           | Semantic                                                         |
| --- | ---------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| 22  | `llui_screenshot`      | `selector?`, `fullPage?`, `format?`              | PNG via `Page.captureScreenshot` or `Element.screenshot`         |
| 23  | `llui_a11y_tree`       | `selector?`, `interestingOnly?`                  | Serialized accessibility tree via `Accessibility.getFullAXTree`  |
| 24  | `llui_network_tail`    | `limit?`, `filter?` ( `{urlPattern?, status?}` ) | Recent requests from session network buffer                      |
| 25  | `llui_console_tail`    | `limit?`, `level?`                               | Recent console entries from session console buffer               |
| 26  | `llui_uncaught_errors` | `limit?`                                         | Recent uncaught exceptions from session error buffer             |
| 27  | `llui_browser_close`   | —                                                | Tear down Playwright fallback browser; no-op in user-chrome mode |

### 3.3 Phase 3 — Compiler metadata (3 tools)

All tagged `compiler`.

| #   | Tool                       | Inputs                      | Semantic                                                                                                                                                                |
| --- | -------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 28  | `llui_show_compiled`       | `componentName?`, `viewFn?` | Pre / post compiler output for the component's `view` (and optional specific view-helper function)                                                                      |
| 29  | `llui_explain_mask`        | `msgType`                   | For a given `Msg` variant: which state paths the compiler believes change → which mask bits. Contrasts with runtime-observed dirty mask if a matching msg is in history |
| 30  | `llui_goto_binding_source` | `bindingIndex`              | File / line / column of the `view()` expression that created this binding                                                                                               |

### 3.4 Phase 4 — Source-scan + test-runner (4 tools)

Tagged `source`.

| #   | Tool                      | Inputs                 | Semantic                                                                                                |
| --- | ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| 31  | `llui_find_msg_producers` | `msgType`, `rootDir?`  | All `send({type: ...})` call sites for this Msg variant                                                 |
| 32  | `llui_find_msg_handlers`  | `msgType`, `rootDir?`  | All branches in `update()` functions handling this Msg variant                                          |
| 33  | `llui_run_test`           | `file?`, `testName?`   | Spawn `vitest run <file> -t <testName>`; stream JSON reporter output                                    |
| 34  | `llui_lint_project`       | `rootDir?`, `exclude?` | Run `@llui/lint-idiomatic` across all `.ts` / `.tsx` in project; aggregated score + per-file violations |

### 3.5 Phase 5 — SSR (2 tools)

Tagged `debug-api` (with `@llui/vike` dep for `ssr_render`).

| #   | Tool                    | Inputs                             | Semantic                                                                                           |
| --- | ----------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| 35  | `llui_hydration_report` | —                                  | Compare server HTML (from Vike) vs post-hydration DOM; list divergences (attr / text / structural) |
| 36  | `llui_ssr_render`       | `state?` (default = current state) | Run the active component through `@llui/vike` adapter; return HTML without round-tripping Vite     |

### 3.6 Principled defaults

- **`step_back` default:** `mode: 'pure'` — no effects re-fire. Prevents double-HTTP-call footguns.
- **`mock_effect` lifetime:** one-shot by default; `persist: true` to keep the mock across matches.
- **Runtime tracking** (each-diff, disposer log, effect timeline, coverage counters): **always on in dev mode**, zero-cost in production (already dev-gated by the compiler).
- **`show_compiled` emission:** compiler stores pre / post source in an in-memory LRU (max 50 entries) keyed by file path. No disk cache.
- **`eval`:** uses `new Function(code)()` inside the page (strict-mode respecting), wrapped in the observability envelope.

---

## 4. Subsystem additions

### 4.1 `LluiDebugAPI` method additions

New methods added to `packages/dom/src/devtools.ts`. Existing 23 methods unchanged.

```ts
interface LluiDebugAPI {
  // ── View / DOM (Phase 1) ────────────────────────────
  inspectElement(selector: string): ElementReport | null
  getRenderedHtml(selector?: string, maxLength?: number): string
  getFocus(): {
    selector: string | null
    tagName: string | null
    selectionStart: number | null
    selectionEnd: number | null
  }

  // ── Interaction (Phase 1) ───────────────────────────
  dispatchDomEvent(
    selector: string,
    type: string,
    init?: EventInit,
  ): {
    dispatched: boolean
    messagesProducedIndices: number[] // indices into history, in order
    resultingState: unknown | null
  }

  // ── Bindings & reactivity (Phase 1) ─────────────────
  getBindingGraph(): { statePath: string; bindingIndices: number[] }[]
  forceRerender(): { changedBindings: number[] }

  // ── Structural (Phase 1) ────────────────────────────
  getScopeTree(opts?: { depth?: number; scopeId?: string }): ScopeNode
  getEachDiff(sinceIndex?: number): EachDiff[]
  getDisposerLog(limit?: number): DisposerEvent[]

  // ── Effects (Phase 1) ───────────────────────────────
  getPendingEffects(): PendingEffect[]
  getEffectTimeline(limit?: number): EffectTimelineEntry[]
  mockEffect(
    match: EffectMatch,
    response: unknown,
    opts?: { persist?: boolean },
  ): { mockId: string }
  resolveEffect(effectId: string, response: unknown): { resolved: boolean }

  // ── History & time-travel (Phase 1) ─────────────────
  stepBack(
    n: number,
    mode: 'pure' | 'live',
  ): {
    state: unknown
    rewindDepth: number
  }
  getCoverage(): {
    fired: Record<string, { count: number; lastIndex: number }>
    neverFired: string[]
  }

  // ── Arbitrary eval (Phase 1) ────────────────────────
  evalInPage(code: string): {
    result: unknown | { error: string }
    sideEffects: {
      stateChanged: StateDiff | null
      newHistoryEntries: number
      newPendingEffects: PendingEffect[]
      dirtyBindingIndices: number[]
    }
  }

  // ── Compiler metadata (Phase 3) ─────────────────────
  getCompiledSource(viewFn?: string): { pre: string; post: string } | null
  getMsgMaskMap(): Record<string, number> | null
  getBindingSource(bindingIndex: number): {
    file: string
    line: number
    column: number
  } | null

  // ── SSR (Phase 5) ───────────────────────────────────
  getHydrationReport(): HydrationDivergence[]
}
```

**Not added as new methods** — composed MCP-side from existing capabilities:

- `dom_diff` (via `getRenderedHtml`)
- `diff_state` (via `snapshotState` / pure diff)
- `assert` (via `searchState`)
- `search_history` (via `getMessageHistory` + filter)
- `list_dead_bindings` (via existing `getBindings` + filter)

Fewer methods = smaller runtime surface.

### 4.2 Runtime tracking additions

Four new dev-time trackers, all populated only when `installDevTools(inst)` has run.

| Tracker             | Location                                                                             | Emits on                                      | Storage                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Each-diff**       | `packages/dom/src/structural/each.ts` reconciliation                                 | Every `each` update                           | Ring buffer of `{ updateIndex, eachKey, added[], removed[], moved[], reused[] }`, last 100 |
| **Disposer log**    | `packages/dom/src/scope.ts` disposal path                                            | Every `onDispose` fire                        | Ring buffer of `{ scopeId, cause, timestamp }`, last 500                                   |
| **Effect timeline** | `packages/effects/src/runtime.ts` + `packages/dom/src/update-loop.ts` effect handler | Dispatch / in-flight start / resolve / cancel | Ring buffer of `{ effectId, type, phase, timestamp, durationMs? }`, last 500               |
| **Msg coverage**    | existing history recorder in `devtools.ts`                                           | Every message recorded                        | `Map<variantName, { count, lastIndex }>`                                                   |

All four live on the `ComponentInstance` under new fields. Production builds pay zero cost.

**Scope-tree introspection** needs no tracking — scopes already live as a tree; `getScopeTree()` just walks it.

### 4.3 `@llui/effects` mocking hook

New function exported from `@llui/effects`:

```ts
/** Dev-only hook used by @llui/mcp. No-op in production. */
export function _setEffectInterceptor(
  hook:
    | ((effect: unknown, id: string) => { mocked: true; response: unknown } | { mocked: false })
    | null,
): void
```

`devtools.ts` sets this hook; on effect dispatch the runtime consults registered mocks, and on match short-circuits: records the effect in the timeline as `resolved-mocked`, doesn't run the real handler, returns the mocked response to the update loop as if the real effect had resolved.

Production: `_setEffectInterceptor` never called → hook is `null` → one null-check per dispatched effect (zero overhead).

### 4.4 `@llui/vite-plugin` compiler metadata additions (Phase 3)

Three new artifacts per compiled component, cached in an in-memory LRU (max 50 entries) on the plugin instance:

1. **`__preSource: string`** — original view function body (pre-transform).
2. **`__postSource: string`** — compiled view function body (post-transform).
3. **`__msgMaskMap: Record<string, number>`** — per `Msg` variant, the union of mask bits the compiler believes the update branch touches. Derived from existing dependency analysis.
4. **`__bindingSources: Array<{ bindingIndex: number; file: string; line: number; column: number }>`** — source location per binding, emitted during the existing binding-walk in pass 2.

All attached as non-enumerable properties on `ComponentDef`, mirroring `__dirty` / `__maskLegend` / `__msgSchema`. Read via the three new getters in §4.1.

---

## 5. CDP transport design

### 5.1 Attach sequence (lazy — on first CDP tool call)

1. **Try `:9222` attach.** `GET http://127.0.0.1:9222/json/version` (200ms timeout). If succeeds, find the page targeting `devUrl`; if found, attach with `mode = 'user-chrome'`. If the page isn't found or the endpoint doesn't respond, fall through.
2. **Playwright fallback.** Dynamic `import('playwright')`. If that fails, return `{ error: 'cdp_unavailable', hint: 'npm install playwright' }`. Otherwise: `chromium.launch({ headless: !headedFlag })` → `newPage().goto(devUrl)` → wait for `__lluiDebug` to exist (signal app mounted) → attach with `mode = 'playwright-owned'`.

### 5.2 Dev-URL discovery

Extend the existing MCP-active marker file:

```jsonc
// node_modules/.cache/llui-mcp/active.json
{ "port": 5200, "pid": 12345, "devUrl": "http://localhost:5173" }
```

The Vite plugin writes `devUrl` into the marker when the MCP server is detected. If no Vite plugin is active, `llui-mcp` accepts `--url http://localhost:5173`. If neither, CDP tools return `{ error: 'dev_url_unknown' }`.

### 5.3 Session state

```ts
interface CdpSession {
  mode: 'user-chrome' | 'playwright-owned'
  browser: Browser | null // null in user-chrome mode
  page: Page
  consoleBuffer: RingBuffer<ConsoleEntry> // last 500
  networkBuffer: RingBuffer<NetworkEntry> // last 500
  errorBuffer: RingBuffer<ErrorEntry> // last 200
  startedAt: number
}
```

Listeners registered on attach, not per-tool-call:

- `Runtime.consoleAPICalled` → `consoleBuffer`
- `Runtime.exceptionThrown` → `errorBuffer`
- `Network.requestWillBeSent` / `responseReceived` / `loadingFinished` / `loadingFailed` → `networkBuffer`
- `Page.frameNavigated` → log but don't re-attach on unexpected URL changes

**CDP domains enabled:** `Runtime`, `Network`, `Page`, `Accessibility`. Nothing else.

### 5.4 Lifecycle

- **Spawn triggers:** first CDP-tagged tool call after startup, or first after `browser_close`.
- **Close triggers:**
  - `llui_browser_close` → teardown in playwright-owned mode; no-op in user-chrome mode (returns `{ closed: false, reason: 'user_owns_browser' }`).
  - SIGINT/SIGTERM → teardown + marker file cleanup (extends existing cleanup).
  - CDP WebSocket drops unexpectedly → clear `CdpSession`; next CDP call re-attaches.
- **After close:** buffers discarded. `console_tail` / `network_tail` / `uncaught_errors` see only events from the new session. Explicit LLM close = explicit "stop tracking" signal.

### 5.5 Error contract for CDP tools

Every CDP-tagged tool returns one of three shapes:

```ts
// Success
{ ok: true, data: <tool-specific> }

// Transport error (CDP path broken)
{
  ok: false
  error: 'cdp_unavailable' | 'dev_url_unknown' | 'browser_crashed' | 'attach_timeout'
  hint: string
}

// Tool-level error (attach succeeded, operation failed)
{
  ok: false
  error: 'selector_not_found' | 'screenshot_failed' | <domain-specific>
  hint: string
  details?: unknown
}
```

The LLM can distinguish "fix infra" from "fix operation".

### 5.6 `--headed` flag

CLI flag forwarded into the Playwright spawn path:

```ts
chromium.launch({ headless: !options.headed })
```

Ignored in user-chrome mode. Default: headless.

---

## 6. Testing strategy

### 6.1 Test gating per category

| Category                      | Unit (mocked API)    | jsdom e2e | Playwright e2e         |
| ----------------------------- | -------------------- | --------- | ---------------------- |
| Phase 1 pure-compute          | ✅                   | —         | —                      |
| Phase 1 DOM-touching          | ✅                   | ✅        | —                      |
| Phase 1 `step_back` live-mode | ✅                   | ✅        | —                      |
| Phase 2 CDP                   | ✅ (mock CdpSession) | —         | ✅                     |
| Phase 3 compiler              | ✅                   | —         | ✅ one smoke per phase |
| Phase 4 source-scan           | ✅ (fixtures)        | —         | —                      |
| Phase 5 SSR                   | ✅                   | —         | ✅ one smoke           |

**Approximate totals:** 36 unit + ~14 jsdom + ~8 Playwright ≈ **58 new test cases**.

### 6.2 TDD rhythm per tool

1. Write unit test against mocked debug API → red.
2. Add debug-API method (or MCP pure function) → unit green.
3. If DOM-touching, write jsdom e2e → red.
4. Wire through relay → jsdom green.
5. If CDP, write Playwright e2e → red.
6. Wire through CDP attach → Playwright green.

### 6.3 Verification gate per phase

Before claiming a phase complete:

1. `pnpm turbo check`
2. `pnpm turbo lint`
3. `pnpm turbo test`
4. `pnpm test:e2e` in `packages/mcp` (Phase 2 / 3 / 5)
5. `pnpm format:check`

All five must pass.

---

## 7. Phasing & dependencies

```
Phase 1 (Debug-API expansion)
  └─ Foundational. Touches @llui/dom + @llui/effects.
     21 tools. Ships first — Phase 2+ reuse the tool-registry refactor.

Phase 2 (CDP transport)
  └─ Depends on Phase 1's tool-registry split.
     Adds transports/cdp.ts, tools/cdp.ts. 6 tools.

Phase 3 (Compiler metadata)
  └─ Depends on Phase 1 (uses new getters through relay).
     Touches @llui/vite-plugin. 3 tools.

Phase 4 (Source-scan)
  └─ Depends on Phase 1 tool-registry only.
     Can land in parallel with Phase 2 / 3. 4 tools.

Phase 5 (SSR)
  └─ Depends on Phase 1. Touches @llui/vike. 2 tools.
```

**Commit grain:** one phase = one commit cluster, reviewed as a unit. Within a phase, commits grouped by tool category.

---

## 8. Documentation updates (per phase)

Every phase updates, in the same commit cluster:

- `packages/mcp/README.md` — tool table entries for new tools.
- `docs/designs/07 LLM Friendliness.md` §10 — MCP tool list.
- `docs/designs/09 API Reference.md` — new `LluiDebugAPI` methods (Phase 1 / 3 / 5) and `@llui/effects` `_setEffectInterceptor` (Phase 1).
- `CLAUDE.md` — add `@llui/mcp` row to the package table if missing.

---

## 9. Out of scope for this design

- **`llui_perf_summary`** — deferred; requires runtime instrumentation with non-trivial overhead decisions.
- **`llui_read_component_source`** — redundant with the LLM's existing `Read` tool over the path returned by `component_info`.
- **`llui_eval_cdp`** — not in Phase 1 or 2. May be added later if actual usage shows a gap. Phase 1's `llui_eval` (page context) + Phase 2's bounded CDP tools are expected to cover >90% of cases.
- **Non-Chromium CDP** — out of scope. Firefox / WebKit CDP subsets are incomplete; the fallback path always spawns Chromium.
- **Multi-browser coordination** — if the user has multiple Chrome windows on `:9222`, MCP picks the first page matching `devUrl` and ignores others.

---

## 10. Type glossary

Types referenced above, defined precisely at implementation time. Shapes given here are binding for the design.

```ts
interface ElementReport {
  selector: string // canonical selector that matched
  tagName: string
  attributes: Record<string, string>
  classes: string[]
  dataset: Record<string, string>
  text: string // textContent, truncated to 1000 chars
  computed: {
    display: string
    visibility: string
    position: string
    width: number
    height: number
  }
  boundingBox: { x: number; y: number; width: number; height: number }
  bindings: Array<{
    bindingIndex: number
    kind: string
    mask: number
    lastValue: unknown
    relation: 'self' | 'text-child' | 'comment-child'
  }>
}

interface ScopeNode {
  scopeId: string
  kind: 'root' | 'show' | 'each' | 'branch' | 'child' | 'portal'
  active: boolean // for branch/show: whether this arm is mounted
  eachKey?: string // for each items
  childName?: string // for child scopes
  children: ScopeNode[]
}

interface EachDiff {
  updateIndex: number // message history index that caused this diff
  eachSiteId: string // stable identifier for the each() call site
  added: string[] // keys
  removed: string[]
  moved: Array<{ key: string; from: number; to: number }>
  reused: string[]
}

interface DisposerEvent {
  scopeId: string
  cause: 'branch-swap' | 'each-remove' | 'show-hide' | 'child-unmount' | 'app-unmount'
  timestamp: number
}

interface PendingEffect {
  id: string // opaque; used by resolveEffect
  type: string // discriminant from the Effect union
  dispatchedAt: number
  status: 'queued' | 'in-flight'
  payload: unknown // the effect data itself
}

interface EffectTimelineEntry {
  effectId: string
  type: string
  phase: 'dispatched' | 'in-flight' | 'resolved' | 'resolved-mocked' | 'cancelled'
  timestamp: number
  durationMs?: number // present on 'resolved' / 'resolved-mocked' / 'cancelled'
}

/**
 * Predicate for matching an effect against a registered mock.
 * At least one field must be present; multiple fields AND together.
 */
interface EffectMatch {
  type?: string // exact match against effect.type
  payloadPath?: string // dot-path; e.g. 'url'
  payloadEquals?: unknown // value the path must equal
}

interface StateDiff {
  added: Record<string, unknown>
  removed: Record<string, unknown>
  changed: Record<string, { from: unknown; to: unknown }>
}

interface HydrationDivergence {
  path: string // DOM path like 'body > div:nth-child(1)'
  kind: 'attribute' | 'text' | 'structural'
  server: unknown
  client: unknown
}

interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  text: string
  args: unknown[] // serialized
  timestamp: number
  stackTrace?: string
}

interface NetworkEntry {
  requestId: string
  url: string
  method: string
  status: number | null // null if pending/failed
  startTime: number
  endTime: number | null
  durationMs: number | null
  failed: boolean
  failureReason?: string
}

interface ErrorEntry {
  text: string
  stack: string
  timestamp: number
  url?: string
  line?: number
  column?: number
}

type RingBuffer<T> = T[] // bounded FIFO; implementation detail
```

---

## 11. Risks

- **Runtime tracking LOC (§4.2) adds ~500 LOC to `@llui/dom` + `@llui/effects`.** Dev-gated, but real code to maintain.
- **Compiler metadata LRU (§4.4) adds memory pressure** in long dev sessions. 50-entry cap chosen conservatively; may need tuning.
- **`mock_effect` interception hook (§4.3) changes the effects runtime hot path** by one null-check. Measured cost: negligible, but worth noting in release notes.
- **CDP user-chrome attach isn't covered by CI** — documented as manually verified. If :9222 attach breaks subtly, we won't catch it automatically until a user reports it.
