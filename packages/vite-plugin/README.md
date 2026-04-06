# @llui/vite-plugin

Vite plugin compiler for [LLui](https://github.com/fponticelli/llui).

3-pass TypeScript transform: static/dynamic prop split, dependency analysis + bitmask injection, import cleanup. Rewrites element helpers to `elSplit()`/`elTemplate()`, synthesizes `__dirty()` per component, and handles `View<S,M>` destructuring.

```bash
pnpm add -D @llui/vite-plugin
```

```ts
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
export default defineConfig({ plugins: [llui()] })
```

## License

MIT
