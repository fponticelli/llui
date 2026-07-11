---
title: Publishing a precompiled LLui library
description: "Ship a `__llui_deps.json` dependency manifest so consumer apps narrow reactive bindings through your package's helpers across the npm boundary."
---

# Publishing a precompiled LLui library

When an app derives a reactive value through one of your package's helpers —

```ts
text((s) => itemFill(s, index)) // itemFill imported from your package
```

— the consumer's compiler normally **can't see your helper's body** (it ships as
compiled `dist/*.d.ts`), so it conservatively assumes the helper may read the
whole slice and re-evaluates the binding on every change. A **dependency
manifest** closes that gap: it records what each helper reads, so the consumer
narrows the binding to the exact paths — across the npm boundary.

> **Status (current):** the **producer** half is live — `scripts/publish.sh`
> emits a `dist/__llui_deps.json` for every published package, so the manifests
> ship today. The **consumer** half is **not wired into the live compiler**:
> the resolution code (`manifest-resolve.ts`) exists and is unit-tested, but the
> live signal transform (`transformSignalComponentSource`) never calls it — it
> has no `ts.Program`/checker, which `manifest-resolve` needs. So a shipped
> manifest is currently a no-op for consumers — bindings through a package
> helper still coarsen (see [Soundness](#soundness)). Phase 3 was
> **evidence-closed (2026-06-10)**: a scan of the real consumers found zero call
> sites that would benefit (no app renders large lists through rows imported
> from a _precompiled_ package). Emitting the manifest now is forward-compatible
> and costs nothing; the rest of this doc describes the intended end state.

## The manifest

A package ships `dist/__llui_deps.json` (schema v2). You don't hand-write it —
the analyzer generates it:

```bash
node scripts/emit-deps.mjs packages/<your-package>
```

This runs the `@llui/compiler` producer (`buildManifest`) over your `src/` and
writes the manifest. It's wired into `scripts/publish.sh`, so a normal publish
emits a fresh manifest automatically. Requirements:

- `@llui/compiler` must be built first (it is, in the publish/build order).
- The manifest ships because `package.json` already has `"files": ["dist"]`.
- Consumer resolution (once wired into the live transform) reads
  `<pkg>/dist/__llui_deps.json` directly via `manifest-resolve.ts`.

## What gets narrowed (and what doesn't)

The producer emits an entry for every exported helper called as
`helper(stateValue, …)` — the state value passed directly, the
`state.map(s => helper(s))` shape (`state-value` params). Each `state-value`
param records the dotted sub-paths the helper reads.

Helpers composed via **runtime Signal handles** — `connect(state.at('x'), send)`
/ `overlay({...})` — are _not_ narrowed through the manifest: `.at('x')` already
scopes them at the call site, so their state param is correctly emitted as
`opaque`. That's expected, not a gap.

## Soundness

The manifest only ever makes narrowing _more precise_; it can never cause a
missed update:

- No manifest, version-incompatible manifest, malformed JSON, or a helper the
  manifest doesn't describe → the consumer **coarsens** (re-evaluates on any
  change), exactly as before manifests existed.
- A parameter the producer can't fully characterize (passed whole, element
  access `s[k]`, delegated to an opaque call) is emitted `opaque` → coarsen.

So a partial or stale manifest is always safe — it degrades to the
pre-manifest behavior, never to a wrong one.

## Versioning

The manifest carries `version` (schema, currently 2) and `compilerVersion`. A
consumer ignores a manifest whose schema version differs or whose compiler major
doesn't match — again coarsening rather than risking a mismatched read.
