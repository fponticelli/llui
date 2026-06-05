---
title: '@llui/compiler'
description: 'Engine: the signal TypeScript transform (view lowering + introspection) + compile-time lint rules'
---

# @llui/compiler

Build-tool-agnostic compiler engine for [LLui](https://github.com/fponticelli/llui). It runs the **signal transform** — lowering signal expressions in a component's direct view to runtime helpers (`signalText`/`el`/`signalEach`/…) and emitting introspection metadata — and enforces the signal lint set as non-bypassable compile-time errors.

This package is the engine. End users normally consume it through an adapter:

- [`@llui/vite-plugin`](/api/vite-plugin) — the Vite adapter
- [`@llui/compiler-introspection`](/api/compiler-introspection) — opt-in agent schemas + annotations
- [`@llui/compiler-devtools`](/api/compiler-devtools) — opt-in `__componentMeta` emission
- [`@llui/compiler-ssr`](/api/compiler-ssr) — opt-in `'use client'` directive handling

## Why compile-time errors, not lint warnings

Every rule reports at **error** severity through the compiler. LLM-generated code routinely ignores lint warnings; non-bypassable compiler errors are the only effective channel for catching idiomatic-LLui mistakes before they reach the runtime.

The `@llui/eslint-plugin` package was removed when the rules migrated into this engine — they are compiler errors now, never ESLint rules.

## Rule catalogue

**Signal lint rules** — checked against signal expressions in a component's view:

| Rule ID                        | Description                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `operator-on-signal`           | A JS operator used on a signal handle (`sig + 1`, `` `${sig}` ``, `sig ? a : b`) — derive with `.map`     |
| `peek-in-slot`                 | `.peek()` in a reactive slot — binds once and never updates; `.peek()` is for handlers/effects only       |
| `pure-derive-body`             | A `.map`/derive body that isn't pure over plain values (side effects, `.at`/`.map`/`.peek`, node helpers) |
| `no-node-construction-in-body` | Building element/text nodes inside a derive body — use a structural primitive (`show`/`branch`/`each`)    |
| `prefer-at-over-map`           | `state.map((s) => s.x)` where `state.at('x')` is the more precise, narrower read                          |

**Cross-file / composition diagnostics** — view-helper resolution, dependency flow, and module emission:

| Rule ID                            | Description                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `llui/opaque-view-call`            | A view-position call the cross-file walker can't analyze — annotate `Renderable`/`Mountable`, accept a view bag, or `/** @llui-helper */` |
| `llui/async-view-helper`           | A view-helper returns a `Promise` — the view layer is synchronous; use `onMount()` / `clientOnly()`                                       |
| `llui/opaque-state-flow`           | State flows opaquely through an accessor — coarsens the binding to the whole-state sentinel                                               |
| `llui/opaque-options-bag`          | A helper's options-bag argument isn't an object literal, so its dependency paths can't be narrowed                                        |
| `llui/missing-context-provider`    | A precompiled helper reads a context with no matching `provide(...)` at the consumer's call site                                          |
| `llui/helper-cycle`                | A cycle in the cross-file view-helper graph                                                                                               |
| `llui/substitution-cycle`          | A cycle while substituting a precompiled library helper's dependency paths                                                                |
| `llui/substitution-depth-exceeded` | A precompiled-helper substitution chain exceeded the depth limit (coarsens that call site)                                                |
| `llui/module-emission-conflict`    | Two compiler modules tried to emit conflicting output for the same node                                                                   |

Opt-in modules add their own checks: `@llui/compiler-introspection` enforces the agent
annotation rules (`@intent` / `@emits` / `@should` / `tagSend` translators); see its API page.

<!-- auto-api:start -->

## Functions

### `resolveLocalConstInitializer()`

Walk parent chains to find a `const X = ...` declaration matching
`use.text`, or a hoisted `function X(...)` declaration. Returns the
resolved declaration or `null` for unresolvable references (imports,
parameters, this-bindings, etc.).
Limitations:

- Only `const`. `let` resolution is unsafe — we can't track later
  reassignments without a type checker.
- Only single-binding declarations (`const a = …`, not `const a = …, b = …`).
- The declaration must dominate the use (lexical scope).

```typescript
function resolveLocalConstInitializer(
  use: ts.Identifier,
): ts.Expression | ts.FunctionDeclaration | null
```

### `isMemoCallWithArrowArg()`

Recognize `memo(arrow)` / `memo(fn)` calls so the inner accessor can
be analyzed for state-path masking. The runtime `memo()` returns a
cached accessor — its body's reads determine when it re-evaluates,
not the call site.

```typescript
function isMemoCallWithArrowArg(expr: ts.Expression): expr is ts.CallExpression & {
  arguments: readonly [ts.ArrowFunction | ts.FunctionExpression, ...ts.Expression[]]
}
```

### `resolveAccessorBody()`

Resolve a value at a reactive-accessor position down to the callable
AST node we can mask-analyze. Returns `null` when the value isn't a
recognized accessor shape — caller leaves the call unchanged (runtime
falls back to FULL_MASK, which is correct just slower).
Recognized shapes:

- `(s) => …` (ArrowFunction)
- `function (s) { … }` (FunctionExpression)
- `memo((s) => …)` — returns the inner arrow
- `someIdentifier` resolving to any of the above (or to a hoisted
  `function X(s) { … }` declaration)
  When `checker` is supplied, identifier resolution follows alias chains
  across files: `import { matrixOrEmpty } from '../state'` becomes
  resolvable. Without a checker the resolver falls back to file-local
  `const`/`function` lookup. The cross-file path requires the
  identifier's AST node to be bound to the checker's Program — pass
  nodes obtained via `program.getSourceFile(...)`, not from a freshly
  `ts.createSourceFile`'d copy. (See AnalysisContext.program.)

```typescript
function resolveAccessorBody(
  value: ts.Expression,
  checker?: ts.TypeChecker,
): ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | null
```

### `tagDispatchHandlers()`

Walks every `ArrowFunction` and `FunctionExpression` in the source
and wraps any whose body contains literal `<id>({type:'X', …})`
dispatches with `Object.assign(fn, {__lluiVariants: ['X', …]})`.
The runtime (in `@llui/dom` `elements.ts` / `el-split.ts`) reads
`__lluiVariants` from event-handler bindings only — so tags placed
on functions in non-handler positions (a const declared but never
bound, an arrow passed to `Array.filter`, a view function whose
body has nested handlers with dispatches) are runtime-inert. The
compiler tags generously; the runtime registers selectively.
Universal scope means three concrete patterns all surface their
variants without the app author having to think about it:

1. **Inline event-handler arrows** —
   `onClick: () => send({type:'X'})` (the original Pass 1 case).
2. **Const-bound translator functions** —
   `const sendMenu = (m) => dispatch({type:'Y'})` paired with
   `*.connect(get, sendMenu, …)` (the original Pass 3 case). The
   tag travels with the function reference; library connect impls
   use `tagSend(send, libVariants, fn)` to propagate it onto
   returned handlers.
3. **Positional-arg handlers** —
   `helper(label, () => send({type:'Z'}))` where `helper` is an
   app-defined wrapper like `navButton(label, onClick)` that
   eventually binds the function as an event listener. The arrow
   is still tagged at its declaration site, and the runtime reads
   the tag when the wrapper binds it.
   False positives are deliberate. The alternative — proving that a
   tagged arrow actually reaches an event-handler binding — would
   require cross-function, cross-file flow analysis the compiler
   doesn't do. In practice the cost of an over-tagged arrow is bytes,
   not behavior: the runtime never reads the tag from non-handler
   bindings.
   Pass 2's `collectLocalFns` resolves identifiers to their original
   arrow/function initializers; this pass replaces those initializers
   with `Object.assign(arrow, {…})` wrappers. Run Pass 2 BEFORE Pass 1
   so the resolver still sees raw arrows.
   Already-wrapped functions (CallExpressions, including user-applied
   `tagSend(...)` or this pass's own prior output) are skipped — the
   pass only fires on bare arrow/function expressions.

```typescript
function tagDispatchHandlers(node: ts.SourceFile, f: ts.NodeFactory): ts.SourceFile
```

### `injectScopeVariantRegistrations()`

```typescript
function injectScopeVariantRegistrations(node: ts.SourceFile, f: ts.NodeFactory): InjectResult
```

### `shadowsStateParam()`

Returns true when one of the function's parameter bindings would
shadow an outer identifier named `stateParam`. Covers identifier
params (`(s) => …`), simple destructured patterns (`({s}) => …`),
and array patterns (`([s]) => …`). Tracking shadowing avoids a
common false positive where a nested arrow's `s` is mis-attributed
to the outer accessor's state parameter — most notably bites the
`track({ deps: (s) => [...] })` escape hatch when the outer
accessor is also `(s) => …`.

```typescript
function shadowsStateParam(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  stateParam: string,
): boolean
```

### `detectOpaqueStateFlow()`

```typescript
function detectOpaqueStateFlow(body: ts.Node, stateParam: string, out: OpaqueOut): void
```

### `collectStatePathsFromSource()`

Walk the AST and collect every unique state access path referenced by
a reactive accessor. A reactive accessor is one of:

- An inline arrow / function expression at a reactive position
  (`text(s => s.count)`, `div({ title: s => s.title })`,
  `show({ when: s => s.gated })`, etc.).
- An Identifier at a reactive position that resolves to a callable
  in this file — a const-bound arrow / function expression,
  a hoisted function declaration, or `const x = memo(arrow)`.
  The second case lets authors refactor a literal arrow into a named
  helper without the analyzer losing its dependency paths. When a reactive
  accessor can't be resolved, the file is marked opaque and the runtime
  coarsens those bindings to the whole-state sentinel (correct, but every
  such binding fires on every state change).
  The emitted dependency paths feed the runtime's chunked-mask reconciler
  (each binding's `deps` array). `collectDeps` (below) is the string-input
  convenience wrapper.

```typescript
function collectStatePathsFromSource(sourceFile: ts.SourceFile): {
  paths: Set<string>
  opaque: boolean
  opaqueNode?: ts.Node
  opaqueShape?: string
}
```

### `collectDeps()`

String-input convenience over {@link collectStatePathsFromSource}: parse a
source file and return the sorted set of unique state dependency paths read
by its reactive accessors, plus the opaque-flow flag. These are the paths
the runtime's chunked-mask reconciler gates each binding on.
Files that don't import from `@llui/dom` return an empty set. `extraPaths`
(paths discovered through in-repo view-helpers in _other_ files, via the
cross-file walker) are unioned in so cross-file helpers contribute to the
consumer's dependency set.

```typescript
function collectDeps(
  source: string,
  extraPaths?: ReadonlySet<string>,
): {
  paths: string[]
  opaque: boolean
  /** AST node that first triggered the opaque-flow flag (if any). */
  opaqueNode?: ts.Node
  /** Short human label for the opaque shape. */
  opaqueShape?: string
}
```

### `isReactiveAccessor()`

Determines if a node is at a reactive-accessor position — either an
inline arrow / function expression OR an identifier that's about to
be resolved to one. The check is identity-based on `parent.arguments[0]`
etc., so the same logic works for both shapes.
Exported so the cross-file walker can use the same gate. Without this
gate the walker descends into every 1-param arrow in the file —
including `onEffect: (bag) => bag.send(...)` — and pollutes
`__prefixes` with non-state property names (issue #5, bug 3).

```typescript
function isReactiveAccessor(node: ts.Node): boolean
```

### `extractPaths()`

Extract state access paths from an expression body.
Handles:

- Direct property access: param.field, param.field.subfield
- Bracket notation with string literal: param['field']

```typescript
function extractPaths(node: ts.Node, paramName: string, _prefix: string, paths: Set<string>): void
```

### `findTypeSource()`

Walk imports + re-exports to find where a type alias is actually
declared. Returns the source string and local name of the alias in
its declaring file. Returns `null` if the chain leads to an unresolved
module, a re-export through `export *`, a namespace import, or a
dead-end (alias not declared anywhere we can see).

```typescript
function findTypeSource(
  typeName: string,
  source: string,
  filePath: string,
  ctx: ResolveContext,
  visited: Set<string> = new Set(),
): Promise<ResolvedTypeSource | null>
```

### `extractMsgAnnotationsCrossFile()`

Annotation extractor that walks composed Msg unions across files.
Given a Msg type that may be a union of inline `{ type: 'literal' }`
objects AND TypeReferences (e.g.
`type Msg = ImportedFoo | { type: 'extra' }`), recursively follow
each TypeReference via `findTypeSource` and merge its variants into
the returned map.
Composition + cross-file is the union of two failure modes the
file-local sync extractor silently mishandles. This function
produces the same map the runtime expects regardless of how the
developer organized the type declarations.
Conflict policy: if two composed branches contribute the same
discriminant string (e.g. both halves declare `{ type: 'inc' }`),
the first one walked wins. The lint rule `agent-msg-resolvable`
fires before this point on most pathological cases; ESLint's
type-checker would flag the duplicate independently.

```typescript
function extractMsgAnnotationsCrossFile(
  source: string,
  typeName: string,
  filePath: string,
  ctx: ResolveContext,
): Promise<Record<string, MessageAnnotations> | null>
```

### `extractDiscriminatedUnionSchemaCrossFile()`

Cross-file companion to `extractMsgSchema` / `extractEffectSchema`.
Discriminated-union schema extractor that follows composed
TypeReferences through the resolver. Same recursion shape as
`extractMsgAnnotationsCrossFile`, just collecting field shapes
instead of JSDoc annotations.

```typescript
function extractDiscriminatedUnionSchemaCrossFile(
  source: string,
  typeName: string,
  filePath: string,
  ctx: ResolveContext,
): Promise<MsgSchema | null>
```

### `readComponentTypeArgNames()`

Inspect the type arguments of a `component<...>()` call and return
the textual identifier for each known position. Returns `null` for
positions whose type argument isn't a plain identifier (e.g.
inline literal types, generic instantiations, namespace-qualified
names). Identifiers are what the resolver can chase; everything else
we leave to the local extractor's existing behavior.
Order: `[State, Msg, Effect]` matching `component<State, Msg, Effect>`.

```typescript
function readComponentTypeArgNames(call: ts.CallExpression): {
  state: string | null
  msg: string | null
  effect: string | null
}
```

### `classifyViewHelper()`

Classify the symbol's declaration against the §2.1 rule.
Operates on the _declared_ type (`getTypeOfSymbolAtLocation(symbol,
symbol.declarations[0])`), not the inferred-at-call-site type. This is
load-bearing: TypeScript inference at call sites widens to union
shapes (`Node[] | undefined`, `JSX.Element | string`) that miss
assignability for case 2. The rule's intent is "did the author commit
to a view-helper signature in the declaration" — inference-narrowed
types don't satisfy that intent.

```typescript
function classifyViewHelper(symbol: ts.Symbol, checker: ts.TypeChecker): ViewHelperClassification
```

### `walkProgram()`

Walk a Program looking for call expressions that should be classified
by the §2.1 rule. Restricts the walk to files matching `filter` so
tests can scope to a subdirectory.

```typescript
function walkProgram(
  program: ts.Program,
  options: { filter?: (sourceFile: ts.SourceFile) => boolean } = {},
): WalkerResult
```

### `toCanonicalDiagnostic()`

Convert a walker-internal diagnostic to the canonical `Diagnostic`
shape. Reads the source text (for line/column resolution) and a
project root (for path relativization).

```typescript
function toCanonicalDiagnostic(
  d: WalkerDiagnostic,
  sourceText: string,
  projectRoot: string,
): Diagnostic
```

### `crossFileAccessorPaths()`

Collect the cross-file union of accessor paths read from a focal file.
Returns the union over every reactive accessor in `focalFile`, with
cross-file view-helper descents merged in.
Reactive-accessor entry is gated by `isReactiveAccessor` (the same
predicate the file-local `collect-deps` walker uses) _plus_ a
cross-file extension: an arrow at the first-arg position of a call
to a §2.1 view-helper also counts as reactive, because that's the
lift the helper applies to our state.
Without the gate, every 1-param arrow in the file gets walked —
including `onEffect: (bag) => bag.send(...)`, where `bag.send` ends
up in the path set as a phantom "send" prefix. Issue #5, bug 3.

```typescript
function crossFileAccessorPaths(
  program: ts.Program,
  focalFile: ts.SourceFile,
): { paths: Set<string>; opaque: boolean; opaqueNode?: ts.Node }
```

### `rangeFromOffsets()`

Convert a TS Compiler API `(start, end)` offset pair against a source
file into the canonical `Range` shape. Used by emitters that have AST
node positions but not pre-computed line/column.

```typescript
function rangeFromOffsets(sourceText: string, start: number, end: number): Range
```

### `relativizeFile()`

Project-relative path helper. Adapters pass the project root resolved
from `llui.config.ts` / Vite's `config.root`; emitters that have an
absolute path use this to canonicalize before placing into a
Diagnostic. Falls back to the absolute path if `root` is empty or
the file isn't a descendant.

```typescript
function relativizeFile(absoluteFile: string, root: string): string
```

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

### `transformSignalComponentSource()`

Rewrite signal `view`s in a source file and inject the runtime import.
Returns the source unchanged if it contains no signal components.

```typescript
function transformSignalComponentSource(source: string, opts: SignalTransformOptions = {}): string
```

### `lintSignalSource()`

Parse `source` and run the signal lint rules, returning diagnostics with
resolved line/column. The adapter (vite plugin) surfaces these as build
errors. Call only on confirmed signal components.

```typescript
function lintSignalSource(source: string, fileName = 'm.tsx'): SignalLintMessage[]
```

### `registerIntrospectionFactory()`

Register the introspection module factory. Called once per process
by `@llui/compiler-introspection`'s init code (or by test setup /
vite-plugin's import side-effect). Subsequent registrations replace
the previous; that's intentional for test isolation.

```typescript
function registerIntrospectionFactory(factory: IntrospectionFactory | null): void
```

### `getIntrospectionFactory()`

Used by transformLlui to retrieve the registered factory. Returns
`null` when no factory is registered (introspection disabled).

```typescript
function getIntrospectionFactory(): IntrospectionFactory | null
```

### `registerDevtoolsFactory()`

```typescript
function registerDevtoolsFactory(factory: DevtoolsFactory | null): void
```

### `getDevtoolsFactory()`

```typescript
function getDevtoolsFactory(): DevtoolsFactory | null
```

### `findComponentCalls()`

Walk a SourceFile and collect every `component(...)` CallExpression.
Used by per-target emission modules to capture their targets in `emit`
(not `visit`) so the refs match the post-Phase-2b AST.
Phase 2b's `transformCall*` hooks rebuild ancestor nodes via
`ts.visitEachChild` whenever any descendant is rewritten — e.g. a
`text()` rewrite inside a `component()` call's view ladder
invalidates every component-call ref captured during the visitor
walk (Phase 2). Calling `findComponentCalls(analysis.sourceFile)` in
`emit` returns refs into the post-Phase-2b tree, which is the same
tree the umbrella's per-statement visitor walks.

```typescript
function findComponentCalls(sf: ts.SourceFile): ts.CallExpression[]
```

### `hasNonDefaultAnnotation()`

Whether the annotation map carries any non-default values. Used to
gate `__msgAnnotations` emission — annotations whose every field is
default are emission-redundant (the runtime treats absence as the
same defaults). Saves ~50 bytes per component for un-annotated Msg
unions, which dominates the corpus.

```typescript
function hasNonDefaultAnnotation(a: Record<string, MessageAnnotations>): boolean
```

### `annotationsToObjectLiteral()`

Build a TS object-literal expression for the annotation map. Used by
`msgAnnotationsModule` for `__msgAnnotations` emission. Variant
names are emitted as string literals (not identifiers) so
discriminants containing `/`, `-`, reserved words, etc. produce
valid JS.

```typescript
function annotationsToObjectLiteral(
  a: Record<string, MessageAnnotations>,
): ts.ObjectLiteralExpression
```

### `extractMsgAnnotations()`

Walk a Msg-like discriminated-union type alias and extract JSDoc
annotations attached to each union member. Returns null if no
recognizable union is found so callers can skip emission cleanly.
Expected JSDoc grammar (order-independent):
@intent("human readable")
@alwaysAffordable
@requiresConfirm
@humanOnly — sugar for dispatchMode: 'human-only'
@agentOnly — sugar for dispatchMode: 'agent-only'
Unknown tags are ignored; malformed @intent (no quoted string) is
treated as "no intent". `@humanOnly` and `@agentOnly` are mutually
exclusive — if both are present (which the ESLint rule
`agent-exclusive-annotations` reports as an error), the parser
falls back to `'shared'` so a misconfigured Msg variant doesn't
silently lock out one audience.

```typescript
function extractMsgAnnotations(
  source: string,
  typeName: string = 'Msg',
): Record<string, MessageAnnotations> | null
```

### `parseAnnotations()`

Parse a JSDoc comment string into `MessageAnnotations`. The single
source of truth for the annotation grammar — used both for same-file
Msg unions (here) and for cross-file resolution
(`cross-file-resolver.ts` imports this rather than re-implementing it,
so the two paths can't drift).

```typescript
function parseAnnotations(comment: string): MessageAnnotations
```

### `isRichField()`

True when `f` is a rich descriptor (object with `type` key).

```typescript
function isRichField(f: MsgField): f is MsgFieldRich
```

### `buildFieldDescriptorExpr()`

Build a TS expression for a single field descriptor in a MsgSchema's
variant map. Used by `msgSchemaToLiteral` (this file) for the
`__msgSchema` / `__effectSchema` emissions. Migrated from inline
`buildFieldDescriptorExpr` in transform.ts (v2c/decomp-5).

```typescript
function buildFieldDescriptorExpr(descriptor: MsgField, f: ts.NodeFactory): ts.Expression
```

### `msgSchemaToLiteral()`

Build the full `{ discriminant, variants }` object literal for a
MsgSchema. Symmetric for `__msgSchema` and `__effectSchema` emission
(both use the discriminated-union shape).

```typescript
function msgSchemaToLiteral(schema: MsgSchema, f: ts.NodeFactory): ts.ObjectLiteralExpression
```

### `fieldType()`

Extracts the bare type from either descriptor form.

```typescript
function fieldType(f: MsgField): MsgFieldType
```

### `extractMsgSchema()`

```typescript
function extractMsgSchema(source: string, typeName: string = 'Msg'): MsgSchema | null
```

### `extractEffectSchema()`

```typescript
function extractEffectSchema(source: string, typeName: string = 'Effect'): MsgSchema | null
```

### `buildFieldDescriptor()`

Build a single field descriptor from a property signature: type,
optionality, and any `@should("…")` JSDoc hint. Emits the compact
bare form when there's nothing extra to communicate; otherwise the
rich `{type, optional?, priority?, hint?}` shape.
Exported so the cross-file resolver (which walks the same property
signatures when the Msg type lives in a different file from the
`component()` call) can produce identical descriptors. Without
sharing this helper, JSDoc hints would silently disappear whenever
a Msg union got resolved across module boundaries.

```typescript
function buildFieldDescriptor(
  member: ts.PropertySignature,
  source: string,
  typeIndex: TypeIndex = new Map(),
): MsgField
```

### `resolveFieldType()`

```typescript
function resolveFieldType(
  type: ts.TypeNode,
  typeIndex: TypeIndex = new Map(),
  depth = MAX_FIELD_DEPTH,
): MsgFieldType
```

### `computeSchemaHash()`

Stable hex SHA-256 (first 32 chars) over a normalized JSON serialization
of msgSchema + stateSchema + msgAnnotations. Object key order is
normalized so equivalent inputs always produce equal hashes.
Used by the runtime to detect when the browser-to-server `hello` frame
needs to re-send its schema payload (dev hot-reload).

```typescript
function computeSchemaHash(input: SchemaHashInput): string
```

### `stateTypeToLiteral()`

Build a TypeScript expression representing the given StateType as a
runtime-readable literal. The emission shape mirrors the StateType
tagged union — `string`/`number`/`boolean`/`unknown` become string
literals; the structural kinds become object literals with a `kind`
field plus the appropriate payload (`of`/`fields`/`values`).
Used by `stateSchemaModule` for `__stateSchema` emission. The shape
is the runtime/agent contract; downstream tools (MCP introspection,
agent's "what type is this field?") consume it.

```typescript
function stateTypeToLiteral(t: StateType, f: ts.NodeFactory): ts.Expression
```

### `extractStateSchema()`

```typescript
function extractStateSchema(source: string, typeName = 'State'): StateSchema | null
```

## Types

### `CompilerRenameableKey`

```typescript
export type CompilerRenameableKey = (typeof COMPILER_RENAMEABLE_KEYS)[number]
```

### `CompilerDomInternalImport`

```typescript
export type CompilerDomInternalImport = (typeof COMPILER_DOM_INTERNAL_IMPORTS)[number]
```

### `ViewHelperKind`

```typescript
export type ViewHelperKind = 'walked' | 'opaque' | 'async' | 'not-a-helper'
```

### `DiagnosticId`

```typescript
export type DiagnosticId = 'llui/opaque-view-call' | 'llui/async-view-helper' | 'llui/helper-cycle'
```

### `DiagnosticSeverity`

```typescript
export type DiagnosticSeverity = 'error' | 'warning' | 'info'
```

### `DiagnosticCategory`

```typescript
export type DiagnosticCategory =
  /** Reactive-path correctness — overflow, opaque accessors, mask gating. */
  | 'reactivity'
  /** View composition — async helpers, missing context providers, helper cycles. */
  | 'composition'
  /** Agent integration — Msg-schema resolvability, dispatch-translator drift. */
  | 'agent'
  /** Style / authoring conventions — naming, redundancy, lint-only signals. */
  | 'style'
  /** Performance — whole-state (FULL_MASK) coarsening, expensive accessors. */
  | 'perf'
  /** Module / build configuration — manifest skew, version mismatch, integrity. */
  | 'config'
  /** Internal — module exceptions, walker termination paths, debug diagnostics. */
  | 'internal'
```

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

### `IntrospectionFactory`

```typescript
export type IntrospectionFactory = (input: IntrospectionFactoryInput) => CompilerModule[]
```

### `DevtoolsFactory`

```typescript
export type DevtoolsFactory = (input: DevtoolsFactoryInput) => CompilerModule[]
```

### `DispatchMode`

```typescript
export type DispatchMode = 'shared' | 'human-only' | 'agent-only'
```

### `MessageAnnotations`

```typescript
export type MessageAnnotations = {
  intent: string | null
  alwaysAffordable: boolean
  requiresConfirm: boolean
  dispatchMode: DispatchMode
  /**
   * Concrete example dispatches the LLM can copy from. Populated by
   * `@example("text")` JSDoc tags. Each tag becomes one entry, in
   * source order, so authors can mix scenarios ("typical case",
   * "edge case with auth", etc.) without nesting them in a single
   * string.
   */
  examples: string[]
  /**
   * Non-blocking caution. Surfaced verbatim to the agent at affordance
   * time so the LLM can weigh the consequence ("this overwrites the
   * cloud version", "fires analytics that can't be retracted") before
   * dispatching. Distinct from `requiresConfirm`, which is a runtime
   * gate the user must acknowledge.
   */
  warning: string | null
  /**
   * Effect kinds this variant emits when dispatched, declared by the
   * author via `@emits("kind1", "kind2")`. Lets the agent reason
   * about side effects ("this dispatch hits the cloud, so I should
   * batch") without the compiler having to walk update.ts. Authored
   * rather than auto-extracted because real apps emit effects
   * through helpers (`track('foo')`, `saveDelta(d)`) — auto-detecting
   * those would require helper-return-shape analysis with
   * ergonomically-painful failure modes; the declarative form trades
   * automatic discovery for accuracy and simplicity.
   *
   * Empty when no `@emits` tag is present.
   */
  emits: string[]
  /**
   * Boolean predicate gating whether the variant surfaces in
   * `list_actions`. Authored as `@routeGated("expr")`; the compiler
   * captures the predicate string verbatim and the runtime evaluates
   * it with `state` bound to the current state. The variant only
   * appears in the agent's affordance list when the predicate
   * returns true.
   *
   * Compile-time alternative to `agentAffordances(state) => Msg[]`
   * for the common case of "this Msg is reachable when state.X
   * looks like Y." Co-located with the Msg definition rather than
   * threaded through a separate hook.
   *
   * Examples:
   *   @routeGated("state.matrixState.kind === 'loaded'")
   *   @routeGated("state.route.kind === 'page' && state.route.slug === 'ranking'")
   *   @routeGated("state.auth.status === 'authenticated'")
   *
   * Null when no `@routeGated` tag is present (variant defaults to
   * its dispatchMode-driven affordance behavior).
   */
  routeGate: string | null
  /**
   * Human-readable reason surfaced when the `@routeGated` predicate is
   * FALSE. Authored as the optional second argument of `@routeGated`:
   * `@routeGated("step === 'review'", "available during the review step")`.
   * `list_actions` includes the gated variant as `available: false` with
   * this string as `unavailableReason`, so the agent learns the action
   * exists and what unblocks it instead of seeing it silently vanish.
   *
   * Null when `@routeGated` has no second argument (the runtime falls back
   * to a generic "not available in the current state").
   */
  routeGateReason: string | null
}
```

### `MsgFieldType`

The "bare type" of a field. Covers five cases:

- primitive keyword as a string: `'string'`, `'number'`, `'boolean'`, `'unknown'`
- literal union: `{enum: ['a', 'b']}` for strings, `{enum: [1, 2, 3]}`
  for numbers, `{enum: [true]}` for booleans. Mixed-type literal
  unions stay `'unknown'`.
- nested object shape: `{kind: 'object', shape: {...}}` — emitted when
  a field's type is a local interface/type alias the extractor could
  follow (depth-limited; cross-file references stay `'unknown'`).
- array of element type: `{kind: 'array', element: <bare type>}`.
- discriminated union of objects:
  `{kind: 'discriminated-union', discriminant: 'kind', variants: {a: {...}, b: {...}}}`.
  Emitted when every member of a union is an object literal sharing one
  literal-string property name with distinct values. Symmetric with
  how the top-level Msg union itself is encoded — same shape, recursed.
  The synthesizer in `@llui/agent`'s `list_actions` walks these to build
  copy-paste-ready payload examples; the validator in `send_message`
  walks them too (treating object/array as "any" since deep validation
  is the reducer's job).

```typescript
export type MsgFieldType =
  | string
  | { enum: ReadonlyArray<string | number | boolean> }
  | { kind: 'object'; shape: Record<string, MsgField> }
  | { kind: 'array'; element: MsgFieldType }
  | {
      kind: 'discriminated-union'
      discriminant: string
      variants: Record<string, Record<string, MsgField>>
    }
```

### `MsgField`

```typescript
export type MsgField = MsgFieldType | MsgFieldRich
```

### `TypeIndex`

Index of type aliases and interfaces visible from a source file,
keyed by name. Lets the field-type resolver follow `Criterion[]` →
`interface Criterion { … }` and emit a nested object shape rather
than `'unknown'`.
The cross-file resolver pipeline (`cross-file-resolver.ts`) builds
an enriched index that includes types imported from sibling files —
follow `GridSorting` → `'rank' | 'crit-X' | 'crit-Y'` → `{enum: […]}`
even when the alias lives in `./state.ts` not the Msg-defining file.

```typescript
export type TypeIndex = Map<string, ts.TypeNode | ts.InterfaceDeclaration>
```

### `SchemaHashInput`

```typescript
export type SchemaHashInput = {
  msgSchema: unknown
  stateSchema: unknown
  // structurally serialized into the hash — accepts the typed annotations map
  // (Record<string, MessageAnnotations>) or a cross-file-resolved equivalent.
  msgAnnotations: Record<string, unknown> | null | undefined
}
```

### `StateType`

```typescript
export type StateType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'unknown'
  | { kind: 'enum'; values: string[] }
  | { kind: 'array'; of: StateType }
  | { kind: 'object'; fields: Record<string, StateType> }
  | { kind: 'optional'; of: StateType }
  | { kind: 'union'; of: StateType[] }
```

## Interfaces

### `InjectResult`

```typescript
export interface InjectResult {
  sf: ts.SourceFile
  /** True when at least one `__registerScopeVariants(...)` call was inserted. */
  injected: boolean
}
```

### `OpaqueOut`

Mutable collector for "the file's \_\_prefixes must degrade to the
whole-state sentinel" — written by every accessor walker that sees
an opaque shape (unresolvable delegation, dynamic `s[expr]`, state
in a spread, etc.). The first triggering site is captured so a
downstream diagnostic can point the author at the line that
silently degraded mask precision for every binding in the file.
Subsequent leaks DON'T overwrite — the surface diagnostic is "fix
this one and rerun"; flooding the user with every leak found is
lower value than a precise first cause.

```typescript
export interface OpaqueOut {
  value: boolean
  /** First opaque shape encountered. Stable across calls — only set when value flips false→true. */
  node?: ts.Node
  /** Short human label for the shape (e.g. "dynamic element access `s[expr]`"). */
  shape?: string
}
```

### `BindingSourceEntry`

```typescript
export interface BindingSourceEntry {
  bindingIndex: number
  file: string
  line: number
  column: number
}
```

### `CompilerCacheEntry`

```typescript
export interface CompilerCacheEntry {
  preSource: string
  postSource: string
  msgMaskMap: Record<string, number>
  bindingSources: BindingSourceEntry[]
}
```

### `ExternalTypeSources`

Resolved external type sources for the file under analysis: the source
string + local alias name for each of the `State` / `Msg` / `Effect`
type arguments that the host adapter (vite-plugin) chased to their
declaring file via `findTypeSource`. The schema/annotation extractors
run against these instead of the focal file when the alias lives
elsewhere. All fields optional — absent ones fall back to file-local
extraction.

```typescript
export interface ExternalTypeSources {
  state?: { source: string; typeName: string }
  msg?: { source: string; typeName: string }
  effect?: { source: string; typeName: string }
}
```

### `PreExtractedSchemas`

Schemas already extracted by the adapter's async cross-file /
composition-aware hook before invoking the signal transform. Used when
the file-local sync extractors can't see the whole picture — the
Msg/Effect/State alias lives in another file, or the union composes
inline literals with imported TypeReferences. When provided, the
transform uses these instead of running its own file-local extractors.

```typescript
export interface PreExtractedSchemas {
  msgSchema?: ReturnType<typeof extractMsgSchema>
  msgAnnotations?: ReturnType<typeof extractMsgAnnotations>
  stateSchema?: ReturnType<typeof extractStateSchema>
  effectSchema?: ReturnType<typeof extractEffectSchema>
}
```

### `ResolveContext`

Cross-file type resolver.
The schema/annotation extractors (`extractMsgAnnotations`,
`extractMsgSchema`, `extractStateSchema`, `extractEffectSchema`) only
see the source string for the file currently being transformed. When
a developer keeps the `Msg` (or `State` / `Effect`) union in a
separate file and imports it where `component()` is called, those
extractors silently return `null` — the plugin emits no annotations,
runtime LAP validation is disabled, and Claude can dispatch arbitrary
`type` strings that fall through to `assertNever`.
This module follows imports and re-exports to find the source file
that declares the requested type alias, returning that file's source
string + the local name of the alias there. Extractors then run
against that source and produce the same output they would have for
a co-located declaration.
Limitations:

- Composition (`type Msg = ImportedA | { type: 'b' }`): only the
  locally-declared variants are extracted; the imported half isn't
  walked recursively into. The lint rule `agent-msg-resolvable`
  catches this case at lint time.
- Namespace imports (`import * as ns from './msg'`) and `export *`:
  not followed. Same lint coverage.
- Generic types: not parameterized resolution; the type argument
  must resolve to a concrete type alias.

```typescript
export interface ResolveContext {
  /**
   * Resolve a module specifier (e.g. `'./msg'`, `'@scope/pkg'`) against
   * the importing file's path. Returns the absolute filesystem path of
   * the resolved module, or `null` if it cannot be resolved (the type
   * stays unresolved and the extractor falls back to local-only mode).
   */
  resolveModule: (spec: string, importerPath: string) => Promise<string | null>
  /**
   * Read the source contents of an absolute module path. The contents
   * are parsed by TypeScript so they should be valid TS/TSX. The plugin
   *'s vite hook plumbs `fs/promises.readFile` here; tests provide an
   * in-memory map.
   */
  readSource: (absolutePath: string) => Promise<string>
}
```

### `ResolvedTypeSource`

```typescript
export interface ResolvedTypeSource {
  /** The full source string of the file declaring the type alias. */
  source: string
  /** The local name of the alias *in that file* (after rename chains). */
  localName: string
  /** Absolute path of the file declaring the alias (debug aid). */
  filePath: string
}
```

### `ViewHelperClassification`

```typescript
export interface ViewHelperClassification {
  kind: ViewHelperKind
  /** Which §2.1 case fired. Only populated when kind === 'walked'. */
  cases: Array<1 | 2 | 3>
  /** Human-readable reason. */
  reason: string
}
```

### `WalkerDiagnostic`

```typescript
export interface WalkerDiagnostic {
  id: DiagnosticId
  file: string
  pos: number
  end: number
  message: string
  helperName: string | undefined
}
```

### `WalkerResult`

```typescript
export interface WalkerResult {
  diagnostics: WalkerDiagnostic[]
  /** Per-file counts for telemetry. */
  perFile: Map<
    string,
    {
      callsClassified: number
      walked: number
      opaque: number
      async: number
      notAHelper: number
    }
  >
}
```

### `Position`

```typescript
export interface Position {
  /** 0-based line index. */
  line: number
  /** 0-based UTF-16 code-unit column. */
  column: number
}
```

### `Range`

```typescript
export interface Range {
  start: Position
  end: Position
}
```

### `DiagnosticLocation`

```typescript
export interface DiagnosticLocation {
  /** Project-relative path on emission (never absolute, never hostname-tainted). */
  file: string
  range: Range
}
```

### `CodeAction`

```typescript
export interface CodeAction {
  /** Human-readable label for the autofix. */
  title: string
  /** Source edits that apply the fix. Adapters translate to their host edit format. */
  edits: Array<{
    file: string
    range: Range
    /** New text replacing `range`. Empty string deletes the range. */
    newText: string
  }>
}
```

### `DiagnosticRelatedInformation`

```typescript
export interface DiagnosticRelatedInformation {
  location: DiagnosticLocation
  message: string
}
```

### `Diagnostic`

```typescript
export interface Diagnostic {
  /** Stable id — `<namespace>/<slug>`. Examples: `llui/opaque-view-call`. */
  id: string
  severity: DiagnosticSeverity
  category: DiagnosticCategory
  /** Human-readable, present-tense, actionable. */
  message: string
  location: DiagnosticLocation
  /** Cross-references (e.g. the other end of a cycle, the missing provider's expected site). */
  relatedInformation?: DiagnosticRelatedInformation[]
  /** Structured edits the adapter can offer as autofixes. */
  fixes?: CodeAction[]
  /** Optional URL to user-facing documentation for this diagnostic id. */
  documentation?: string
}
```

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

### `SignalDiagnostic`

```typescript
export interface SignalDiagnostic {
  rule: string
  message: string
  start: number
  length: number
}
```

### `SignalLintMessage`

A lint diagnostic with source position resolved (1-based line, 0-based col).

```typescript
export interface SignalLintMessage {
  rule: string
  message: string
  start: number
  line: number
  column: number
}
```

### `DiagnosticDefinition`

```typescript
export interface DiagnosticDefinition {
  /** Stable id, e.g. `llui/opaque-view-call`. Per v2c §3 §8.2. */
  id: string
  /** One-line description; useful for adapter UIs that don't render the message. */
  description: string
}
```

### `FileAnalysis`

Per-file analysis output. Modules accumulate findings here during
visitor dispatch; emit consumes it. The shape is intentionally
open-ended — modules name their own slots and the umbrella's
orchestrator never inspects them, only forwards.

```typescript
export interface FileAnalysis {
  /** Source file the analysis ran over. */
  sourceFile: ts.SourceFile
  /** Per-module accumulator buckets, keyed by module name. */
  perModule: Map<string, unknown>
  /** Diagnostics emitted during the walk. */
  diagnostics: Diagnostic[]
}
```

### `ModuleExternalTypes`

Resolved external type sources for the file under analysis. Same
shape as `transform.ts`'s `ExternalTypeSources`; declared here as a
structural minimum so the module registry doesn't import from the
umbrella. The host adapter (vite-plugin) supplies the values via
its async cross-file resolver (`findTypeSource`).
Always undefined for test-only `transformLlui(source, fileName)`
invocations and for lint adapters without import resolution. Modules
that consume this should fall back to file-local behaviour when
absent.

```typescript
export interface ModuleExternalTypes {
  state?: { source: string; typeName: string }
  msg?: { source: string; typeName: string }
  effect?: { source: string; typeName: string }
}
```

### `AnalysisContext`

```typescript
export interface AnalysisContext {
  sourceFile: ts.SourceFile
  /** TS TypeChecker, when the host adapter has built a Program. May be undefined for AST-only paths. */
  checker: ts.TypeChecker | undefined
  /**
   * The cross-file Program the checker is bound to, when available.
   * Modules that need to resolve identifiers across files (e.g. the
   * opaque-state-flow lint walking through imported helpers) must walk
   * Program-bound nodes — the file the registry hands them is a
   * locally-reparsed copy and its identifiers won't resolve through the
   * checker. Use `program.getSourceFile(sourceFile.fileName)` to fetch
   * the Program-bound counterpart. Undefined when the host doesn't
   * supply a Program (test path, lint adapters without cross-file).
   */
  program: ts.Program | undefined
  /**
   * Get the named module's accumulator slot (creating it lazily). The
   * slot is whatever shape the module wrote; type-safe access is the
   * module author's responsibility — typically via a typed `get<T>()`
   * wrapper exported alongside the module.
   */
  getSlot<T>(moduleName: string, init: () => T): T
  /** Record a diagnostic. The diagnostic's `id` should match one declared in `DiagnosticDefinition[]`. */
  reportDiagnostic(d: Diagnostic): void
  /**
   * External type sources from the host adapter's cross-file resolver.
   * Undefined when the host doesn't supply them (test path, lint-only
   * adapters without import resolution).
   */
  externalTypes?: ModuleExternalTypes
}
```

### `EmissionContribution`

```typescript
export interface EmissionContribution {
  /** Module emitting this contribution — used for conflict reporting. */
  module: string
  /** Field name on the `ComponentDef` object literal (e.g. `__msgSchema`). */
  field: string
  /** AST expression to assign. The umbrella merges into the component()'s config arg. */
  value: ts.Expression
  /**
   * Optional per-call target. When set, this contribution applies only
   * to the named `component()` call expression; the umbrella's
   * emission-merger writes the field into that call's config-arg
   * object literal. When omitted, the contribution is *file-global*:
   * the merger writes the field into every `component()` call in the
   * file (the common case — `__msgSchema`, `__prefixes`, `__schemaHash`
   * are file-shape-derived).
   *
   * Per-call target is needed for `__componentMeta` (file + line vary
   * per call site) and any other field whose value depends on the
   * specific `component()` call location.
   *
   * Conflict-detection runs per-(field, target) tuple — two modules
   * may both contribute `__custom` if they target *different* call
   * expressions; same target on the same field is still an error.
   */
  target?: ts.CallExpression
}
```

### `EmissionContext`

```typescript
export interface EmissionContext {
  sourceFile: ts.SourceFile
  factory: ts.NodeFactory
}
```

### `CompilerModule`

A compiler module declares:

- identification (name, compilerVersion semver against the umbrella);
- the diagnostics it can emit (stable IDs);
- per-`SyntaxKind` visitor handlers (the walker dispatches each AST
  node once; every module with a handler for its kind sees it);
- optionally, an `emit` function that contributes ComponentDef fields
  after the walk completes;
- optionally, `runtimeImports` declaring which `@llui/dom` symbols
  its emissions reference.

```typescript
export interface CompilerModule {
  name: string
  /** Semver range against the compiler API. v2c §5. */
  compilerVersion: string
  /** Modules this one depends on. The registry verifies presence at activation. */
  dependsOn?: string[]
  diagnostics: DiagnosticDefinition[]
  /**
   * Optional AST pre-transform. Called once per file BEFORE the
   * visitor walk and emission phase. Returns a (possibly rewritten)
   * SourceFile; the result is threaded through subsequent modules'
   * pre-transforms (in declaration order) and then becomes the file
   * the visitor walks. Use for AST mutations the visitor model can't
   * cleanly express — adjacent statement insertion, wrapping arrow
   * expressions, etc. The agent's connect-pattern pass and the
   * universal handler-tagger are the canonical examples (MODULE-MAPPING.md
   * binding-descriptors entry).
   *
   * Most modules do NOT need this. Visitor + emit is the preferred
   * shape because it composes deterministically across modules without
   * threading a mutable SourceFile through each one. preTransform
   * exists for the cases where AST mutation is unavoidable.
   *
   * The §2.1 "walker runs once per file" invariant is preserved: the
   * VISITOR walk runs once. preTransform passes are additional, but
   * they're typically cheap (targeted call-site rewrites, not deep
   * recursive walks) and execute before the single visitor walk.
   */
  preTransform?(ctx: PreTransformContext, sf: ts.SourceFile): ts.SourceFile
  visitors: {
    [K in ts.SyntaxKind]?: (ctx: AnalysisContext, node: ts.Node) => void
  }
  /**
   * Optional per-call AST rewrite, BOTTOM-UP (after children visited).
   * Called once per `CallExpression` during the post-visitor transform
   * phase, AFTER analysis has accumulated findings in
   * `analysis.perModule` AND after `ts.visitEachChild` has recursively
   * rewritten the node's children. Returns either:
   *   - `null` — node unchanged; chain continues with the next module's
   *     transformCall (if any).
   *   - a new `ts.CallExpression` — node replaced; subsequent modules'
   *     transformCall hooks see the new node (composes in declaration
   *     order, just like preTransform).
   *
   * Use for rewrites that depend on the already-rewritten children — when
   * a parent-call rewrite must observe the output a child-call rewrite
   * produced (the bottom-up order guarantees the child fired first). Module
   * authors should treat transformCall as a pure function of its inputs (the
   * node + analysis findings).
   */
  transformCall?(ctx: TransformCallContext, node: ts.CallExpression): ts.CallExpression | null
  /**
   * Optional per-call AST rewrite, TOP-DOWN (before children visited).
   * Mirrors `transformCall` but fires BEFORE `ts.visitEachChild`
   * recurses into the call's children. Use when the rewrite must happen
   * before the children are visited — most commonly when the rewrite
   * changes the call's argument shape and the children's visitor would
   * misinterpret the original shape. Memo-wrapping the `items:`
   * accessor of an `each()` call is the canonical example: the wrapped
   * accessor is what subsequent passes (item-selector dedup, mask
   * injection) read.
   *
   * Both `transformCallEnter` and `transformCall` may be declared by
   * the same module; enter fires top-down before recursion, transformCall
   * fires bottom-up after. Ordering within each direction is declaration
   * order across modules; the two directions never interleave for a
   * given node.
   */
  transformCallEnter?(ctx: TransformCallContext, node: ts.CallExpression): ts.CallExpression | null
  /** Called once per file after the visitor pass completes. Returns this module's emission contributions. */
  emit?(ctx: EmissionContext, analysis: FileAnalysis): EmissionContribution[]
  /** Runtime symbol names this module's emissions reference (from `@llui/dom`). */
  runtimeImports?: string[]
}
```

### `PreTransformContext`

```typescript
export interface PreTransformContext {
  factory: ts.NodeFactory
  /**
   * Shared per-file findings accumulator. preTransform passes that
   * need to communicate with their own emit step (e.g. "this file
   * needed scope-variant registrations") use this slot map. The same
   * `analysis.perModule` map is later passed to visitors and emit.
   */
  analysis: FileAnalysis
}
```

### `TransformCallContext`

Context passed to every `transformCall` invocation. Carries the
factory for building new AST nodes and a read-only view of analysis
findings (visitors have already completed and populated
`analysis.perModule` by the time transformCall fires).

```typescript
export interface TransformCallContext {
  factory: ts.NodeFactory
  /** Read-only access to visitor-phase findings. */
  analysis: FileAnalysis
}
```

### `RegistryRunResult`

```typescript
export interface RegistryRunResult {
  analysis: FileAnalysis
  emissions: EmissionContribution[]
  /** Union of runtime imports from every active module. */
  runtimeImports: string[]
}
```

### `BindingDescriptorsSlot`

```typescript
export interface BindingDescriptorsSlot {
  scopeRegistrationsInjected: boolean
}
```

### `IntrospectionFactoryInput`

Inputs the orchestrator hands to the introspection factory. These
are the file-level extractions the orchestrator already performs
(the extractors `extractMsgSchema`, `extractStateSchema`, etc.
remain in `@llui/compiler` because the orchestrator uses their
output for the compiler cache too).

```typescript
export interface IntrospectionFactoryInput {
  /** Source file the modules will walk. */
  sourceFile: ts.SourceFile
  /** Pre-extracted Msg schema (or null when extraction failed / not present). */
  msgSchema: unknown
  /** Pre-extracted Effect schema. */
  effectSchema: unknown
  /** Pre-extracted State schema. */
  stateSchema: unknown
  /** Pre-extracted message annotations (or null when extraction failed). */
  msgAnnotations: Record<string, unknown> | null
  /** Whether agent-metadata emission is requested (devMode || emitAgentMetadata). */
  shouldEmitAgentMetadata: boolean
}
```

### `DevtoolsFactoryInput`

```typescript
export interface DevtoolsFactoryInput {
  sourceFile: ts.SourceFile
  /** Whether dev-mode emission is requested (controls componentMeta). */
  devMode: boolean
}
```

### `MsgFieldRich`

Rich per-field descriptor. Emitted only when there's something
beyond the bare type to communicate — optionality, an explicit
priority hint, a freeform agent hint, or a runtime validation
predicate. When everything but `type` is unset, the producer emits
the bare `MsgFieldType` instead so variants without annotations
stay byte-cheap in the bundle.

```typescript
export interface MsgFieldRich {
  type: MsgFieldType
  /** Mirrors TypeScript's `?:` optional marker. Required fields omit this. */
  optional?: boolean
  /**
   * Strength signal for optional fields. Borrows RFC 2119's `SHOULD`:
   * the LLM ought to fill it in unless it has a specific reason not
   * to. Required fields don't carry a priority — TS already conveys
   * "must" via the type system. Currently the only level; future
   * extensions could add `'recommended'` or similar.
   */
  priority?: 'should'
  /** Freeform consequence-shaped explanation. Surfaced verbatim to
   *  the LLM at affordance time. */
  hint?: string
  /**
   * Boolean JS expression that must hold for the field's value to be
   * accepted. The expression has `v` bound to the field's runtime
   * value; everything else is global (Math, JSON, RegExp, etc.).
   * Authored as `@validates("expr")` JSDoc — the compiler captures
   * the source string verbatim and the validator compiles it lazily
   * with `new Function`, caching across calls.
   *
   * Examples:
   *   @validates("v >= 0 && v <= 100")        // weight 0–100
   *   @validates("v.length > 0")              // non-empty string
   *   @validates("/^[a-z0-9-]+$/.test(v)")    // slug format
   *
   * The predicate runs ONLY at the agent boundary. Human-driven
   * dispatches bypass it because TypeScript already validated the
   * call site. Use for invariants the type system can't express
   * (numeric ranges, format predicates, length bounds).
   */
  validates?: string
}
```

### `MsgSchema`

```typescript
export interface MsgSchema {
  discriminant: string
  variants: Record<string, Record<string, MsgField>>
}
```

### `StateSchema`

```typescript
export interface StateSchema {
  fields: Record<string, StateType>
}
```

## Classes

### `CompilerCache`

```typescript
class CompilerCache {
  cache
  set(componentName: string, entry: CompilerCacheEntry): void
  get(componentName: string): CompilerCacheEntry | undefined
  has(componentName: string): boolean
}
```

### `ModuleRegistry`

The visitor registry. Built once per compiler boot from the user's
`llui.config.ts` `modules: [...]` array; the umbrella's per-file
pipeline calls `run(sourceFile, checker)` to drive a complete pass.

```typescript
class ModuleRegistry {
  modules: ReadonlyArray<CompilerModule>
  visitorsByKind: Map<ts.SyntaxKind, Array<CompilerModule>>
  constructor(modules: ReadonlyArray<CompilerModule>)
  verifyDependencies(): void
  buildVisitorIndex(): Map<ts.SyntaxKind, Array<CompilerModule>>
  run(
    sourceFile: ts.SourceFile,
    checker?: ts.TypeChecker,
    externalTypes?: ModuleExternalTypes,
    program?: ts.Program,
  ): RegistryRunResult
  listModules(): string[]
  listDiagnostics(): DiagnosticDefinition[]
}
```

## Constants

### `COMPILER_RENAMEABLE_KEYS`

Single source of truth for the compiler's emission name registry.
Two disjoint sets:

- `COMPILER_RENAMEABLE_KEYS` — property keys the compiler synthesizes
  onto `component({...})` literals. The runtime reads these via
  property access (`def.__view`, `def.__prefixes`, etc.) inside the
  same bundle that the compiler emitted them into. Their producer and
  consumer are colocated in the bundle, so the vite-plugin's post-
  bundle property-rename pass can shorten them to `$a`/`$b`/… without
  breaking the contract.
- `COMPILER_DOM_INTERNAL_IMPORTS` — runtime helpers the compiler
  references by NAME (not by property key) via an
  `import { __cloneStaticTemplate } from '@llui/dom/internal'`
  declaration. These cross a module boundary at consumer build time.
  Anything the rename pass touches that ends up in an import specifier
  would be rewritten to `$X`, which the source package never exports,
  and rolldown fails the build with `MISSING_EXPORT`. **These names
  must NEVER be renamed.**
  The two sets are disjoint by construction — the type-level
  `Extract<...>` assertion below fails compilation if any name appears
  in both lists. New compiler-emitted names land in whichever list
  matches their lifetime; if you accidentally add one to both, `tsc`
  tells you before the bug ships.
  Subpath choice matters: the helpers live at `@llui/dom/internal`, not
  at the root `@llui/dom`, because the rename regex matches any
  `__`-prefixed identifier in the bundle. By hosting the helpers on a
  subpath whose import specifier never gets touched by the rename, we
  keep both the regex and the runtime export surface internally
  consistent without needing an AST-aware rename pass.

```typescript
const COMPILER_RENAMEABLE_KEYS
```

### `COMPILER_DOM_INTERNAL_IMPORTS`

```typescript
const COMPILER_DOM_INTERNAL_IMPORTS
```

### `DOM_INTERNAL_MODULE_SPECIFIER`

Module specifier the compiler emits for the internal-helper imports.

```typescript
const DOM_INTERNAL_MODULE_SPECIFIER
```

### `compilerCache`

```typescript
const compilerCache
```

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

### `COMPILER_VERSION`

The @llui/compiler version stamped on every emitted ComponentDef.
Read at runtime by `assertCompilerCompatibility()` in @llui/dom's
update-loop. v2b §5.
Keep this in sync with `package.json` — the publish script (Phase 7
`scripts/publish.sh`) reads from package.json so a drift is caught at
release time.

```typescript
const COMPILER_VERSION
```

### `BINDING_DESCRIPTORS_SLOT`

Slot key the binding-descriptors module sets to signal whether it
inserted `__registerScopeVariants` calls. Lives here (not in
`@llui/compiler-introspection`) so the orchestrator can read the
slot without static-importing the sibling package. The CONSTANT
is the contract; both sides must agree on the literal string.

```typescript
const BINDING_DESCRIPTORS_SLOT
```

<!-- auto-api:end -->
