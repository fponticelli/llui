// The ONE place a module's text becomes a `ts.SourceFile`.
//
// Every compiler entry point that analyses a module — lint, the signal
// transform, the schema/annotation extractors, the cross-file resolver, the
// per-file dep collector — takes a {@link ParsedModule} rather than a
// `source: string`. That is not decoration: each of those used to parse the text
// itself, so ONE dev transform of a component with file-local types parsed the
// same source 17 times (issue #93), on every keystroke-save, in a framework
// whose whole premise is compile-time work.
//
// Two invariants make the shared tree safe:
//
//  1. **ScriptKind comes from the real filename, always.** `.ts`/`.mts`/`.cts`
//     parse as TS, `.tsx` as TSX (see `signals/script-kind.ts`). A `.ts` file
//     parsed as TSX misparses the generic-arrow form (`const id = <T>(x: T) => x`)
//     and both SKIPS compilation and emits bogus lint errors. With one tree
//     threaded everywhere, a wrong ScriptKind is wrong EVERYWHERE at once — so
//     `fileName` is a required argument with no default anywhere in the package.
//     (The extractors used to hard-code `'input.ts'`/`'msg.ts'`, which parsed
//     every `.tsx` component as TS. Error recovery hid that for most JSX, but
//     not where it swallows the next statement — see `state-schema.ts` for the
//     shape that reached `agent: true` builds as a silently missing `$ss`.)
//
//  2. **Nobody mutates the tree.** Consumers read the AST and build their own
//     side tables (`HelperBindings`, the metadata cache, the edit list); no
//     consumer writes to a node or hangs state off one. Sharing one tree between
//     lint, resolution and the transform is only sound while that holds — if a
//     future pass needs per-node state, it owns a `Map` keyed by node, never a
//     property on the node.
//
// Parsing is LAZY. `lintAnnotationSyntaxModule` runs on every non-component
// module Vite transforms and pre-checks the raw text: a module with no agent
// annotation never pays for a parse at all. Holding text and tree together lets
// that stay true while any LATER consumer of the same module still gets the
// memoized tree.

import ts from 'typescript'
import { scriptKindForFilename } from './signals/script-kind.js'

/**
 * A module's text plus, on demand, its parsed tree — parsed at most once no
 * matter how many analyses ask for it.
 */
export interface ParsedModule {
  /** The module's real path/name. Decides the parse ScriptKind. */
  readonly fileName: string
  /** The module's source text. Always available; never triggers a parse. */
  readonly text: string
  /** The parsed tree, with parent pointers. Memoized — parsed on first call. */
  sourceFile(): ts.SourceFile
}

/**
 * Pair `text` with the `fileName` it came from. The parse happens on the first
 * {@link ParsedModule.sourceFile} call and is reused thereafter, so passing the
 * SAME instance to lint, cross-file resolution and the transform costs one parse.
 *
 * Two calls with the same arguments produce two INDEPENDENT modules (and so two
 * parses) — hold the instance, or go through a {@link ModuleCache}.
 */
export function parseModule(fileName: string, text: string): ParsedModule {
  let sf: ts.SourceFile | null = null
  return {
    fileName,
    text,
    sourceFile(): ts.SourceFile {
      sf ??= ts.createSourceFile(
        fileName,
        text,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        scriptKindForFilename(fileName),
      )
      return sf
    },
  }
}

/**
 * Per-pass memo of {@link ParsedModule}s by path. The cross-file resolver looks
 * the same sibling up once per type argument, per composed union member and
 * again while enriching the type index — eight lookups of one `msg.ts` in a
 * single pre-resolution pass was typical, each its own parse.
 *
 * Keyed by `fileName` and validated against the TEXT: a cached entry is reused
 * only while the text is identical, so a file edited between passes (or a
 * module the lint autofix rewrote mid-transform) re-parses instead of serving a
 * stale tree. Scope one to a pass — the Vite plugin creates one per `transform`
 * — rather than keeping a process-wide cache alive.
 */
export interface ModuleCache {
  get(fileName: string, text: string): ParsedModule
}

export function createModuleCache(): ModuleCache {
  const byName = new Map<string, ParsedModule>()
  return {
    get(fileName, text) {
      const hit = byName.get(fileName)
      if (hit && hit.text === text) return hit
      const mod = parseModule(fileName, text)
      byName.set(fileName, mod)
      return mod
    },
  }
}
