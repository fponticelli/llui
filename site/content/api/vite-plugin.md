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
   * Defaults to `false` (opt-in). Pass a number (typically `5200`) to
   * enable. When enabled but the MCP server isn't running, the plugin
   * returns 404 from its discovery endpoint and the browser silently
   * skips the connection — no retry noise.
   */
  mcpPort?: number | false
}
```

<!-- auto-api:end -->
