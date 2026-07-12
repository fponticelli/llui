# @llui/compiler

Compile-time engine for [LLui](https://github.com/fponticelli/llui). Runs a single TypeScript transform over a component's view that lowers signal expressions to runtime helpers, emits agent/devtools introspection metadata inline, and enforces the framework lint rules as **non-bypassable build errors**.

```bash
pnpm add -D @llui/compiler
```

Most apps do not use this package directly — it is wired into builds by [`@llui/vite-plugin`](https://www.npmjs.com/package/@llui/vite-plugin). Reach for it directly only if you are building your own bundler adapter.

## What it does

- **View lowering** — rewrites signal expressions in a component's DIRECT view into runtime authoring helpers (`signalText` / `el` / `react` / `signalEach` / …) as an optimization. Anything it can't lower (view-helper functions, block-body views) is left to run through the real runtime helpers, so both forms coexist.
- **Inline introspection metadata** — Msg / State / Effect schemas, schema hashes, and binding descriptors extracted from the source and emitted inline for the agent and devtools surfaces.
- **Signal lint rules** — `peek-in-slot`, `operator-on-signal`, `pure-derive-body`, `no-node-construction-in-body`, plus shared cross-file / agent / convention checks. All rules have severity `error`; they are compile-time failures, never ESLint warnings (LLMs ignore warnings, so an error is the only effective channel).

## Entry points

The live transform is `transformSignalComponentSource` (a string-edit signal transform). Cross-file Msg/State/Effect resolution lives in `cross-file-resolver.ts`.
