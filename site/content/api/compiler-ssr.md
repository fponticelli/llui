---
title: '@llui/compiler-ssr'
description: 'Opt-in compiler module: use-client directive handling and SSR emission paths'
---

# @llui/compiler-ssr

Opt-in compiler module for SSR. Handles the `'use client'` directive and the SSR-specific emission paths consumed by [`@llui/vike`](/api/vike).

Apps that don't use server-rendering can leave this off — the engine and Vite plugin work without it.

<!-- auto-api:start -->

## Functions

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
Shapes this v1 does NOT handle (emits a warning + leaves them out of
the stub output):

- `export function foo() {}` and `export class Foo {}` — rewritten
  as stubs but the caller may be surprised that `foo` and `Foo` are
  ComponentDef-shaped objects during SSR.
- `export { a, b } from './other.js'` — re-export forms are not
  detected; they pass through and will still pull `./other` into
  the SSR graph.
- `export * from './other.js'` — same as above.
- `export type ...` — type exports are erased by TS so nothing to
  stub; left untouched.

```typescript
function transformUseClientSsr(source: string, _filename: string): UseClientTransformResult | null
```

### `hasUseClientDirective()`

Check whether `source`'s first statement is a `'use client'` directive.
Cheap string scan so the caller can decide which transform to run
without parsing the whole file twice.

```typescript
function hasUseClientDirective(source: string): boolean
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
