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

### `findWorkspaceRoot()`

Locate the workspace root so we share the MCP active marker file
with @llui/mcp regardless of which subdirectory the dev server runs in.
Mirrors `findWorkspaceRoot` from @llui/mcp — duplicated to avoid a
vite-plugin → mcp dependency cycle. The contract must stay in sync.

```typescript
function findWorkspaceRoot(start: string = process.cwd()): string
```

### `hasMcpPackage()`

Does `@llui/mcp` resolve from `root`'s node_modules? Uses
`require.resolve` so monorepo workspaces and hoisted installs both
work. Catches failures silently — the only consequence is that we
leave `mcpPort` disabled, which is the safe default.

```typescript
function hasMcpPackage(root: string): boolean
```

### `resolveMcpCliPath()`

Resolve the path to the llui-mcp CLI entry. Reads `bin.llui-mcp`
from @llui/mcp's package.json and joins it against the package
directory. Returns null if @llui/mcp isn't resolvable.

```typescript
function resolveMcpCliPath(root: string): string | null
```

### `llui()`

```typescript
function llui(options: LluiPluginOptions = {}): Plugin
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
   * Treat every compiler diagnostic as a build error.
   *
   * Default `false` — diagnostics are emitted via rollup's `this.warn` and
   * can be ignored. Set to `true` in CI so lint-style regressions (namespace
   * imports, bitmask overflow, spread-in-children, `.map()` on state, etc.)
   * fail the build without requiring a custom `build.rollupOptions.onwarn`
   * handler.
   */
  failOnWarning?: boolean

  /**
   * Silence specific diagnostic rules without disabling the whole lint
   * pass. Each message is tagged with a rule name (shown in brackets at
   * the start of every warning, e.g. `[spread-in-children]`). Listing
   * a rule here drops all diagnostics with that tag before rollup sees
   * them — so they don't fire via `this.warn` and don't fail the build
   * even when `failOnWarning` is enabled.
   *
   * The valid rule names are enumerated by the `DiagnosticRule` type
   * re-exported from this module. Unknown rule names are ignored.
   */
  disabledWarnings?: readonly DiagnosticRule[]

  /**
   * Emit `[llui]`-prefixed `console.info` logs for every transformed
   * component file — state-path bit assignments, mask injections, and
   * helper compile/bail counts. Useful when diagnosing why a binding
   * isn't gated the way you expect, or why a call fell back from
   * template-clone to `elSplit`. Off by default.
   */
  verbose?: boolean

  /**
   * When true, include schemas and binding descriptors in prod builds so
   * the @llui/agent runtime has metadata to advertise over its WS hello
   * frame. Default false — matches prior behavior (metadata is dev-only).
   * See agent spec §7.4 and Plan 3b.
   */
  agent?: boolean
}
```

<!-- auto-api:end -->
