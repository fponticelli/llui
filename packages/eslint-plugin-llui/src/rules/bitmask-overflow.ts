import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'
import { collectAccessorPathSets, collectStatePaths } from '../util/state-paths.js'

/**
 * Warns when a component reads more than 31 unique state paths.
 *
 * The runtime bitmask is a single 31-bit `number`. Paths 0..30 each get
 * a unique bit; everything past 31 collapses to `FULL_MASK` (-1) — those
 * paths re-evaluate every binding in the component, negating the
 * bitmask optimization for the affected updates.
 *
 * The diagnostic includes:
 *   - the per-top-level-field breakdown so authors know where to slice,
 *   - a co-occurrence note for fields whose every sub-path always fires
 *     in the same accessor sets (those collapse to one bit if the
 *     parent object is read as a unit),
 *   - a recommendation to extract via `child()`.
 *
 * Migrated from the Vite plugin's `bitmask-overflow` diagnostic.
 */

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

export const bitmaskOverflowRule = createRule({
  name: 'bitmask-overflow',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Warn when a component reads more than 31 unique state paths — paths past the limit fall back to FULL_MASK and lose bitmask gating.',
    },
    schema: [],
    messages: {
      overflow:
        'Component has {{count}} unique state access paths ({{overflow}} past the 31-path limit). Paths 32..{{count}} fall back to FULL_MASK — their changes re-evaluate every binding in the component, negating the bitmask optimization for those updates.\n\nTop-level fields by path count: {{breakdown}}.{{cooccurrenceNote}}\n\nRecommended fix: extract {{candidateList}} into {{aOrEmpty}} child component{{plural}} via `child()` (see /api/dom#child). Each child gets its own 31-path bitmask, so the extracted paths no longer count against the parent\'s limit. Alternative: use `sliceHandler` to embed a state machine that owns the field\'s reducer.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      Program(program) {
        // Only emit on files that actually define a component, so we
        // don't lint utility modules that happen to read state-shaped
        // accessors. The diagnostic anchors on the `component(...)`
        // call so the location is meaningful.
        let componentCall: import('@typescript-eslint/utils').TSESTree.CallExpression | null = null
        const findComponent = (n: import('@typescript-eslint/utils').TSESTree.Node) => {
          if (componentCall) return
          if (
            n.type === AST_NODE_TYPES.CallExpression &&
            n.callee.type === AST_NODE_TYPES.Identifier &&
            n.callee.name === 'component'
          ) {
            componentCall = n
            return
          }
          for (const key of Object.keys(n) as (keyof typeof n)[]) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue
            const child = n[key] as unknown
            if (Array.isArray(child)) {
              for (const c of child) {
                if (c && typeof c === 'object' && 'type' in c)
                  findComponent(c as import('@typescript-eslint/utils').TSESTree.Node)
              }
            } else if (child && typeof child === 'object' && 'type' in (child as object)) {
              findComponent(child as import('@typescript-eslint/utils').TSESTree.Node)
            }
          }
        }
        findComponent(program)
        if (!componentCall) return

        const paths = collectStatePaths(program)
        const pathCount = paths.size
        if (pathCount <= 31) return

        const overflow = pathCount - 31
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

        const accessorSets = collectAccessorPathSets(program)
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

        context.report({
          node: componentCall,
          messageId: 'overflow',
          data: {
            count: String(pathCount),
            overflow: String(overflow),
            breakdown,
            cooccurrenceNote,
            candidateList,
            aOrEmpty: candidates.length === 1 ? 'a' : '',
            plural: candidates.length === 1 ? '' : 's',
          },
        })
      },
    }
  },
})
