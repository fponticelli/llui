/**
 * Single source of truth for the compiler's emission name registry.
 *
 * Two sets, both crossing a module/chunk boundary at consumer build time —
 * which is precisely why neither may be rewritten after the fact:
 *
 *   - `COMPILER_META_KEYS` — the property keys the compiler synthesizes onto
 *     `component({...})` literals for the agent / devtools surface. The WRITER
 *     is this compiler (running over the app's own modules); the READERS are
 *     `@llui/dom` (`signals/component.ts` → the debug registry) and
 *     `@llui/agent` (`client/factory.ts`). Writer and readers land in
 *     DIFFERENT chunks under any `manualChunks` vendor split — the common
 *     `manualChunks: { vendor: ['@llui/dom'] }` is enough — so the emitted
 *     name has to be final at emit time. A post-bundle rename that rewrites
 *     the app chunk and not the runtime chunk yields `undefined` schemas in
 *     production `agent: true` builds with no error anywhere (issue #45).
 *     The names are therefore already short: `$`-prefixed because `$` is a
 *     valid identifier-start char and uncommon as a property PREFIX in the
 *     surrounding heap (jQuery's `$` is a global, RxJS uses `$` as a suffix),
 *     which keeps the shape-cache collision risk low.
 *
 *     `@llui/dom` mirrors this table in `src/signals/compiler-keys.ts` — it
 *     cannot import it, because the runtime must stay dependency-free and
 *     this package pulls in `typescript`. The duplication is deliberate and
 *     gated: `packages/dom/test/signals/compiler-metadata-abi.test.ts` fails
 *     the build if the two tables ever diverge. Add a key in BOTH places.
 *
 *   - `COMPILER_DOM_INTERNAL_IMPORTS` — runtime helpers the compiler
 *     references by NAME (not by property key) via an
 *     `import { __cloneStaticTemplate } from '@llui/dom/internal'`
 *     declaration. Hosting them on the `/internal` subpath rather than the
 *     root barrel keeps them out of the root export surface; rewriting one
 *     would produce a name the source package never exports and fail the
 *     build with rolldown's `MISSING_EXPORT` (the Vike SSR case, where
 *     `@llui/dom/internal` is externalized).
 *
 * The two sets used to carry a type-level disjointness proof; it went with the
 * rename pass that made it necessary. That pass matched names as TEXT, so a
 * property key spelling an import binding got rewritten inside the import
 * specifier too. Nothing rewrites names now, and a property key cannot shadow an
 * import binding — do not re-add the proof.
 */

/**
 * Emitted property key per metadata field. The KEY of this record is the
 * field's descriptive name (the authoring/documentation vocabulary); the
 * VALUE is the literal identifier emitted into the bundle and read back by
 * the runtime. Only the value is load-bearing at runtime — changing one is a
 * breaking ABI change that must land in `@llui/dom` in the same release.
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

/** The literal property keys emitted into the bundle. */
export type CompilerMetaKey = (typeof COMPILER_META_KEYS)[CompilerMetaField]

export const COMPILER_DOM_INTERNAL_IMPORTS = [
  '__bindUncertain',
  '__cloneStaticTemplate',
  '__runPhase2',
  '__handleMsg',
  '__registerScopeVariants',
  '__clientOnlyStub',
] as const

export type CompilerDomInternalImport = (typeof COMPILER_DOM_INTERNAL_IMPORTS)[number]

/** Module specifier the compiler emits for the internal-helper imports. */
export const DOM_INTERNAL_MODULE_SPECIFIER = '@llui/dom/internal'
