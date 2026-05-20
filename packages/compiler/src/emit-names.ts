/**
 * Single source of truth for the compiler's emission name registry.
 *
 * Two disjoint sets:
 *
 *   - `COMPILER_RENAMEABLE_KEYS` — property keys the compiler synthesizes
 *     onto `component({...})` literals. The runtime reads these via
 *     property access (`def.__view`, `def.__prefixes`, etc.) inside the
 *     same bundle that the compiler emitted them into. Their producer and
 *     consumer are colocated in the bundle, so the vite-plugin's post-
 *     bundle property-rename pass can shorten them to `$a`/`$b`/… without
 *     breaking the contract.
 *
 *   - `COMPILER_DOM_INTERNAL_IMPORTS` — runtime helpers the compiler
 *     references by NAME (not by property key) via an
 *     `import { __cloneStaticTemplate } from '@llui/dom/internal'`
 *     declaration. These cross a module boundary at consumer build time.
 *     Anything the rename pass touches that ends up in an import specifier
 *     would be rewritten to `$X`, which the source package never exports,
 *     and rolldown fails the build with `MISSING_EXPORT`. **These names
 *     must NEVER be renamed.**
 *
 * The two sets are disjoint by construction — the type-level
 * `Extract<...>` assertion below fails compilation if any name appears
 * in both lists. New compiler-emitted names land in whichever list
 * matches their lifetime; if you accidentally add one to both, `tsc`
 * tells you before the bug ships.
 *
 * Subpath choice matters: the helpers live at `@llui/dom/internal`, not
 * at the root `@llui/dom`, because the rename regex matches any
 * `__`-prefixed identifier in the bundle. By hosting the helpers on a
 * subpath whose import specifier never gets touched by the rename, we
 * keep both the regex and the runtime export surface internally
 * consistent without needing an AST-aware rename pass.
 */

export const COMPILER_RENAMEABLE_KEYS = [
  '__view',
  '__view$',
  '__prefixes',
  '__handlers',
  '__compilerVersion',
  '__directUpdate',
  '__mask',
  '__maskHi',
  '__maskLegend',
  '__perItem',
  '__rowUpd',
  '__rowUpdate',
  '__schemaHash',
  '__tpl',
  '__msgSchema',
  '__msgAnnotations',
  '__bindingDescriptors',
  '__stateSchema',
  '__effectSchema',
  '__componentMeta',
  '__renderToString',
  '__update',
  '__dirty',
] as const

export type CompilerRenameableKey = (typeof COMPILER_RENAMEABLE_KEYS)[number]

export const COMPILER_DOM_INTERNAL_IMPORTS = [
  '__bindUncertain',
  '__cloneStaticTemplate',
  '__runPhase2',
  '__handleMsg',
  '__registerScopeVariants',
  '__clientOnlyStub',
] as const

export type CompilerDomInternalImport = (typeof COMPILER_DOM_INTERNAL_IMPORTS)[number]

// Compile-time proof that the two sets are disjoint. If any name appears
// in both lists, `Extract<...>` resolves to that name's string literal
// instead of `never`, and the assignment fails. Move the offending name
// to one list or the other; never both.
type _Disjoint = Extract<CompilerRenameableKey, CompilerDomInternalImport>
const _disjointnessProof: _Disjoint extends never ? true : false = true
void _disjointnessProof

/** Module specifier the compiler emits for the internal-helper imports. */
export const DOM_INTERNAL_MODULE_SPECIFIER = '@llui/dom/internal'
