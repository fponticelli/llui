# @llui/compiler-ssr

Opt-in SSR transforms for [LLui](https://github.com/fponticelli/llui), layered on top of [`@llui/compiler`](https://www.npmjs.com/package/@llui/compiler).

```bash
pnpm add -D @llui/compiler-ssr
```

Provides the `'use client'` directive transforms used by SSR adapters (e.g. [`@llui/vike`](https://www.npmjs.com/package/@llui/vike)) to split client-only component code out of the server bundle. Like `@llui/compiler`, this is build-time tooling — you normally consume it through a bundler adapter rather than importing it directly.
