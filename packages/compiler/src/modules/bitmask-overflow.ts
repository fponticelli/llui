// `bitmask-overflow` — errors when a component reads more than 62 unique
// state paths. The runtime bitmask is two 31-bit words (`mask` 0..30,
// `maskHi` 31..61); paths past the 62-path limit collapse to FULL_MASK
// (-1) and re-evaluate every binding on change, negating the optimization.
//
// Migrated from `@llui/eslint-plugin`'s bitmask-overflow rule
// (v0.x). Promoted to a compiler error (was an ESLint warning) so the
// LLM-first authoring path cannot silently ship overflowing components.
// LLMs ignore warnings; the compiler-error channel is non-bypassable.
//
// The diagnostic message includes:
//   - the per-top-level-field breakdown so authors know where to slice,
//   - a co-occurrence note for fields whose every sub-path always fires
//     in the same accessor sets (those collapse to one bit if the parent
//     object is read as a unit),
//   - a recommendation to restructure state so the most-read paths
//     collapse to fewer top-level prefixes, or to factor the offending
//     subtree into a subApp.
//
// Anchors the diagnostic on the file's first `component(...)` call so
// the location is meaningful. Files without a `component()` call are
// silent — utility modules that happen to read state-shaped accessors
// don't trigger the rule.

import ts from 'typescript'
import { collectAccessorPathSets, collectStatePathsFromSource } from '../collect-deps.js'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { findComponentCalls } from './_shared.js'

const PATH_LIMIT = 62

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

function findCooccurringFields(
  paths: Set<string>,
  accessorSets: Set<string>[],
): Array<{ field: string; saved: number }> {
  const subPathsByTop = new Map<string, string[]>()
  for (const p of paths) {
    const dot = p.indexOf('.')
    if (dot < 0) continue
    const top = p.slice(0, dot)
    const arr = subPathsByTop.get(top) ?? []
    arr.push(p)
    subPathsByTop.set(top, arr)
  }
  const appearances = new Map<string, Set<number>>()
  for (let i = 0; i < accessorSets.length; i++) {
    for (const path of accessorSets[i]!) {
      if (!appearances.has(path)) appearances.set(path, new Set())
      appearances.get(path)!.add(i)
    }
  }
  const out: Array<{ field: string; saved: number }> = []
  for (const [field, subPaths] of subPathsByTop) {
    if (subPaths.length < 2) continue
    const first = appearances.get(subPaths[0]!) ?? new Set<number>()
    let uniform = true
    for (let i = 1; i < subPaths.length; i++) {
      const set = appearances.get(subPaths[i]!) ?? new Set<number>()
      if (!setsEqual(first, set)) {
        uniform = false
        break
      }
    }
    if (uniform) out.push({ field, saved: subPaths.length - 1 })
  }
  return out.sort((a, b) => b.saved - a.saved)
}

export function bitmaskOverflowModule(): CompilerModule {
  return {
    name: 'bitmask-overflow',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/bitmask-overflow',
        description:
          'Component reads more than 62 unique state paths — paths past the limit fall back to FULL_MASK.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        // Re-parse from text. PreTransform passes (e.g.
        // `bindingDescriptorsModule` in agent mode) produce synthetic
        // AST nodes that lack parent pointers; `collectStatePathsFromSource`
        // walks parent chains and crashes on undefined. Re-parsing
        // guarantees a clean tree with `setParentNodes=true` — the
        // analysis is over the user's source, which is what we want
        // regardless of upstream rewrites.
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const componentCalls = findComponentCalls(sf)
        if (componentCalls.length === 0) return
        const componentCall = componentCalls[0]!

        const paths = collectStatePathsFromSource(sf)
        const pathCount = paths.size
        if (pathCount <= PATH_LIMIT) return

        const overflow = pathCount - PATH_LIMIT
        const byTopLevel = new Map<string, number>()
        for (const p of paths) {
          const top = p.split('.', 1)[0]!
          byTopLevel.set(top, (byTopLevel.get(top) ?? 0) + 1)
        }
        const sorted = [...byTopLevel.entries()].sort((a, b) => b[1] - a[1])
        const candidates: string[] = []
        let saved = 0
        for (const [field, n] of sorted) {
          if (pathCount - saved <= 31) break
          candidates.push(field)
          saved += n
        }
        const breakdown = sorted.map(([field, n]) => `${field} (${n})`).join(', ')
        const candidateList = candidates.map((f) => `\`${f}\``).join(', ')

        const accessorSets = collectAccessorPathSets(sf)
        const cooccurring = findCooccurringFields(paths, accessorSets)
        const cooccurrenceNote =
          cooccurring.length > 0
            ? `\n\nCo-occurrence detected: ` +
              cooccurring
                .map(
                  ({ field, saved: s }) =>
                    `every sub-path under \`${field}\` always fires together; reading \`s.${field}\` as one unit saves ${s} bit${s === 1 ? '' : 's'}`,
                )
                .join('; ') +
              `. Bundle those reads into a single \`s.${cooccurring[0]!.field}\` access (e.g. \`const ${cooccurring[0]!.field} = s.${cooccurring[0]!.field}\`) before extraction — cheaper refactor, same budget relief.`
            : ''

        const message =
          `Component has ${pathCount} unique state access paths (${overflow} past the ${PATH_LIMIT}-path limit). ` +
          `Paths ${PATH_LIMIT + 1}..${pathCount} fall back to FULL_MASK — their changes re-evaluate every binding ` +
          `in the component, negating the bitmask optimization for those updates.\n\n` +
          `Top-level fields by path count: ${breakdown}.${cooccurrenceNote}\n\n` +
          `Recommended fix: restructure state so ${candidateList} are grouped under one or two ` +
          `reference-stable parents, or factor that subtree into a separate module that consumes ` +
          `the parent's state via the standard view-function \`(props, send)\` convention. ` +
          `Alternative: use \`combine()\` to split the reducer into slices when the parent's \`update()\` ` +
          `is mostly mechanical routing.`

        ctx.reportDiagnostic({
          id: 'llui/bitmask-overflow',
          severity: 'error',
          category: 'perf',
          message,
          location: {
            file: sf.fileName,
            range: rangeFromOffsets(sf.text, componentCall.getStart(sf), componentCall.getEnd()),
          },
        })
      },
    },
  }
}
