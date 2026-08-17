---
title: '@llui/compiler'
description: 'Engine: the signal TypeScript transform (view lowering + introspection) + compile-time lint rules'
---

# @llui/compiler

<!-- package-version:start -->

**Current package version:** `0.13.0`

<!-- package-version:end -->

Build-tool-agnostic compiler engine for [LLui](https://github.com/fponticelli/llui). It runs the **signal transform** — lowering signal expressions in a component's direct view to runtime helpers (`signalText`/`el`/`signalEach`/…) and emitting introspection metadata — and enforces the signal lint set as non-bypassable compile-time errors.

This package is the engine. End users normally consume it through an adapter:

- [`@llui/vite-plugin`](/api/vite-plugin) — the Vite adapter
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
| `empty-props`                  | `div({}, [...])` — an empty props object; the helpers take a children-only call, so write `div([...])`    |

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

The signal transform also enforces the agent annotation rules
(`@intent` / `@emits` / `@should` / `tagSend` translators) when agent metadata is emitted.

**Mechanically fixable rules.** `empty-props`, `attr-name`, `event-handler-casing` and
`convention` attach a `LintFix` (a title plus exact text edits) to their diagnostic, which
editors and `applyLintFixes` can apply verbatim. Only `convention` is
auto-applied by the Vite plugin — it is runtime-neutral, so the dev loop never blocks on a
casing nit. Every other rule, fix or no fix, still fails the build.

`empty-props` covers the HTML element helpers **and** the namespaced SVG helpers
(`svg`/`path`/`g`/…), which share the same call forms. It fires only on a literally empty
object literal in the props position: `div({ ...attrs }, …)`, `div(cond ? {} : props, …)`
and a variable that happens to hold `{}` are all left alone, because the rule never reasons
about what an expression might evaluate to. `el('div', {}, …)` is out of scope too — `el`'s
props parameter is positional with a `= {}` default, so omitting it allocates the same object.

<!-- auto-api:start -->

## Functions

### `allAnnotationArgs()`

Arguments of every well-formed call of `tag`, in source order.

```typescript
function allAnnotationArgs(text: string, tag: string): string[][]
```

### `analyzeAccessor()`

Analyze a signal-accessor function. Each parameter is treated as a tainted
root; the returned `deps[i]` is the set of paths read from parameter `i`.

A parameter whose value ESCAPES (passed to a call, spread, returned whole)
yields the empty path `''` — "the whole parameter" — which is what a caller
must read as "cannot narrow this one".

```typescript
function analyzeAccessor(fn: AnalyzableFn): DepResult
```

### `analyzeSignalExpr()`

The set of absolute dependency paths a signal-valued expression reads.

```typescript
function analyzeSignalExpr(rawExpr: ts.Expression, roots: Roots = STATE_ROOTS): Set<string>
```

### `annotationsToObjectLiteral()`

Build a TS object-literal expression for the annotation map. Used by
the transform for msg-annotation emission. Variant
names are emitted as string literals (not identifiers) so
discriminants containing `/`, `-`, reserved words, etc. produce
valid JS.

```typescript
function annotationsToObjectLiteral(
  a: Record<string, MessageAnnotations>,
): ts.ObjectLiteralExpression
```

### `applyLintFixes()`

Apply the fixes carried by `messages` to `source`, returning the rewritten
code and how many fixes applied vs. were skipped (overlapping with one already
applied). Messages without a `fix` are ignored, so a caller can pass a filtered
subset (e.g. only `convention` diagnostics) to apply just those. Pure — does
not re-lint; the caller decides whether a second pass is warranted.

```typescript
function applyLintFixes(
  source: string,
  messages: ReadonlyArray<{ fix?: LintFix }>,
): { code: string; applied: number; skipped: number }
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

### `buildFieldDescriptorExpr()`

Build a TS expression for a single field descriptor in a MsgSchema's
variant map. Used by `msgSchemaToLiteral` (this file) for the
msg-schema / effect-schema emissions. Migrated from inline
`buildFieldDescriptorExpr` in transform.ts (v2c/decomp-5).

```typescript
function buildFieldDescriptorExpr(descriptor: MsgField, f: ts.NodeFactory): ts.Expression
```

### `buildManifest()`

Build a manifest from a package's source program. Only emits entries that
carry useful narrowing info (at least one `state-value` param with reads);
helpers that would contribute nothing are omitted (a missing entry coarsens
identically, so this just keeps the manifest lean).

```typescript
function buildManifest(program: ts.Program, opts: BuildManifestOptions): Manifest
```

### `clearManifestCache()`

```typescript
function clearManifestCache(): void
```

### `collectSignalDeps()`

Collect the dependency paths every signal component view in `mod` reads.

Paths are reported at full authored depth: `state.at('user').at('profile')
.at('address').at('city')` is `user.profile.address.city`, not a two-segment
prefix of it. Truncating to a prefix stays SOUND for gating (a dep on a prefix
covers every descendant, because an immutable update replaces the prefix
reference) but it misreports what the code actually reads.

Takes a {@link ParsedModule} — which carries the real filename, and with it the
parse ScriptKind. That is not merely for reporting: a `.ts` file parsed as TSX
misparses the generic arrow form (`const id = <T>(x: T): T => x`), and here
that would not raise an error, it would silently return `views: 0, paths: []`.

```typescript
function collectSignalDeps(mod: ParsedModule): SignalDepsResult
```

### `componentTypeNames()`

The EFFECTIVE State/Msg/Effect type names for a `component<…>()` call: its own
type arguments where they are plain identifiers, else the
{@link CONVENTION_TYPE_NAMES} the file-local extractors fall back to.

The adapter (pre-resolution) and the transform (metadata emission + lookup)
MUST both derive names through this function: they meet on the
{@link crossFileKey} built from the result, and any divergence would make the
lookup silently miss and degrade to file-local extraction.

```typescript
function componentTypeNames(call: ts.CallExpression): {
  state: string
  msg: string
  effect: string
}
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

### `covers()`

Does emitted dependency set `emitted` COVER a change at `path`? A dep on a
prefix covers any descendant (immutable update changes the prefix ref); a dep
deeper than the changed node is also covered (the change propagates up the
ref chain); the empty path covers everything.

```typescript
function covers(emitted: Set<string>, path: string): boolean
```

### `createModuleCache()`

```typescript
function createModuleCache(): ModuleCache
```

### `crossFileKey()`

The {@link CrossFileResolutions} key for a tuple of effective type names — both
the transform's metadata cache key and the adapter's lookup key.

The key is the NAME tuple, not the resolved declaration, so two calls that name
the same types share one entry. That is exact for the TOP-LEVEL declarations and
module imports this resolver walks. Two known cases where a name is NOT a unique
referent — both pre-existing limits shared with the file-local extractors, which
key off names the same way:

- **Shadowing.** A `Msg` declared inside a block/function scope collides with a
  top-level `Msg`; the resolver only ever sees the top-level one, so a component
  under the shadow is keyed as if it used the outer type.
- **Non-identifier type arguments.** An inline literal, a generic instantiation
  or a qualified name (`A.Msg`) is not a plain identifier, so
  {@link componentTypeNames} falls back to the convention name — and two calls
  with DIFFERENT qualified types collide on that one key.

Both produce the same wrongly-shared or file-local schema they produced before
per-call keying; the fix is name resolution through a checker, not a wider key.

```typescript
function crossFileKey(names: { state: string; msg: string; effect: string }): string
```

### `extractDiscriminatedUnionSchemaCrossFile()`

Cross-file companion to `extractMsgSchema` / `extractEffectSchema`.

Discriminated-union schema extractor that follows composed
TypeReferences through the resolver. Same recursion shape as
`extractMsgAnnotationsCrossFile`, just collecting field shapes
instead of JSDoc annotations.

```typescript
function extractDiscriminatedUnionSchemaCrossFile(
  mod: ParsedModule,
  typeName: string,
  ctx: ResolveContext,
): Promise<MsgSchema | null>
```

### `extractEffectSchema()`

The Effect union's schema. Same shape and same parse discipline as
{@link extractMsgSchema}.

```typescript
function extractEffectSchema(mod: ParsedModule, typeName: string = 'Effect'): MsgSchema | null
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
  mod: ParsedModule,
  typeName: string = 'Msg',
): Record<string, MessageAnnotations> | null
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
the first one walked wins — silently. Nothing in the toolchain flags
the duplicate (see the note in this file's header about the lint rule
that no longer exists); a duplicate discriminant is a type error the
user's own `tsc` reports independently.

```typescript
function extractMsgAnnotationsCrossFile(
  mod: ParsedModule,
  typeName: string,
  ctx: ResolveContext,
): Promise<Record<string, MessageAnnotations> | null>
```

### `extractMsgSchema()`

The Msg union's schema, read from an already-parsed module ({@link ParsedModule}
— one parse per pass, and the real filename's ScriptKind; see #93).

```typescript
function extractMsgSchema(mod: ParsedModule, typeName: string = 'Msg'): MsgSchema | null
```

### `extractStateSchema()`

Walk `type State = { … }` (or a type matching a user-provided name) and emit
a JSON-serializable shape descriptor. Supports primitives, string-literal
unions, arrays, nested objects, `T | undefined` optional fields and
`T | null` nullable ones (optionality and nullability are distinct — see
{@link StateType}).

Returns null if the named type isn't found or isn't a type literal.

Takes a {@link ParsedModule}, not a source string: the tree is shared with
lint, the transform and the cross-file resolver (one parse per pass, #93), and
the module carries the real filename — this used to parse every source as
`input.ts`, i.e. a `.tsx` component's State was read out of a TSX file parsed
as TS. TypeScript's error recovery masked that for most JSX; it did NOT where
recovery consumes the statement that follows. A `.tsx` module with
`const list = <ul>{xs.map(x => <li key={x}>{x}</li>)}</ul>` above
`export type State` returned `null` here, so an `agent: true` build shipped no
`$ss` — with no error anywhere.

```typescript
function extractStateSchema(mod: ParsedModule, typeName = 'State'): StateSchema | null
```

### `fieldType()`

Extracts the bare type from either descriptor form.

```typescript
function fieldType(f: MsgField): MsgFieldType
```

### `findTypeSource()`

Walk imports + re-exports to find where a type alias is actually
declared. Returns the source string and local name of the alias in
its declaring file. `export *` barrels ARE followed (step 4, first hit
in textual order wins). Returns `null` if the chain leads to an
unresolved module, a namespace import, or a dead-end (alias not
declared anywhere we can see).

```typescript
function findTypeSource(
  typeName: string,
  mod: ParsedModule,
  ctx: ResolveContext,
  visited: Set<string> = new Set(),
): Promise<ResolvedTypeSource | null>
```

### `firstAnnotationArgs()`

Arguments of the FIRST well-formed call of `tag`, or null when the tag is
absent or every occurrence is malformed. Malformed never degrades to a
partial value — that is the whole point of this module.

```typescript
function firstAnnotationArgs(text: string, tag: string): string[] | null
```

### `hasNonDefaultAnnotation()`

Whether the annotation map carries any non-default values. Used to
gate msg-annotation emission — annotations whose every field is
default are emission-redundant (the runtime treats absence as the
same defaults). Saves ~50 bytes per component for un-annotated Msg
unions, which dominates the corpus.

```typescript
function hasNonDefaultAnnotation(a: Record<string, MessageAnnotations>): boolean
```

### `injectScopeVariantRegistrations()`

```typescript
function injectScopeVariantRegistrations(node: ts.SourceFile, f: ts.NodeFactory): InjectResult
```

### `isDefaultAnnotation()`

Whether a single variant's annotations are ALL at their default value —
i.e. carry no authored information. Covers every field, including
`examples`/`warning`/`emits` (the previous `hasNonDefaultAnnotation`
missed these three, so a variant annotated only with `@example`/`@warning`/
`@emits` was wrongly treated as default). The runtime reconstructs a
fully-default variant from absence, so these are emission-redundant.

```typescript
function isDefaultAnnotation(v: MessageAnnotations): boolean
```

### `isRichField()`

True when `f` is a rich descriptor (object with `type` key).

```typescript
function isRichField(f: MsgField): f is MsgFieldRich
```

### `isSignalExpr()`

Is `expr` STRUCTURALLY a signal expression (a `state`/`.at`/`.map`/`.peek`
chain or `derived(...)`)? Strict on shape — does NOT return true merely because
a signal appears somewhere inside (e.g. an event handler `() => send(state.at(
'x').peek())` is NOT a signal expression). Used to distinguish reactive slots
from handlers/static values in the view transform.

```typescript
function isSignalExpr(expr: ts.Expression, roots: Roots = STATE_ROOTS): boolean
```

### `lintAnnotationSyntaxSource()`

Run ONLY `agent-annotation-syntax` over a module that is not a signal
component. A Msg union commonly lives in a plain `msg.ts` sibling that
carries no `component(` call, so `lintSignalSource` never sees it — yet that
is exactly where `@routeGated`/`@validates` are authored. The adapter calls
this for every other TS module it transforms.

The cheap string pre-check runs against `mod.text` BEFORE the module is parsed,
so a file with no agent annotation costs a regex and nothing else — which is
what keeps this affordable on every module in the project.

```typescript
function lintAnnotationSyntaxSource(mod: ParsedModule): SignalLintMessage[]
```

### `lintSignalSource()`

Run the signal lint rules over an already-parsed module, returning diagnostics
with resolved line/column. The adapter (vite plugin) surfaces these as build
errors. Call only on confirmed signal components.

Takes a {@link ParsedModule} so the tree it lints is the SAME one the transform
and the cross-file resolver use — one parse per dev transform (#93). The
module also fixes the ScriptKind from the real filename: a `.ts` file using the
generic-arrow form (`const id = <T>(x: T): T => x`) misparses as JSX under TSX
and fires a spurious `operator-on-signal` error.

```typescript
function lintSignalSource(mod: ParsedModule): SignalLintMessage[]
```

### `lintTagSendSource()`

Run ONLY `tag-send-drift` over a module that is not a signal component — the
companion to {@link lintAnnotationSyntaxSource}, and needed for the same
reason: `tagSend` is a LIBRARY-author helper, so the canonical call site is a
plain `connect()` module with no `component(` call in it, which
`lintSignalSource` never sees. Without this the rule would cover only the
rarest call sites.

Same pre-check discipline: the name is looked for in `mod.text` BEFORE the
module is parsed, so a module that never mentions `tagSend` costs one
substring search.

```typescript
function lintTagSendSource(mod: ParsedModule): SignalLintMessage[]
```

### `lookupHelperFromSymbol()`

Resolve the manifest helper entry for a call-site callee symbol.

@param sym the (possibly aliased) symbol of the call target
@param checker the program's type checker

```typescript
function lookupHelperFromSymbol(sym: ts.Symbol, checker: ts.TypeChecker): ManifestLookupResult
```

### `msgSchemaToLiteral()`

Build the full `{ discriminant, variants }` object literal for a
MsgSchema. Symmetric for msg-schema and effect-schema emission
(both use the discriminated-union shape).

```typescript
function msgSchemaToLiteral(schema: MsgSchema, f: ts.NodeFactory): ts.ObjectLiteralExpression
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

### `parseModule()`

Pair `text` with the `fileName` it came from. The parse happens on the first
{@link ParsedModule.sourceFile} call and is reused thereafter, so passing the
SAME instance to lint, cross-file resolution and the transform costs one parse.

Two calls with the same arguments produce two INDEPENDENT modules (and so two
parses) — hold the instance, or go through a {@link ModuleCache}.

```typescript
function parseModule(fileName: string, text: string): ParsedModule
```

### `rangeFromOffsets()`

Convert a TS Compiler API `(start, end)` offset pair against a parsed source
file into the canonical `Range` shape. Used by emitters that have AST
node positions but not pre-computed line/column.

```typescript
function rangeFromOffsets(sf: ts.SourceFile, start: number, end: number): Range
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

### `relativizeFile()`

Project-relative path helper. Adapters pass the project root resolved
from `llui.config.ts` / Vite's `config.root`; emitters that have an
absolute path use this to canonicalize before placing into a
Diagnostic. Falls back to the absolute path if `root` is empty or
the file isn't a descendant.

```typescript
function relativizeFile(absoluteFile: string, root: string): string
```

### `resolveFieldType()`

```typescript
function resolveFieldType(
  rawType: ts.TypeNode,
  typeIndex: TypeIndex = new Map(),
  depth = MAX_FIELD_DEPTH,
): MsgFieldType
```

### `scanAnnotationCalls()`

Scan `text` (a comment, or any string) for `@tag(…)` calls of the given tags.
Defaults to every tag in {@link ANNOTATION_TAGS}. Arity is enforced here, so
a call in `calls` is always usable as-is.

```typescript
function scanAnnotationCalls(
  text: string,
  tags: readonly string[] = Object.keys(ANNOTATION_TAGS),
): AnnotationScan
```

### `serializeManifest()`

Serialize a manifest to stable, diff-friendly JSON: object keys sorted
(so re-emits are byte-identical regardless of insertion order), arrays left
in their meaningful order (e.g. `viaParams` is index-ordered). 2-space indent

- trailing newline to match the repo's prettier output.

```typescript
function serializeManifest(manifest: Manifest): string
```

### `signalPathOf()`

The single absolute path an `.at()`-chain expression denotes, or `null` if it
is not a simple path (e.g. a `.map`/`derived` result, or rooted at something
other than a known signal root).

```typescript
function signalPathOf(expr: ts.Expression, roots: Roots): string | null
```

### `sparseMsgAnnotations()`

Build a JSON-ready annotation map that drops emission-redundant bytes:

- variants whose every field is default are OMITTED entirely, and
- within a retained variant, fields still at their default are OMITTED.
  The runtime treats an absent variant / field as the default (see
  `list-actions.ts`, which reads every field as `ann?.field ?? default`), so
  this is a pure size optimization with no semantic change. Returns null when
  every variant is fully default — the caller then skips the annotations prop.

```typescript
function sparseMsgAnnotations(
  a: Record<string, MessageAnnotations>,
): Record<string, Partial<MessageAnnotations>> | null
```

### `stateTypeToLiteral()`

Build a TypeScript expression representing the given StateType as a
runtime-readable literal. The emission shape mirrors the StateType
tagged union — `string`/`number`/`boolean`/`null`/`unknown` become string
literals; the structural kinds become object literals with a `kind`
field plus the appropriate payload (`of`/`fields`/`values`).

Used by the transform for state-schema emission. The shape
is the runtime/agent contract; downstream tools (MCP introspection,
agent's "what type is this field?") consume it.

```typescript
function stateTypeToLiteral(t: StateType, f: ts.NodeFactory): ts.Expression
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

### `transformSignalComponentSource()`

Rewrite signal `view`s in a source file and inject the runtime import.
Returns the source unchanged if it contains no signal components.

Code-only convenience wrapper over {@link transformSignalComponentSourceWithMap}
— kept for the many callers (mcp, dom codegen tests) that need no source map.

```typescript
function transformSignalComponentSource(
  mod: ParsedModule,
  opts: SignalTransformOptions = {},
): string
```

### `transformSignalComponentSourceWithMap()`

The map-returning form. Every splice (view rewrites, metadata, `batch,` bag
injection) plus the injected runtime import compose through ONE MagicString
instance, so the returned {@link SourceMap} is coherent. The vite-plugin threads
this map (and can compose the lint-autofix pass, which shares the same
{@link applyEditsWithMap} splicer) in a later stage.

```typescript
function transformSignalComponentSourceWithMap(
  mod: ParsedModule,
  opts: SignalTransformOptions = {},
): SignalTransformResult
```

## Types

### `AnalyzableFn`

A function whose body this analyzer can walk: an inline accessor (arrow /
function expression) or a declared helper.

```typescript
export type AnalyzableFn = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration
```

### `CompilerDomInternalImport`

```typescript
export type CompilerDomInternalImport = (typeof COMPILER_DOM_INTERNAL_IMPORTS)[number]
```

### `CompilerMetaField`

The descriptive field names of {@link COMPILER_META_KEYS}.

```typescript
export type CompilerMetaField = keyof typeof COMPILER_META_KEYS
```

### `CompilerMetaKey`

The literal property keys emitted into the bundle.

```typescript
export type CompilerMetaKey = (typeof COMPILER_META_KEYS)[CompilerMetaField]
```

### `CrossFileResolutions`

Per-file cross-file resolutions, keyed by {@link crossFileKey} of a
`component()` call's effective type-argument names.

Keyed PER CALL, not per file (issue #91): a file may declare component A with
an imported `Msg` and component B with a local one, and B must not be handed
A's schema/annotations. A wrong schema on the agent/devtools ABI is worse than
a missing one — a call with no entry here simply falls back to the transform's
file-local extractors.

```typescript
export type CrossFileResolutions = ReadonlyMap<string, CrossFileResolution>
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

### `DiagnosticSeverity`

```typescript
export type DiagnosticSeverity = 'error' | 'warning' | 'info'
```

### `DispatchMode`

```typescript
export type DispatchMode = 'shared' | 'human-only' | 'agent-only'
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

### `MsgField`

```typescript
export type MsgField = MsgFieldType | MsgFieldRich
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

### `ParseManifestResult`

```typescript
export type ParseManifestResult =
  | { ok: true; manifest: Manifest }
  /** `incompatible` = readable but the schema/compiler version doesn't match;
   *  `malformed` = unparseable or structurally wrong. Both → caller coarsens. */
  | { ok: false; reason: 'incompatible' | 'malformed'; detail: string }
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

Descriptor for one state field's type, as consumed by agents/devtools.

`'null'` describes a field whose declared type includes `null`. It is a
VALUE, not an absence: `null` survives JSON (state must be
JSON-serializable) and TypeScript keeps `field: T | null` required, so a
nullable field is emitted as `{kind: 'union', of: [T, 'null']}` and NEVER
as `{kind: 'optional'}`. When `T` is itself a union its members are spliced
into that list rather than nested, so the member list stays flat:
`string | number | null` is `{kind: 'union', of: ['string', 'number',
'null']}`. `T | undefined` is the opposite case — it means
the field may be absent, and is emitted as `{kind: 'optional', of: T}`
exactly like `field?: T`. A field declared `T | null | undefined` is both:
`{kind: 'optional', of: {kind: 'union', of: [T, 'null']}}`.

```typescript
export type StateType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'unknown'
  | { kind: 'enum'; values: string[] }
  | { kind: 'array'; of: StateType }
  | { kind: 'object'; fields: Record<string, StateType> }
  | { kind: 'optional'; of: StateType }
  | { kind: 'union'; of: StateType[] }
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

## Interfaces

### `AnnotationCall`

A well-formed `@tag(…)` call and its parsed arguments.

```typescript
export interface AnnotationCall {
  tag: string
  args: string[]
  /** Offset of the `@` within the scanned comment text. */
  start: number
  /** Length from the `@` through the closing `)`. */
  length: number
}
```

### `AnnotationScan`

```typescript
export interface AnnotationScan {
  calls: AnnotationCall[]
  errors: AnnotationSyntaxError[]
}
```

### `AnnotationSyntaxError`

A malformed `@tag(…)` call. Positions are relative to the scanned text.

```typescript
export interface AnnotationSyntaxError {
  tag: string
  message: string
  start: number
  length: number
}
```

### `AnnotationTagSpec`

Arity of one annotation tag. `max: null` means variadic.

```typescript
export interface AnnotationTagSpec {
  min: number
  max: number | null
  /**
   * Whether an argument may be written as a bare JSON object/array literal
   * instead of a quoted string (issue #98).
   *
   * `@example` ONLY, and deliberately so. An example IS a payload — a JSON
   * object is what the tag's value already spells, just with every inner quote
   * escaped, and thirteen files' worth of authors independently reached for
   * the unescaped form before #89 made it an error. Every other tag takes
   * something a JSON literal cannot be: `@routeGated`/`@validates` take a
   * JavaScript predicate, `@intent`/`@warning`/`@should` take prose, `@emits`
   * takes effect kinds. Accepting a brace there would invent a second spelling
   * for a concept that has exactly one — so a brace after any other tag stays
   * a build error.
   */
  json?: true
}
```

### `BuildManifestOptions`

```typescript
export interface BuildManifestOptions {
  /** Absolute path to the package's source root (e.g. `<pkg>/src`); module ids are relative to it. */
  srcRoot: string
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

### `ComponentEntry`

```typescript
export interface ComponentEntry {
  /** Reserved for v2b's read-everything-the-component-reads escape hatch. Unused at v2b ship. */
  name: string
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

### `ContextRead`

```typescript
export interface ContextRead {
  /** Canonical id: `<package-name>#<export-name>`. */
  context: string
  /** Sub-paths within the context value the helper reads. */
  subPaths: string[]
}
```

### `CrossFileResolution`

Everything the adapter resolved from sibling files for ONE
`component<State, Msg, Effect>` type-argument tuple.

```typescript
export interface CrossFileResolution {
  typeSources?: ExternalTypeSources
  preExtracted?: PreExtractedSchemas
}
```

### `DepResult`

Per-parameter dependency paths. `deps[i]` holds dotted relative paths read
from parameter `i`; the empty string `''` means the whole parameter.

```typescript
export interface DepResult {
  deps: Set<string>[]
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

### `DiagnosticLocation`

```typescript
export interface DiagnosticLocation {
  /** Project-relative path on emission (never absolute, never hostname-tainted). */
  file: string
  range: Range
}
```

### `DiagnosticRelatedInformation`

```typescript
export interface DiagnosticRelatedInformation {
  location: DiagnosticLocation
  message: string
}
```

### `ExternalTypeSources`

Resolved external type sources for the file under analysis: the declaring
MODULE (already parsed — the extractors reuse that tree rather than re-parsing
the sibling, #93) + local alias name for each of the `State` / `Msg` / `Effect`
type arguments that the host adapter (vite-plugin) chased to their
declaring file via `findTypeSource`. The schema/annotation extractors
run against these instead of the focal file when the alias lives
elsewhere. All fields optional — absent ones fall back to file-local
extraction.

```typescript
export interface ExternalTypeSources {
  state?: { module: ParsedModule; typeName: string }
  msg?: { module: ParsedModule; typeName: string }
  effect?: { module: ParsedModule; typeName: string }
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

### `InjectResult`

```typescript
export interface InjectResult {
  sf: ts.SourceFile
  /** True when at least one `__registerScopeVariants(...)` call was inserted. */
  injected: boolean
}
```

### `LintEdit`

A single text replacement, as absolute char offsets into the linted source.

```typescript
export interface LintEdit {
  start: number
  end: number
  newText: string
}
```

### `LintFix`

A deterministic, mechanically-applicable fix for a diagnostic — the same
shape an editor quick-fix or `applyLintFixes` consumes. A diagnostic carries
at most one (the single obvious correction); multi-option fixes aren't needed
for the rename-style rules that produce them.

```typescript
export interface LintFix {
  /** Short label, e.g. "Rename to `tabindex`". */
  title: string
  edits: LintEdit[]
}
```

### `LowerBail`

A lowering attempt that gave up and fell back to a slower path. Events are
facts about ATTEMPTS, not final outcomes: an `each` whose row factory bails
(`each-direct`) may still lower on the render-callback path (`signalEach`),
and a pass-1 shape bail may be picked up by the pass-2 helper lowering —
correlate with the transformed output to classify final tiers. Reason tokens
are short, stable kebab-case strings meant to feed coverage telemetry and,
later, user-facing `perf` diagnostics.

```typescript
export interface LowerBail {
  /** which lowering gave up: the each row factory (`each-direct`), the each
   * render-callback arm (`each-render`), a `show`/`branch` arm, the view-helper
   * pass-2 `each` (`helper-each`), or same-file helper-row inlining
   * (`inline-helper`, reported only once a same-file delegation target was
   * actually identified). */
  kind: 'each-direct' | 'each-render' | 'show' | 'branch' | 'helper-each' | 'inline-helper'
  /** short stable reason token, e.g. 'row-local-signal-alias' */
  reason: string
  /** start offset of the bailing call / row render in the original source file */
  pos: number
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

### `ModuleCache`

Per-pass memo of {@link ParsedModule}s by path. The cross-file resolver looks
the same sibling up once per type argument, per composed union member and
again while enriching the type index — eight lookups of one `msg.ts` in a
single pre-resolution pass was typical, each its own parse.

Keyed by `fileName` and validated against the TEXT: a cached entry is reused
only while the text is identical, so a file edited between passes (or a
module the lint autofix rewrote mid-transform) re-parses instead of serving a
stale tree. Scope one to a pass — the Vite plugin creates one per `transform`
— rather than keeping a process-wide cache alive.

```typescript
export interface ModuleCache {
  get(fileName: string, text: string): ParsedModule
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
   *   @validates("v === \"admin\"")           // embedded quote: escape it
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

### `ParsedModule`

A module's text plus, on demand, its parsed tree — parsed at most once no
matter how many analyses ask for it.

```typescript
export interface ParsedModule {
  /** The module's real path/name. Decides the parse ScriptKind. */
  readonly fileName: string
  /** The module's source text. Always available; never triggers a parse. */
  readonly text: string
  /** The parsed tree, with parent pointers. Memoized — parsed on first call. */
  sourceFile(): ts.SourceFile
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

### `Range`

```typescript
export interface Range {
  start: Position
  end: Position
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

Limitations of `findTypeSource` itself (all of them SILENT — nothing
warns, and the affected metadata is simply absent):

- Composition (`type Msg = ImportedA | { type: 'b' }`): it locates the
  alias but does not walk INTO the union. The composition-aware
  extractors below (`extractMsgAnnotationsCrossFile`,
  `extractDiscriminatedUnionSchemaCrossFile`) do recurse, and are what
  the adapter calls for Msg/Effect.
- Namespace imports (`import * as ns from './msg'`): not followed.
  (`export *` re-export barrels ARE followed — step 4.)
- Generic types: not parameterized resolution; the type argument
  must resolve to a concrete type alias.

NOTE for future readers: this file used to attribute these gaps to a lint
rule named `agent-msg-resolvable`. That rule belonged to the DELETED
`@llui/eslint-plugin` and was never reimplemented as a compiler rule — there
is no guard. Do not re-add the claim without the rule (issue #91).

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
  /**
   * Parse memo for this resolution pass. REQUIRED, and not a micro-optimization:
   * one pass looks the same sibling up once per type argument, once per composed
   * union member and again while enriching the type index — eight parses of one
   * `msg.ts` was typical, plus ten of the focal module (issue #93). Every parse
   * the resolver makes goes through it, so reuse does not depend on the caller
   * remembering anything; the caller only decides the cache's LIFETIME (the Vite
   * plugin: one per `transform`). Build one with `createModuleCache()`.
   */
  modules: ModuleCache
}
```

### `ResolvedTypeSource`

```typescript
export interface ResolvedTypeSource {
  /** The parsed module declaring the type alias (from `ctx.modules`, so every
   * later consumer of the same file reuses this tree). */
  module: ParsedModule
  /** The local name of the alias *in that file* (after rename chains). */
  localName: string
  /** Absolute path of the file declaring the alias (debug aid). Always
   * `module.fileName`. */
  filePath: string
}
```

### `SignalDepsResult`

```typescript
export interface SignalDepsResult {
  /** Absolute state paths, deduped and sorted. Excludes the whole-state read. */
  paths: string[]
  /** At least one binding reads the state wholesale (dep path `''`), so the
   * runtime cannot gate it on any narrower path. */
  wholeState: boolean
  /** How many signal component views were analyzed. Zero means the file has no
   * `component({ view: ({ state }) => … })` — `paths` being empty says nothing
   * about the file's reactivity. */
  views: number
}
```

### `SignalDiagnostic`

```typescript
export interface SignalDiagnostic {
  rule: string
  message: string
  start: number
  length: number
  /** Present iff the diagnostic is mechanically fixable (rename-style rules). */
  fix?: LintFix
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
  /** Present iff the diagnostic is mechanically fixable (see {@link LintFix}). */
  fix?: LintFix
}
```

### `SignalTransformOptions`

Options controlling introspection metadata emission (mirrors the legacy
transform's `devMode`/`emitAgentMetadata` gating).

```typescript
export interface SignalTransformOptions {
  /** emit the msg/state/effect schemas + annotations for the agent surface
   * (keyed by `COMPILER_META_KEYS` — see emit-names.ts for the ABI) */
  emitAgentMetadata?: boolean
  /** dev build — also emit the component meta `{ file, line }` (the file is the
   * module's own `fileName`, which the {@link ParsedModule} always carries) */
  devMode?: boolean
  /** Cross-file resolutions from the adapter (pre-extracted composition-aware
   * msg/effect schemas + annotations, and the declaring-file source for a `State`
   * that lives elsewhere), keyed PER `component()` CALL by {@link crossFileKey} of
   * the call's effective type-argument names. A call with an entry uses it in
   * preference to file-local extraction; a call WITHOUT one falls back to the
   * file-local extractors. It is deliberately not a file-wide value: that made a
   * second component in the file inherit the first's schema (issue #91). */
  crossFile?: CrossFileResolutions
  /** Lowering-bail telemetry: called for every lowering ATTEMPT that gave up and
   * fell back to a slower path (see {@link LowerBail}). Coverage tooling and the
   * future `perf` diagnostics channel consume this; it does not affect output. */
  onLowerBail?: (bail: LowerBail) => void
  /** Perf diagnostics: called with one `llui/each-verbatim` Diagnostic
   * (category `perf`, severity `warning`) per `each` site that ends FULLY
   * verbatim — its rows render via the runtime authoring path instead of the
   * compiled factory. Advisory only; never affects output. Verbatim `show`/
   * `branch` are intentionally not surfaced (they only pay at toggle time). */
  onPerfDiagnostic?: (diagnostic: Diagnostic) => void
}
```

### `SignalTransformResult`

Result of {@link transformSignalComponentSourceWithMap}: the rewritten code and
a source map (null when the file had no signal component and was returned as-is).

```typescript
export interface SignalTransformResult {
  code: string
  map: SourceMap | null
}
```

### `StateSchema`

```typescript
export interface StateSchema {
  fields: Record<string, StateType>
}
```

### `SubstitutionContext`

```typescript
export interface SubstitutionContext {
  /** Maps canonical context ids to the consumer's matching provide(...) accessor. */
  providers: Map<string, ContextProvider>
  /**
   * Path-extraction hook. Walks an arrow body and returns the dotted paths
   * it reads. The cross-file resolver injects its `extractAccessorPaths`
   * here; tests can stub with a simpler implementation.
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
   * the cross-file resolver; tests may stub it.
   */
  extractValuePath?: (expr: ts.Expression, rootParamName: string) => string | null
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

## Constants

### `ALL_ELEMENT_HELPERS`

Every element-helper callee name — namespaced and not. Use this ONLY for
rules that inspect a call's arguments; never for lowering (see the note on
`SVG_ELEMENT_HELPERS` above: lowering a namespaced helper breaks it).

```typescript
const ALL_ELEMENT_HELPERS: ReadonlySet<string>
```

### `ANNOTATION_TAGS`

Every tag that takes a parenthesized argument list. Keyed by tag name
WITHOUT the `@`. Flag-style tags (`@requiresConfirm`, `@humanOnly`, …) take
no arguments and are not part of this grammar.

```typescript
const ANNOTATION_TAGS: Readonly<Record<string, AnnotationTagSpec>>
```

### `COMPILER_DOM_INTERNAL_IMPORTS`

```typescript
const COMPILER_DOM_INTERNAL_IMPORTS
```

### `COMPILER_META_KEYS`

Emitted property key per metadata field. The KEY of this record is the
field's descriptive name (the authoring/documentation vocabulary); the
VALUE is the literal identifier emitted into the bundle and read back by
the runtime. Only the value is load-bearing at runtime — changing one is a
breaking ABI change that must land in `@llui/dom` in the same release.

```typescript
const COMPILER_META_KEYS
```

### `COMPILER_VERSION`

The @llui/compiler version stamped on every emitted ComponentDef.
Stamped so the runtime can check compiler/runtime compatibility.

Keep this in sync with `package.json` — the publish script (Phase 7
`scripts/publish.sh`) reads from package.json so a drift is caught at
release time.

```typescript
const COMPILER_VERSION
```

### `CONVENTION_TYPE_NAMES`

The `State`/`Msg`/`Effect` names the file-local extractors assume when a
`component()` call is untyped.

```typescript
const CONVENTION_TYPE_NAMES
```

### `DOM_INTERNAL_MODULE_SPECIFIER`

Module specifier the compiler emits for the internal-helper imports.

```typescript
const DOM_INTERNAL_MODULE_SPECIFIER
```

### `ELEMENT_HELPERS`

DOM element-helper callee names — tags that produce an element with props.

```typescript
const ELEMENT_HELPERS: ReadonlySet<string>
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

### `MANIFEST_SCHEMA_VERSION`

Current manifest schema version. Bumped 1→2 to add the `state-value`
param/field shape (helpers called as `helper(s)` with the state value passed
directly, e.g. `state.map(s => itemFill(s, i))`), which v1's accessor-function
shapes could not express. Consumers reject other majors via `compilerVersion`.

```typescript
const MANIFEST_SCHEMA_VERSION
```

### `SVG_ELEMENT_HELPERS`

SVG element-helper callee names (the `svgHelper(...)` exports of `@llui/dom`).

These are EXPORT names, not tags — the SVG `<text>` helper is exported as
`svgText` so it doesn't collide with the `text()` node helper. Kept out of
{@link ELEMENT_HELPERS} because the view transform must NOT lower them
(createElementNS), but they accept the identical `(children)` /
`(props?, children?)` call forms, so argument-shape rules apply unchanged.

```typescript
const SVG_ELEMENT_HELPERS: ReadonlySet<string>
```

<!-- auto-api:end -->
