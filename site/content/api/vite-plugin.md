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
   * The HUD is **auto-injected** in dev mode: the plugin emits a
   * `<script type="module">` into the served HTML that imports
   * `@llui/devmode-annotate` and mounts the floating button. Production
   * builds never run `configureServer` or `transformIndexHtml(dev)`, so
   * this is dev-only by construction. Disable just the HUD (keeping the
   * notes API on) with `devmodeAnnotate: { hud: false }`; disable
   * everything with `devmodeAnnotate: false`. The HUD package must be
   * resolvable from the project root — install
   * `@llui/devmode-annotate` alongside `@llui/vite-plugin`.
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

````typescript
export interface DevmodeAnnotateConfig {
  /** Override the on-disk notes root. Relative paths resolve against
   *  the Vite project root. Default: `.llui/notes`. The
   *  `LLUI_NOTES_DIR` env var takes precedence if set. */
  notesDir?: string
  /**
   * Override session-folder naming and/or slug derivation. The
   * id+author+kind prefix of each filename stays fixed so id ordering
   * and filename parsing keep working — only the trailing slug and
   * the session folder name are customizable.
   *
   * ```ts
   * format: {
   *   formatSessionFolder: (d) => `session-${d.toISOString().slice(0, 10)}`,
   *   deriveSlug: (prose) =>
   *     prose.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20).replace(/^-|-$/g, '') || 'capture',
   * }
   * ```
   *
   * Note: when the MCP server writes notes directly (out-of-process),
   * it uses defaults — only writes that go through the dev-server
   * middleware (the HUD path) honor these overrides.
   */
  format?: NoteFormatConfig
  /** Override the default capture-request long-poll timeout in
   *  milliseconds. The `LLUI_CAPTURE_TIMEOUT_MS` env var takes
   *  precedence if set. Default: 30000. */
  captureTimeoutMs?: number
  /**
   * The attention router auto-picks up task-mode notes (the developer
   * clicks "Solve" in the HUD) and spawns the configured LLM CLI to
   * propose a fix. Accepts:
   *
   *  - `false` — disable. The HUD hides its "Solve" button; notes
   *              still save to disk so MCP-side consumers can act on
   *              them.
   *  - `'claude' | 'codex' | 'gemini'` — preset; everything defaults.
   *  - `LlmRouterConfig` — preset + overrides (model, timeoutMs,
   *              concurrency, env, extraArgs), or a fully custom
   *              invocation `{ command, args, promptVia }` (omit
   *              `preset` to opt out of preset defaults entirely).
   *
   * When the chosen CLI isn't on PATH the router degrades silently
   * to save-only and the HUD hides the Solve button — the user gets
   * a one-line install hint in the console.
   *
   * Default: `'claude'`.
   */
  router?: false | LlmPreset | LlmRouterConfig
  /** Override the per-task timeout for the router's spawn. Default
   *  5 minutes. Deprecated alias for `router.timeoutMs`. */
  routerTimeoutMs?: number
  /**
   * Controls the in-app HUD (`@llui/devmode-annotate`) auto-injection.
   *
   *  - `true` / omitted — inject in dev mode (default).
   *  - `false`          — skip injection. The notes API stays live so
   *                       MCP can still consume the notebook; only the
   *                       floating button + modal are skipped.
   *  - `HudInjectionConfig` — inject with forwarded options. Currently
   *                       supports `{ hidden: true }` to mount the HUD
   *                       programmatically (no floating button).
   *
   * Injection silently no-ops when `@llui/devmode-annotate` isn't
   * resolvable from the project root.
   */
  hud?: boolean | HudInjectionConfig
}
````

### `HudInjectionConfig`

```typescript
export interface HudInjectionConfig {
  /** Mount the HUD without rendering the floating button. The
   *  keyboard shortcut + programmatic API still work. */
  hidden?: boolean
  /** When `true` (default), the HUD installs `window.onerror` +
   *  `unhandledrejection` listeners. On an uncaught error it opens
   *  the modal pre-populated with the stack + a screenshot — turns
   *  "I saw something weird but can't reproduce it" into a
   *  one-click solve. Set `false` to opt out of the listeners
   *  entirely. */
  autoCaptureOnError?: boolean
  /** When `true` (default), the HUD shows a "● Record" toggle that
   *  captures clicks/inputs/route-changes/messages between toggle-on
   *  and submit, attaching them to the note for the LLM to replay.
   *  Set `false` to hide the toggle and skip the listener setup. */
  repro?: boolean
  /** When `true` (default), the HUD exposes the "⌖ Pick element"
   *  annotation mode alongside "⌖ Add region". Set `false` to hide
   *  the picker affordance. */
  elementPick?: boolean
}
```

<!-- auto-api:end -->
