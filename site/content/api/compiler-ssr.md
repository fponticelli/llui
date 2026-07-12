---
title: '@llui/compiler-ssr'
description: 'Opt-in compiler module: use-client directive handling and SSR emission paths'
---

# @llui/compiler-ssr

Opt-in compiler module for SSR. Handles the `'use client'` directive and the SSR-specific emission paths consumed by [`@llui/vike`](/api/vike).

Apps that don't use server-rendering can leave this off — the engine and Vite plugin work without it.

<!-- auto-api:start -->

## Functions

### `hasUseClientDirective()`

Check whether `source`'s first statement is a `'use client'` directive.
Cheap string scan so the caller can decide which transform to run
without parsing the whole file twice.

```typescript
function hasUseClientDirective(source: string): boolean
```

### `transformUseClientSsr()`

If `source` begins with a `'use client'` directive, generate a stub
replacement for the SSR build. Every `export const X = <expr>` becomes
`export const X = __clientOnlyStub('X')`, every `export function X`
becomes a stub, and `export default <expr>` becomes a default stub.
Returns `null` if the directive is absent (caller should fall through
to the normal compiler pass).
The client build is expected to skip this path entirely — Vite passes
`{ ssr: false }` there, and the plugin checks that before invoking
this function.
Every export with a statically-known name is stubbed uniformly:

- `export const/let NAME = …`, `export function NAME()`, `export class
NAME` — each becomes `export const NAME = __clientOnlyStub('NAME')`.
  (A stubbed function/class is a value, not a callable/constructable —
  SSR must not invoke it; the client build ships the real one.)
- `export { a, b }` and `export { a as b } from './other.js'` — the
  names are known, so each is stubbed (the `from './other.js'` source
  module is DROPPED, never pulled into the SSR graph).
- `export default …` — stubbed as `export default __clientOnlyStub("default")`.
  NOT stubbable (dropped from the output, WITH a warning):
- `export * from './other.js'` — its re-exported names can't be
  enumerated statically, so they can't be stubbed. Any client-only
  value it re-exported is undefined during SSR; move the 'use client'
  directive to the source module.
  Left untouched: `export type …` / `interface` (erased by TS anyway).

```typescript
function transformUseClientSsr(source: string, _filename: string): UseClientTransformResult | null
```

## Interfaces

### `UseClientTransformResult`

```typescript
export interface UseClientTransformResult {
  output: string
  warnings: string[]
}
```

<!-- auto-api:end -->
