// The compiler ↔ runtime metadata ABI.
//
// `@llui/compiler` synthesizes these property keys onto every `component({...})`
// literal it compiles in an `agent: true` (or dev) build; this runtime reads them
// back off the def to feed the debug registry, and `@llui/agent` reads them to
// answer the LAP pairing handshake.
//
// Writer and reader live in DIFFERENT bundle chunks under any vendor split — the
// stock `manualChunks: { vendor: ['@llui/dom'] }` is enough — so the key has to be
// FINAL the moment the compiler writes it. It used to be shortened by a post-bundle
// regex pass in `@llui/vite-plugin` scoped to chunks with compiled modules, which
// rewrote the app chunk and left the runtime chunk reading the original name:
// every schema silently `undefined` in production, with no error anywhere
// (issue #45). That pass is gone; these names ship as-is.
//
// The table is mirrored, deliberately, in `@llui/compiler`'s `src/emit-names.ts`:
// this package must stay dependency-free (the compiler pulls in `typescript`), so
// it cannot import the writer's copy. `packages/dom/test/signals/compiler-metadata-abi.test.ts`
// asserts the two tables are identical — add or change a key in BOTH places, and
// treat a change to any VALUE as a breaking change that must ship in lockstep.
// Lockstep is not a convention here, it is load-bearing: a consumer on a new
// compiler with an old runtime reproduces #45 exactly, and the runtime cannot
// detect it (a key that isn't there is indistinguishable from a build that emitted
// no metadata at all). The only guard that can fire is the package manager, so
// `@llui/vite-plugin` declares a `@llui/dom` peer range; `@llui/compiler` cannot
// declare one without making the workspace graph cyclic, since this package
// dev-depends on the compiler for its tests.
//
// `$`-prefixed because `$` is a valid identifier-start char and uncommon as a
// property PREFIX in the surrounding JS heap (jQuery's `$` is a global, RxJS uses
// `$` as a suffix), which keeps hidden-class collision risk low while costing one
// character less than the `__` form.

/**
 * Emitted property key per metadata field: the record KEY is the descriptive
 * name (the documentation vocabulary), the VALUE is the literal property key
 * present in the bundle.
 */
export const COMPILER_META_KEYS = {
  /** discriminated-union schema of Msg ({ discriminant, variants }) */
  msgSchema: '$ms',
  /** discriminated-union schema of Effect */
  effectSchema: '$es',
  /** state shape schema */
  stateSchema: '$ss',
  /** per-message JSDoc annotations (intent, affordability, …), sparse */
  msgAnnotations: '$ma',
  /** stable hash of the schemas, for hot-reload schema-change detection */
  schemaHash: '$sh',
  /** dev-only source location `{ file, line }` */
  componentMeta: '$cm',
} as const

/** The descriptive field names of {@link COMPILER_META_KEYS}. */
export type CompilerMetaField = keyof typeof COMPILER_META_KEYS

/** The literal property keys the compiler emits into the bundle. */
export type CompilerMetaKey = (typeof COMPILER_META_KEYS)[CompilerMetaField]

/**
 * The compiler-injected introspection metadata carried by a compiled
 * `component({...})` literal. Every field is optional: a production build
 * without `agent: true` emits none of them, and `componentMeta` is dev-only.
 *
 * Spelled with computed keys so the declared shape and the runtime read path
 * cannot drift from {@link COMPILER_META_KEYS} — there is exactly one place a
 * key name is written.
 */
export interface CompilerMetadata {
  /** discriminated-union schema of Msg ({ discriminant, variants }) */
  readonly [COMPILER_META_KEYS.msgSchema]?: object
  /** discriminated-union schema of Effect */
  readonly [COMPILER_META_KEYS.effectSchema]?: object
  /** state shape schema */
  readonly [COMPILER_META_KEYS.stateSchema]?: object
  /** per-message JSDoc annotations (intent, affordability, …) */
  readonly [COMPILER_META_KEYS.msgAnnotations]?: Record<string, unknown>
  /** stable hash of the schemas, for hot-reload schema-change detection */
  readonly [COMPILER_META_KEYS.schemaHash]?: string
  /** dev-only source location */
  readonly [COMPILER_META_KEYS.componentMeta]?: { file: string; line: number }
}
