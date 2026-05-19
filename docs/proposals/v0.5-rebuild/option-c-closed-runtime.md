# Option C — Closed runtime (compile-time-spliced, no npm runtime)

## Summary

The user-facing API and runtime architecture stay identical to v0.4. The
**delivery model** changes: LLui's runtime is no longer an npm package that
consumers `import` and the bundler tree-shakes — it becomes a set of
compiler-templated **source snippets** that the vite plugin splices into
each app's bundle at build time. The compiler emits only the runtime
pieces the app actually uses.

This is a logical extension of work already shipped in v0.4: `__view`
per-component bag factories, the `__bindUncertain` compile-time
classification, the test-mode-gated `createView` fallback. Option C
generalises the pattern — every runtime piece becomes opt-in by
compile-time analysis, not import discipline.

## Motivation

The current bundle floor is determined by **what's reachable through the
import graph**, gated by `sideEffects: false` and Vite's tree-shaker. Even
with the v0.4 work, the bundle carries:

- `each.ts` in full (~16 kB raw / 5 kB minified) whenever an app uses
  `each()` — even though the app may use only the simple-key path.
- `update-loop.ts` in full whenever any component mounts — including
  features like specialised reconcile-method dispatch, dev-mode-only
  warnings (gated but still survive in some paths), version-check
  scaffolding.
- `lifetime.ts` in full — even apps without `each.transitions` or
  `onEffect` pay for the disposer-pool plumbing.

A bundler can't selectively remove pieces of these files without runtime
guarantees. A **compiler** that emits the runtime from templates can.

Concrete examples:

- App uses `each()` but never sets `opts.leave` / `opts.enter`. Today the
  `removeEntry` and `fireEnter` paths ship. Closed runtime: those code
  paths aren't emitted.
- App has no `branch()` / `show()` / `lazy()` calls. Today the structural-
  block dispatcher loop in `genericUpdate` still ships. Closed runtime:
  the loop isn't emitted (Phase 1 collapses to a no-op for apps with no
  structural primitives).
- App has 3 components total, all with ≤ 4 paths. Today the multi-word
  `maskHi` / overflow-to-FULL_MASK code in `update-loop.ts` ships even
  though it's unreachable. Closed runtime: the high-word arithmetic isn't
  emitted.

## Target metrics

- **Bundle (jfb shape):** ≤ 5 kB gz. Stretch: 3 kB gz (Solid parity for
  jfb's specific feature use).
- **Bench all ops:** identical to v0.4. No runtime semantics change.
- **Tests:** unchanged — the runtime tests still apply (the templated
  output is just an inlined version of the source they exercise today).
- **Compile time:** acceptable cost is ≤ 2× v0.4 build time (the
  templating + splicing pass adds work). Target: still ≤ 500 ms for the
  jfb bench app.

## Architecture changes

### The model

Today:

```
app's main.ts ──imports──> @llui/dom (npm package)
                                │
                              dist/*.js  (built by tsc, shipped as-is)
                                │
                              Vite bundles imports, tree-shakes unused exports
```

Option C:

```
app's main.ts ──imports──> @llui/dom (npm package — types only, runtime stubs)
                                │
                              ↓ (vite-plugin intercepts the import)
                                │
                              templates in @llui/compiler/runtime-templates/*.ts
                                │
                              splice only what's used into the app's bundle
```

The `@llui/dom` npm package becomes a **types-only shim**. Its runtime is
moved to `@llui/compiler/runtime-templates/` as TypeScript source
templates that the vite plugin reads, customises, and inlines.

### What changes

| Concept (v0.4)                                              | Concept (Option C)                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@llui/dom` ships `dist/*.js` (~36 kB on disk)              | `@llui/dom` ships only types (`.d.ts`) + a stub-only `index.js` (compile-time enforcement of the API surface) |
| Vite imports `from '@llui/dom'`, bundles the imports        | vite-plugin's `transform` hook intercepts the import, replaces with inlined runtime                           |
| Tree-shaking hopes to eliminate unused exports              | Compiler analysis (per-app, per-feature) determines which templates to emit                                   |
| Per-component `__view`, `__handlers`, `__prefixes` emission | Same emissions PLUS a per-app "runtime manifest" listing required runtime pieces                              |

### Runtime templates

The runtime is broken into ~20 templated pieces. Each piece is a TypeScript
function or class declaration. Examples:

```
runtime-templates/
  core/
    mount.ts                  # always emitted
    create-instance.ts        # always emitted
    process-messages.ts       # always emitted
    binding-registry.ts       # if any bindings (always, in practice)
    lifetime.ts               # always emitted
  paths/
    prefixes-single-word.ts   # if max path count ≤ 30
    prefixes-two-word.ts      # if 31–62 paths
    prefixes-bigint.ts        # if > 62 paths (rare; opt-in)
  primitives/
    each-keyed.ts             # if any each() call
    each-transitions.ts       # if any each.opts.enter / .leave
    each-virtual.ts           # if any virtualEach() call
    branch.ts                 # if any branch() / show() / scope()
    lazy.ts                   # if any lazy() call
    client-only.ts            # if any clientOnly() call
    selector.ts               # if any selector() call
    memo.ts                   # if any memo() call
    sample.ts                 # if any sample() call
    text.ts                   # if any text() call
    unsafe-html.ts            # if any unsafeHtml() call
    context.ts                # if any createContext()
  elements/
    el-split.ts               # if any elSplit emission
    el-template.ts            # if any elTemplate emission
    clone-static.ts           # if any __cloneStaticTemplate emission
    bind-uncertain.ts         # if any __bindUncertain emission
  dev/
    version-check.ts          # if import.meta.env.DEV
    warn-uncompiled.ts        # if import.meta.env.DEV
    devtools-hook.ts          # if @llui/dom/devtools imported
```

Each file in `runtime-templates/` is a self-contained TS module that
exports the runtime API for that feature. The vite-plugin's per-app
"runtime manifest" pass walks the app's source, determines which features
are used, and inlines the matching templates into a single
`__llui-runtime.ts` file generated per build.

### The compiler manifest pass

A new compiler module — `packages/compiler/src/modules/runtime-manifest.ts`
— that:

1. Scans the app's source for `component()` calls (already does this).
2. Walks each component's `view()` and `update()` bodies for:
   - Element-helper calls → records elements used.
   - Structural primitives (`each`, `branch`, `show`, etc.) → records
     primitive usage.
   - Optional features within primitives (`each.opts.enter`, `each.opts.leave`,
     `each.opts.onTransition`, `branch.opts.transition`) → records optional
     code paths.
   - Imports from `@llui/dom/devtools` / `/transitions` / etc. → records
     subpath features.
3. Produces a `Manifest` object: a set of feature flags.
4. Hands the manifest to the runtime-templates inlining pass, which emits
   a single `__llui-runtime.ts` file containing only the templates whose
   flags are set.

### The vite-plugin inlining pass

After the existing compile phases, before bundle finalisation:

1. Compute the manifest.
2. Read the corresponding template files from `@llui/compiler/runtime-templates/`.
3. Concatenate them, with template-time substitutions (e.g., dev-only
   blocks `// __DEV__` are stripped if `MODE === 'production'`).
4. Write the result as a virtual module `\0llui-runtime` (Vite virtual-
   module convention).
5. Rewrite all `from '@llui/dom'` imports in the user code to point at
   `\0llui-runtime`.

The bundler now sees a single virtual module containing exactly the
runtime the app needs. Tree-shaking takes care of any remaining
fine-grained dead code.

## User-facing impact

**None at the user API.** Imports look identical:

```ts
import { component, mountApp, div, each, text } from '@llui/dom'
```

The plugin handles the rewrite. The `@llui/dom` package's types-only shim
provides full IDE / type-checking support against the same API surface.

There IS a build-time impact: the vite plugin is required. Without it
(e.g., a project using webpack or esbuild directly), `@llui/dom`'s
types-only shim throws at runtime — there's no runtime to load.

Possible mitigation: ship a fallback `@llui/dom/runtime` subpath that
contains the full v0.4-style runtime as one file. Apps without vite-plugin
import that subpath manually. Worse bundle but works without the plugin.

## Migration plan

**Phase 1 — Extract the runtime into templates.** (1.5 weeks)

Take the existing `packages/dom/src/` and split each file at the
function-export boundary. Each export becomes a candidate template. Group
related exports into single template files (per the structure above).

Each template is just the existing source, copy-pasted, with a header
comment noting its feature flag (e.g.,
`// @feature: primitives.each.transitions`). No new code yet.

Measurement gate: the existing dom dist + the templates combined are
byte-equivalent to today's dist (no logic changes).

**Phase 2 — Build the manifest pass.** (1 week)

`packages/compiler/src/modules/runtime-manifest.ts` walks an app's source
and produces a Manifest. Test on the jfb bench app: confirm the manifest
correctly identifies (and excludes) unused features.

Measurement gate: bench-app manifest shows: `each.keyed = true`,
`each.transitions = false`, `branch = false`, `lazy = false`, `clientOnly =
false`, `unsafeHtml = false`, `memo = false`, `sample = false`, `context =
false`, `selector = true`, `text = true`. (Confirmed against the bench
source.)

**Phase 3 — Inlining pass.** (1.5 weeks)

`packages/vite-plugin/src/index.ts` gets a new step in the build pipeline:
after `transform`, before `generateBundle`, read the manifest and emit
`\0llui-runtime` as a virtual module. Rewrite all `from '@llui/dom'`
imports in the user code to `from '\0llui-runtime'`.

Measurement gate: the bench app builds with the inlined runtime, the
bundle is ≤ 5 kB gz, all 9 jfb operations work correctly. Bundle
composition shows zero references to dropped features (no `branch.js`, no
`lazy.js`, etc.).

**Phase 4 — Stub-only `@llui/dom`.** (3 days)

Replace `packages/dom/dist/*.js` with stub-only versions:

```ts
// stub @llui/dom/dist/index.js
export const component = () => {
  throw new Error('[llui] @llui/vite-plugin required')
}
export const mountApp = () => {
  throw new Error('[llui] @llui/vite-plugin required')
}
// ... etc.
```

The stubs throw clearly if the plugin isn't installed. The types-only
`.d.ts` files stay full so the IDE / typechecker still works.

Optional: ship a `@llui/dom/runtime-monolith` subpath with the full v0.4
runtime for apps that can't use the plugin. Same bundle as v0.4 for those
apps.

Measurement gate: bench app works via the plugin path. A separate test
app that imports from `@llui/dom/runtime-monolith` instead also works,
with bundle equal to v0.4.

**Phase 5 — Cross-package consumers.** (1 week)

`@llui/components`, `@llui/router`, `@llui/agent-bridge`, `@llui/vike`,
`@llui/mcp` — these libraries export components that themselves use
runtime features. Today they import from `@llui/dom` and consumers'
bundles include the transitive runtime.

In Option C, the cross-package case is harder: a consumer app imports a
component from `@llui/components`; the consumer's compiler needs to
know what runtime features that component uses.

Two approaches:

- **(a) Manifest declarations.** Each cross-package library ships a
  `package.json#llui-features` manifest listing its runtime needs. The
  consumer's manifest pass merges its own + all declared library manifests.
- **(b) Source-level analysis.** The consumer's compiler walks the
  library's source (not its built dist) to compute the manifest. Requires
  libraries to ship source-with-types, not just `.d.ts`.

Approach (a) is simpler; ship that first.

Measurement gate: an app using `@llui/components`' `accordion` component
builds correctly, the bundle includes only the runtime pieces the
accordion actually uses + the app's own pieces.

**Phase 6 — Docs + release.** (1 week)

Rewrite `docs/designs/02 Compiler.md` to describe the manifest +
inlining model. Add a "Cross-package authoring" section for library
authors. Update vite-plugin readme.

**Total: ~5 weeks** for a single full-time implementer.

## Implementation surface

| File / area                                         | Action                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/compiler/runtime-templates/**/*.ts`       | New directory. Move existing `packages/dom/src/*.ts` here, broken into templates. |
| `packages/compiler/src/modules/runtime-manifest.ts` | New. ~400 lines.                                                                  |
| `packages/compiler/src/runtime-inlining.ts`         | New. ~300 lines.                                                                  |
| `packages/vite-plugin/src/index.ts`                 | Wire the manifest + inlining steps into the build pipeline. ~100 lines of diff.   |
| `packages/dom/dist/*.js`                            | Replaced by stubs. Total stub: ~200 lines.                                        |
| `packages/dom/dist/*.d.ts`                          | Kept full. (The types are the API surface.)                                       |
| `packages/components/`, `packages/router/`, etc.    | Add `llui-features` manifest to each `package.json`.                              |

**LOC delta estimate:** −0 net (the runtime moves, not shrinks; total
codebase line count similar). The **shipped bundle** shrinks because
unused templates aren't emitted.

## Open questions

1. **Cross-package manifest format.** Approach (a) above needs a stable
   schema. Strawman:

   ```json
   {
     "llui-features": {
       "each": { "keyed": true, "transitions": false },
       "branch": false,
       "selector": true,
       "memo": true
     }
   }
   ```

   Versioning of the schema is a real concern — a v1-tagged library inside
   a v2-consumer build needs a fallback (default-all-true safely
   over-includes; default-all-false breaks).

2. **The `@llui/dom` types-only shim's runtime behaviour.** Stubs throw a
   clear error if called without the plugin. But what about `@llui/dom`'s
   subpath imports (`@llui/dom/devtools`, `@llui/dom/ssr`)? They need
   stubs too.

3. **SSR / `linkedom`.** SSR runs `def.view()` outside Vite's transform
   pipeline. Either the SSR adapter ships its own monolith runtime
   (regressing on the bundle savings for SSR-served pages), or SSR builds
   pass through the same compile + inline path. The second is preferable
   but requires `@llui/vike` to integrate with the manifest pass.

4. **Source maps.** With runtime inlining, stack traces point at the
   generated `\0llui-runtime` virtual module, not the original
   `@llui/dom/src/*.ts`. Source maps can fix this if templates carry
   source-position metadata.

5. **Test infrastructure.** `packages/dom/test/*.test.ts` today imports
   from `../src/...`. After the move, the source lives in
   `packages/compiler/runtime-templates/`. Tests need updated paths.
   Vitest config also needs to compile the templates the same way the
   plugin does (otherwise tests can't exercise the actual built code).

6. **`@llui/test` impact.** `@llui/test`'s `testComponent` / `testView`
   helpers wrap the runtime. If the runtime is now templated, these
   helpers need access to a "compile + inline" path too. Likely solution:
   `@llui/test` runs the compiler over the test fixture and produces a
   real bundle, evaluates it. Adds test latency.

## Failure modes

1. **The manifest analysis is too coarse-grained and over-includes.**
   E.g., a component uses `each.opts.key` but the manifest pass can't tell
   if it also uses `each.opts.enter`. Over-includes everything → no win.

   Mitigation: aggressive AST analysis. Default to over-include if
   ambiguous (correctness > bundle size).

2. **Cross-package consumers break.** A library's manifest is stale or
   wrong → consumer app crashes at runtime because a required runtime
   piece wasn't emitted.

   Mitigation: at consumer build time, validate the manifest against the
   library's source AST (if accessible). Emit a clear error if a runtime
   feature is called without its manifest entry.

3. **Build time blows up.** Reading + templating + concatenating dozens of
   files per app adds latency. Worst case: 5-second builds become
   30-second builds.

   Mitigation: cache the runtime-inlining output keyed by manifest hash.
   Invalidate only when source files in `runtime-templates/` change.

4. **Source-map quality.** Users debugging the runtime see opaque
   `\0llui-runtime.js:1234` stack frames. Existing tooling expects to
   navigate to `@llui/dom/src/each.ts`.

   Mitigation: emit source maps that point templates back to their
   original source paths. Modern source-map libraries handle this.

### Rollback plan

Phase 4's `@llui/dom` stub-only replacement is the point of no return.
Until then, the templates exist alongside the dist, and apps can use
either path. If Phases 1–3 ship and Phase 4 reveals systemic issues
(cross-package crashes, source-map breakage, build-time blowup), Phase 4
is deferred — apps continue importing from `@llui/dom` as today, the
templates are dead code. Net cost: zero user impact, some carrying cost
for the templates.

## Decision rubric

Pick Option C when:

- ✅ Bundle size is the primary goal; perf is already acceptable.
- ✅ Preserving the v0.4 user API and architecture is a hard requirement.
- ✅ Vite is the build tool of record (or we're willing to require it).
- ✅ A 5-week budget is feasible.
- ✅ The cross-package / monorepo story can absorb the manifest dance.

Don't pick Option C when:

- ❌ Perf (specifically jfb `Select`) needs to improve — Option C doesn't
  change runtime semantics, so the +9–34 % regression stays.
- ❌ The team uses webpack / esbuild / other bundlers as a hard
  requirement.
- ❌ Cross-package authoring (component libraries, route libraries) is a
  primary concern and the manifest model is unacceptable.

For perf wins, see Option B (lowest-risk) or Option A (highest-payoff).
For "no rebuild, keep tuning," see Option D.
