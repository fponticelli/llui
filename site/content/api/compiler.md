---
title: '@llui/compiler'
description: 'Engine: 3-pass TypeScript transform + 41 compile-time lint rules'
---

# @llui/compiler

Build-tool-agnostic compiler engine for [LLui](https://github.com/fponticelli/llui). It runs the 3-pass TypeScript transform (static/dynamic prop split → dependency analysis + bitmask injection → import cleanup) and enforces 41 idiomatic-LLui lint rules as compile-time errors.

This package is the engine. End users normally consume it through an adapter:

- [`@llui/vite-plugin`](/api/vite-plugin) — the Vite adapter
- [`@llui/compiler-introspection`](/api/compiler-introspection) — opt-in agent schemas + annotations
- [`@llui/compiler-devtools`](/api/compiler-devtools) — opt-in `__componentMeta` emission
- [`@llui/compiler-ssr`](/api/compiler-ssr) — opt-in `'use client'` directive handling

## Why compile-time errors, not lint warnings

All 41 rules report at **error** severity through the compiler. LLM-generated code routinely ignores lint warnings; non-bypassable compiler errors are the only effective channel for catching idiomatic-LLui mistakes before they reach the runtime.

The `@llui/eslint-plugin` package was removed when the rules migrated into this engine.

## Rule catalogue

| Rule ID                                     | Description                                                 |
| ------------------------------------------- | ----------------------------------------------------------- |
| `llui/accessibility`                        | A11y issues in element helpers                              |
| `llui/accessor-side-effect`                 | Side effects inside reactive accessor functions             |
| `llui/agent-emits-drift`                    | `@emits` annotation drifts from the Msg union               |
| `llui/agent-example-on-payload`             | `@example` annotation placed incorrectly                    |
| `llui/agent-exclusive-annotations`          | Agent-exclusive annotations used in non-agent context       |
| `llui/agent-missing-intent`                 | Agent handler missing an `@intent` annotation               |
| `llui/agent-msg-resolvable`                 | Agent handler cannot resolve a Msg                          |
| `llui/agent-nonextractable-handler`         | Agent handler cannot be statically extracted                |
| `llui/agent-optional-field-undocumented`    | Optional Msg field missing a `@should` annotation           |
| `llui/agent-tagsend-translator-missing`     | `tagSend()` is missing a translator                         |
| `llui/agent-warning-on-confirm`             | Mis-tagged confirmation annotation                          |
| `llui/async-update`                         | `async`/`await` in `update()`                               |
| `llui/bitmask-overflow`                     | Component has more than 62 state paths                      |
| `llui/controlled-input`                     | Controlled input pattern violations                         |
| `llui/direct-state-in-view`                 | Stale state capture in event handler                        |
| `llui/each-closure-violation`               | Capturing mutable outer variable inside `each()`            |
| `llui/effect-without-handler`               | Component returns effects but has no `onEffect`             |
| `llui/empty-props`                          | Empty props object — pass `null` or omit                    |
| `llui/exhaustive-effect-handling`           | `.else()` handler silently drops unhandled effects          |
| `llui/exhaustive-update`                    | `update()` does not exhaustively handle every Msg variant   |
| `llui/forgotten-spread`                     | Structural primitive result not spread into children        |
| `llui/form-boilerplate`                     | Repetitive form field pattern                               |
| `llui/imperative-dom-in-view`               | `document.querySelector` etc. in `view()`                   |
| `llui/map-on-state-array`                   | `.map()` on a state array (use `each()`)                    |
| `llui/missing-memo`                         | Expensive derived computation without `memo()`              |
| `llui/namespace-import`                     | Namespace import where a named import is required           |
| `llui/nested-send-in-update`                | Calling `send()` inside `update()`                          |
| `llui/no-barrel-import-when-subpath-exists` | Use the subpath export, not the barrel                      |
| `llui/no-eager-item-accessor`               | Eager item-accessor evaluation                              |
| `llui/no-let-reactive-accessor`             | `let`-bound reactive accessor                               |
| `llui/no-list-render-in-sample`             | List rendering inside `sample()`                            |
| `llui/no-sample-in-accessor`                | `sample()` used inside a reactive accessor                  |
| `llui/no-sample-in-reactive-position`       | `sample()` used in a reactive position                      |
| `llui/pure-update-function`                 | `update()` has side effects                                 |
| `llui/spread-in-children`                   | `show()`/`branch()`/`each()` used without spread            |
| `llui/state-mutation`                       | Direct mutation of state in `update()`                      |
| `llui/static-items`                         | Static items emitted incorrectly                            |
| `llui/static-on`                            | Static `on*` handler emitted incorrectly                    |
| `llui/string-effect-callback`               | Deprecated string-based `onSuccess`/`onError`               |
| `llui/subapp-requires-reason`               | `subApp` call missing a non-empty `reason`                  |
| `llui/view-bag-import`                      | Direct import of view-bag primitives (use destructured bag) |

<!-- auto-api:start -->

## Functions

### `substituteHelperCall()`

Substitute a manifest helper call against its call-site arguments.
Given a helper's manifest entry and the argument expressions at one call
site, returns the set of host-state paths the call contributes to the
consumer's \_\_prefixes table.
§4.4 substitution rules:

1. For each ViaParams entry, resolve the call-site argument.
2. `shape: 'accessor'` parameters are walked via `extractPaths`.
3. `shape: 'options-bag'` parameters are unpacked field-by-field
   against the call site's object-literal argument.
4. `innerReads` are composed against the resolved accessors:
   - rooted: helper-local, contributed verbatim
   - param-result: paths from param N's body
   - param-result-path: lift + sub-path composition
5. `readsThroughResultOf: N` — param's body operates on param N's
   result; substitution composes through N's accessor.
6. `contextReads` — resolved against `providers`; provider.accessor +
   subPaths compose to host-state paths.
7. Depth bounded at 8; cycles caught by `(helper-symbol, param-index)`
   visited set.

```typescript
function substituteHelperCall(
  entry: HelperEntry,
  callArgs: ReadonlyArray<ts.Expression>,
  ctx: SubstitutionContext,
  helperKey = 'anonymous',
  visited = new Set<string>(),
  depth = 0,
): SubstitutionResult
```

### `serializeManifest()`

Serialize a manifest to stable, diff-friendly JSON: object keys sorted
(so re-emits are byte-identical regardless of insertion order), arrays left
in their meaningful order (e.g. `viaParams` is index-ordered). 2-space indent

- trailing newline to match the repo's prettier output.

```typescript
function serializeManifest(manifest: Manifest): string
```

### `parseManifest()`

Parse + validate a manifest JSON string. Validation is intentionally shallow
but covers everything the substitution engine iterates (`helpers[*].kind`,
`.viaParams[*].shape`, `.index`) so a malformed third-party manifest can't
crash the consumer's compile. Schema `version` must equal the current
`MANIFEST_SCHEMA_VERSION` and the emitting `compilerVersion`'s major must
match this compiler.

```typescript
function parseManifest(json: string): ParseManifestResult
```

### `clearManifestCache()`

```typescript
function clearManifestCache(): void
```

### `lookupHelperFromSymbol()`

Resolve the manifest helper entry for a call-site callee symbol.
@param sym the (possibly aliased) symbol of the call target
@param checker the program's type checker

```typescript
function lookupHelperFromSymbol(sym: ts.Symbol, checker: ts.TypeChecker): ManifestLookupResult
```

### `buildManifest()`

Build a manifest from a package's source program. Only emits entries that
carry useful narrowing info (at least one `state-value` param with reads);
helpers that would contribute nothing are omitted (a missing entry coarsens
identically, so this just keeps the manifest lean).

```typescript
function buildManifest(program: ts.Program, opts: BuildManifestOptions): Manifest
```

## Types

### `ParamSpec`

```typescript
export type ParamSpec =
  | { index: number; shape: 'accessor'; innerReads: InnerRead[] }
  | {
      index: number
      shape: 'accessor'
      /** This parameter's body operates on the result of parameter N. */
      readsThroughResultOf: number
      innerReads: InnerRead[]
    }
  /**
   * The parameter is the STATE VALUE itself, passed directly (not via an
   * accessor function): `helper(s)` inside `state.map(s => helper(s))`. `reads`
   * are the dotted sub-paths the helper reads from that value; substitution
   * composes them onto the call-site argument's path prefix
   * (`s` → '', `s.foo` → 'foo'). Added in schema v2.
   */
  | { index: number; shape: 'state-value'; reads: string[] }
  | { index: number; shape: 'options-bag'; fields: Record<string, FieldSpec> }
  | { index: number; shape: 'send' }
  | { index: number; shape: 'thunk-returning-nodes' }
  | { index: number; shape: 'opaque' }
```

### `FieldSpec`

```typescript
export type FieldSpec =
  | { shape: 'accessor'; innerReads: InnerRead[] }
  | {
      shape: 'accessor'
      readsThroughResultOf: number
      innerReads: InnerRead[]
    }
  | { shape: 'state-value'; reads: string[] }
  | { shape: 'send' }
  | { shape: 'thunk-returning-nodes' }
  | { shape: 'opaque' }
```

### `InnerRead`

```typescript
export type InnerRead =
  /** Helper-local read — rare; the helper sees state directly. */
  | { kind: 'rooted'; path: string }
  /** The entire result of parameter N. */
  | { kind: 'param-result'; from: number }
  /** A sub-path within parameter N's accessor result. The dominant kind across @llui/components. */
  | { kind: 'param-result-path'; from: number; path: string }
```

### `ParseManifestResult`

```typescript
export type ParseManifestResult =
  | { ok: true; manifest: Manifest }
  /** `incompatible` = readable but the schema/compiler version doesn't match;
   *  `malformed` = unparseable or structurally wrong. Both → caller coarsens. */
  | { ok: false; reason: 'incompatible' | 'malformed'; detail: string }
```

### `ManifestLookupResult`

```typescript
export type ManifestLookupResult =
  | { kind: 'found'; lookup: ManifestHelperLookup }
  /** No package / no manifest file — coarsen silently (the common case). */
  | { kind: 'absent' }
  /** Manifest present but version-incompatible — coarsen + emit a diagnostic. */
  | { kind: 'incompatible'; detail: string }
  /** Manifest present but unparseable/structurally wrong — coarsen + emit a diagnostic. */
  | { kind: 'malformed'; detail: string }
```

## Interfaces

### `Manifest`

```typescript
export interface Manifest {
  /** Schema version. Currently 2 (see `MANIFEST_SCHEMA_VERSION`). */
  version: 2
  /** Compiler version that emitted this manifest. */
  compilerVersion: string
  /** Exported helpers keyed by name. */
  helpers: Record<string, HelperEntry>
  /** Exported components keyed by name (for completeness; not used in v2b's substitution). */
  components: Record<string, ComponentEntry>
}
```

### `HelperEntry`

```typescript
export interface HelperEntry {
  /**
   * `'view-helper'` — the call returns Node[]-like and is resolved once per
   * call site.
   * `'parts-helper'` — the call returns a *parts bag* (a record of accessor
   * thunks). The bag is later spread into element calls by the consumer;
   * every spread contributes the same read set.
   */
  kind: 'view-helper' | 'parts-helper'
  /** Paths the helper reads from its OWN state shape (rare; usually empty). */
  helperLocalPaths: string[]
  /** Per-parameter substitution metadata. Index N corresponds to the helper's Nth declared parameter. */
  viaParams: ParamSpec[]
  /** Context-provider keys this helper consumes. Resolved against the consumer's provide() call sites. */
  contextReads?: ContextRead[]
}
```

### `ComponentEntry`

```typescript
export interface ComponentEntry {
  /** Reserved for v2b's read-everything-the-component-reads escape hatch. Unused at v2b ship. */
  name: string
}
```

### `ContextRead`

```typescript
export interface ContextRead {
  /** Canonical id: `<package-name>#<export-name>`. */
  context: string
  /** Sub-paths within the context value the helper reads. */
  subPaths: string[]
}
```

### `ContextProvider`

```typescript
export interface ContextProvider {
  context: string
  /** Source AST for the consumer's `provide(LocaleContext, (s) => s.i18n, ...)` accessor. */
  accessor: ts.ArrowFunction | ts.FunctionExpression | undefined
}
```

### `SubstitutionContext`

```typescript
export interface SubstitutionContext {
  /** Maps canonical context ids to the consumer's matching provide(...) accessor. */
  providers: Map<string, ContextProvider>
  /**
   * Path-extraction hook. Walks an arrow body and returns the dotted paths
   * it reads. The cross-file walker injects its `extractAccessorPaths`
   * here; tests can stub with a simpler walker.
   */
  extractPaths: (
    accessor: ts.ArrowFunction | ts.FunctionExpression,
    rootParamName: string,
  ) => string[]
  /**
   * The enclosing reactive accessor's root parameter name — the `s` in
   * `state.map(s => helper(s))` — used to resolve bare `state-value` args.
   * Absent for accessor-function-only call contexts; then `state-value` params
   * coarsen to FULL_MASK.
   */
  rootParamName?: string
  /**
   * Extract the dotted path a VALUE expression denotes relative to
   * `rootParamName` (`s` → '', `s.foo.bar` → 'foo.bar'); returns null when the
   * expression is not rooted at the param (so the call coarsens). Injected by
   * the cross-file walker; tests may stub it.
   */
  extractValuePath?: (expr: ts.Expression, rootParamName: string) => string | null
}
```

### `SubstitutionResult`

```typescript
export interface SubstitutionResult {
  /** Host-state paths contributed by this call site, e.g. `['carousel.paused', 'carousel.current']`. */
  paths: string[]
  /** Diagnostics emitted by the substitution. */
  diagnostics: SubstitutionDiagnostic[]
  /** Whether the call site fell back to FULL_MASK (e.g. unrecognized options-bag shape). */
  fullMask: boolean
}
```

### `SubstitutionDiagnostic`

```typescript
export interface SubstitutionDiagnostic {
  id:
    | 'llui/opaque-options-bag'
    | 'llui/missing-context-provider'
    | 'llui/substitution-depth-exceeded'
    | 'llui/substitution-cycle'
  message: string
}
```

### `ManifestHelperLookup`

```typescript
export interface ManifestHelperLookup {
  manifest: Manifest
  packageName: string
  /** `<moduleId>#<exportName>`, the canonical helper key (also used as the substitution label). */
  helperKey: string
  /** The matched entry, or undefined when the package ships a manifest but not this helper. */
  entry: HelperEntry | undefined
}
```

### `BuildManifestOptions`

```typescript
export interface BuildManifestOptions {
  /** Absolute path to the package's source root (e.g. `<pkg>/src`); module ids are relative to it. */
  srcRoot: string
}
```

## Constants

### `MANIFEST_SCHEMA_VERSION`

Current manifest schema version. Bumped 1→2 to add the `state-value`
param/field shape (helpers called as `helper(s)` with the state value passed
directly, e.g. `state.map(s => itemFill(s, i))`), which v1's accessor-function
shapes could not express. Consumers reject other majors via `compilerVersion`.

```typescript
const MANIFEST_SCHEMA_VERSION
```

### `HELPER_KEY_SEP`

Canonical module-id separator in helper keys: `<moduleId>#<exportName>`.

```typescript
const HELPER_KEY_SEP
```

### `MANIFEST_RELATIVE_PATH`

The well-known on-disk location, relative to a published package root.

```typescript
const MANIFEST_RELATIVE_PATH
```

<!-- auto-api:end -->
