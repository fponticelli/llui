---
title: '@llui/vite-plugin'
description: 'Compiler: 3-pass TypeScript transform, bitmask injection, diagnostics'
---

# @llui/vite-plugin

Vite plugin compiler for [LLui](https://github.com/fponticelli/llui). 3-pass TypeScript transform that eliminates the virtual DOM at compile time.

```bash
pnpm add -D @llui/vite-plugin
```

## Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({
  plugins: [llui()],
})
```

## Options

```ts
llui({
  mcpPort: 5200, // MCP debug server port (default: 5200, false to disable)
})
```

## What It Does

The compiler runs 3 passes over every `.ts`/`.tsx` file using the TypeScript Compiler API:

| Pass | Name           | Description                                                                                                                                                                      |
| ---- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Prop split     | Rewrites element helpers to `elSplit()`/`elTemplate()` for template cloning. Separates static props (set once at mount) from dynamic props (updated on state change).            |
| 2    | Mask injection | Analyzes state dependencies, assigns bitmask bits to state paths, injects `__dirty(oldState, newState)` per component. Rewrites `text()` and binding callbacks with mask guards. |
| 3    | Import cleanup | Removes unused imports introduced or made redundant by earlier passes.                                                                                                           |

## Diagnostics

The compiler emits warnings for common issues:

| Diagnostic            | Description                                      |
| --------------------- | ------------------------------------------------ |
| Missing alt attribute | Accessibility: `img` without `alt`               |
| Non-exhaustive update | `update()` switch missing msg type cases         |
| Empty props           | Element helper called with empty props object    |
| Namespace imports     | `import * as` prevents tree-shaking              |
| Spread children       | Spread in children array defeats static analysis |

<!-- auto-api:start -->

## Functions

### `llui()`

```typescript
function llui(options: LluiPluginOptions = {}): Plugin
```

## Types

### `AgentPluginConfig`

Reserved for future agent-server config. Empty today — opaque tokens
(post-0.0.35) need no signing key, and the dev server hard-codes the
identity resolver to `'dev-user'`. The shape is kept so callers can
pass `agent: { ... }` and we can grow options without churning the
public type.

```typescript
export type AgentPluginConfig = Record<string, never>
```

## Interfaces

### `LluiPluginOptions`

```typescript
export interface LluiPluginOptions {
  /**
   * Port for the MCP debug bridge. In dev mode, the runtime relay connects
   * to `ws://127.0.0.1:<port>` so an external `llui-mcp` server can forward
   * tool calls into the running app.
   *
   * When omitted, the plugin checks whether `@llui/mcp` is resolvable from
   * the Vite project root. If yes → defaults to `5200`. If no → stays
   * disabled. This means installing `@llui/mcp` (+ starting its server)
   * Just Works without an explicit config entry. Pass an explicit `false`
   * to opt out even when `@llui/mcp` is installed; pass a number to use
   * a non-default port. When enabled but the MCP server isn't running,
   * the plugin returns 404 from its discovery endpoint and the browser
   * silently skips the connection — no retry noise.
   */
  mcpPort?: number | false

  /**
   * Emit `[llui]`-prefixed `console.info` logs for every transformed
   * component file — state-path bit assignments, mask injections, and
   * helper compile/bail counts. Useful when diagnosing why a binding
   * isn't gated the way you expect, or why a call fell back from
   * template-clone to `elSplit`. Off by default.
   */
  verbose?: boolean

  /**
   * Enables two things together when set:
   *
   *   1. Emits schemas + binding descriptors in prod builds so the
   *      @llui/agent runtime has metadata to advertise over its WS hello
   *      frame (see agent spec §7.4).
   *   2. Auto-mounts `@llui/agent/server`'s router at `/agent/*` and its
   *      WS upgrade handler at `/agent/ws` on the Vite dev server — so
   *      plain `vite dev` has working agent endpoints with no extra
   *      server.ts wiring. Requires `@llui/agent` installed; if it isn't,
   *      the plugin warns and skips dev mounting (prod emission still
   *      works from Plan 3b).
   *
   * Pass `true` for defaults (random signing key per dev session;
   * `identityResolver` returns `'dev-user'`). Pass an object to customize.
   * Default `false` — metadata is dev-only, no agent endpoints.
   */
  agent?: boolean | AgentPluginConfig

  /**
   * Whether any component in the app uses `each()`'s `enter` / `leave`
   * / `onTransition` options. When `false` (the default), the
   * vite-plugin substitutes `__LLUI_TRANSITIONS__ = false` into the
   * runtime bundle; Vite's dead-code eliminator then drops the
   * per-entry enter/leave helpers, the `leaving` queue plumbing, and
   * the `report` allocation in `each()`'s reconcile path. Saves
   * ~0.3 kB gz on jfb-shape bundles that don't animate.
   *
   * Apps using `@llui/transitions` or any custom `each({ enter, leave,
   * onTransition })` MUST pass `transitions: true` — otherwise the
   * options will be silently ignored at runtime.
   */
  transitions?: boolean

  /**
   * Opt-in cross-file accessor walking (v2c pipeline integration of v2b's
   * cross-file walker). When enabled, the plugin builds a `ts.Program`
   * over the project at `configResolved` and feeds each `transform` call
   * the cross-file paths read through in-repo view-helpers — replacing
   * the v0.x sentinel-`show()` workaround for helpers in sibling files.
   *
   * Prototype-grade caveats:
   *   - The Program builds once at startup; it does NOT refresh on file
   *     change. HMR-edited files see stale cross-file edges until the
   *     next dev-server restart. (v2c's module decomposition lands the
   *     proper incremental Program; this is the v2b pipeline-integration
   *     deferral.)
   *   - The Program covers `.ts` / `.tsx` files reachable from the Vite
   *     project root's `tsconfig.json`. Out-of-project imports are not
   *     followed; manifest-driven library helpers cover those in
   *     `@llui/cli publish-deps` (v2c, deferred).
   *   - The walker emits `llui/opaque-view-call` diagnostics for helpers
   *     it can't classify; in dev these surface as Vite warnings. Set
   *     `crossFile: 'silent'` to suppress the diagnostics while still
   *     getting the path merging.
   *
   * Default `'silent'` — paths read through in-file-graph helpers
   * (`(s) => s.route.kind` from a predicate helper, etc.) are folded
   * into the host component's `__prefixes` automatically, without
   * polluting dev logs with opaque-call diagnostics. Set `crossFile:
   * true` to surface the diagnostics in dev, or `false` to disable
   * cross-file resolution entirely (saves the startup Program build
   * cost on very large repos; falls back to per-file analysis).
   */
  crossFile?: boolean | 'silent'

  /**
   * Controls the devmode-annotate notebook surface — a single Connect
   * middleware mounted at `/_llui/*` that lets the HUD
   * (`@llui/devmode-annotate`) and the MCP server (`@llui/mcp`) read
   * and write a shared on-disk notebook under `.llui/notes/`. The HUD
   * developer drops notes from the running app; the LLM consumes them
   * via MCP subscriptions; both can initiate captures.
   *
   * **Default: on in dev mode.** Omitting the option (or passing `true`)
   * registers the middleware automatically — there's nothing to do.
   * Pass `false` to opt out (no routes registered, middleware tree-
   * shakes). Pass an object to keep it on while customizing the notes
   * directory or default timeout.
   *
   * The HUD itself stays separately opt-in: the developer mounts it
   * via `mountAnnotateHud()` in their app entry. The middleware
   * registration is harmless when no HUD is connected (and `@llui/mcp`
   * also works with it standalone). Production builds never run
   * `configureServer`, so this is dev-only by construction.
   *
   * Environment overrides (honored when not opted out):
   *   - `LLUI_NOTES_DIR` — override the notes root path
   *   - `LLUI_CAPTURE_TIMEOUT_MS` — override the default capture-request timeout
   *
   * The proposal (`docs/proposals/devmode-annotate/`) details what
   * lands on disk and what the LLM gets.
   */
  devmodeAnnotate?: boolean | DevmodeAnnotateConfig
}
```

### `DevmodeAnnotateConfig`

```typescript
export interface DevmodeAnnotateConfig {
  /** Override the on-disk notes root. Relative paths resolve against
   *  the Vite project root. Default: `.llui/notes`. The
   *  `LLUI_NOTES_DIR` env var takes precedence if set. */
  notesDir?: string
  /** Override the default capture-request long-poll timeout in
   *  milliseconds. The `LLUI_CAPTURE_TIMEOUT_MS` env var takes
   *  precedence if set. Default: 30000. */
  captureTimeoutMs?: number
  /**
   * The attention router auto-picks up task-mode notes (the developer
   * clicks "Solve" in the HUD) and spawns `claude` headlessly to
   * propose a fix. Default: enabled when `claude` is available on
   * PATH; otherwise a no-op with a one-time install hint logged.
   *
   * Set `router: false` to fully disable. The notes themselves still
   * land on disk; only the auto-dispatch is skipped.
   */
  router?: boolean
  /** Override the per-task timeout for the router's spawn. Default
   *  5 minutes. */
  routerTimeoutMs?: number
}
```

<!-- auto-api:end -->
