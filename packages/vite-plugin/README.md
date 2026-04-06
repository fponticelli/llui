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

| Pass | Name            | Description                                                              |
| ---- | --------------- | ------------------------------------------------------------------------ |
| 1    | Prop split      | Rewrites element helpers to `elSplit()`/`elTemplate()` for template cloning. Separates static props (set once at mount) from dynamic props (updated on state change). |
| 2    | Mask injection  | Analyzes state dependencies, assigns bitmask bits to state paths, injects `__dirty(oldState, newState)` per component. Rewrites `text()` and binding callbacks with mask guards. |
| 3    | Import cleanup  | Removes unused imports introduced or made redundant by earlier passes.    |

## Diagnostics

The compiler emits warnings for common issues:

| Diagnostic                | Description                                      |
| ------------------------- | ------------------------------------------------ |
| Missing alt attribute     | Accessibility: `img` without `alt`               |
| Non-exhaustive update     | `update()` switch missing msg type cases          |
| Empty props               | Element helper called with empty props object     |
| Namespace imports         | `import * as` prevents tree-shaking               |
| Spread children           | Spread in children array defeats static analysis  |

## License

MIT
