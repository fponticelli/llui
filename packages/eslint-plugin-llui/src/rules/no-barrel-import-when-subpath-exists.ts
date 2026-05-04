import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils'
import { createRequire } from 'node:module'
import { createRule } from '../createRule.js'

/**
 * Forbids importing a name from an `@llui/*` package's barrel when the
 * package ships a sub-path export for that name. The barrel form is
 * tree-shake-friendly with modern bundlers, but the build still has to
 * parse every transitively-exported module before dead-code elimination
 * can prove the rest unused. Sub-path imports short-circuit the parse:
 * `import { dialog } from '@llui/components/dialog'` reads exactly one
 * module instead of all 100+.
 *
 * The rule reads the target package's `package.json` `exports` field at
 * lint init (cached per-package) and consults it on every
 * `ImportDeclaration`. For each named specifier whose name matches an
 * existing `./<name>` sub-path export, suggest a split. Autofix splits
 * the offending names into per-sub-path import statements while
 * preserving any names that don't have a sub-path under the original
 * barrel import.
 *
 * Sister rule of `llui/namespace-import` — together they enforce the
 * import hierarchy described in `@llui/components`'s README.
 */

// Packages we know ship sub-path exports for individual modules. The
// `exports` field is consulted at runtime, so adding a package here
// just opts it into the check — the actual sub-path inventory is
// discovered, not hard-coded.
const TARGETS = new Set(['@llui/components'])

type SubpathSet = Set<string> | null // null = couldn't resolve, skip silently

const subpathCache = new Map<string, SubpathSet>()

/**
 * Test-only seam: lets unit tests inject a known sub-path inventory
 * for a target package without depending on the file-system resolution
 * order of `createRequire`. The keys are the cache keys
 * `${packageName}@${context.cwd}` — tests should pass `cwd: '*'` and
 * the lint runner with the same cwd.
 *
 * Exported as `__seedSubpaths` (double-underscore) to mark it as a test
 * surface. Real consumers should never reach for this.
 */
export function __seedSubpaths(packageName: string, fromDir: string, subs: string[]): void {
  subpathCache.set(`${packageName}@${fromDir}`, new Set(subs))
}

/* v8 ignore next */
export function __clearSubpathCache(): void {
  subpathCache.clear()
}

function loadSubpaths(packageName: string, fromDir: string): SubpathSet {
  const cacheKey = `${packageName}@${fromDir}`
  const cached = subpathCache.get(cacheKey)
  if (cached !== undefined) return cached
  let result: SubpathSet = null
  try {
    const req = createRequire(`${fromDir}/index.js`)
    const pkgPath = req.resolve(`${packageName}/package.json`)
    const pkg = req(pkgPath) as { exports?: Record<string, unknown> }
    if (pkg.exports && typeof pkg.exports === 'object') {
      const subs = new Set<string>()
      for (const key of Object.keys(pkg.exports)) {
        if (key === '.' || key.includes('*')) continue
        if (!key.startsWith('./')) continue
        subs.add(key.slice(2))
      }
      result = subs
    }
  } catch {
    // Package isn't installed or has no exports field — skip silently.
    result = null
  }
  subpathCache.set(cacheKey, result)
  return result
}

function specifierImportedName(spec: TSESTree.ImportSpecifier): string {
  return spec.imported.type === AST_NODE_TYPES.Identifier ? spec.imported.name : spec.imported.value
}

export const noBarrelImportWhenSubpathExistsRule = createRule({
  name: 'no-barrel-import-when-subpath-exists',
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description:
        'Disallow barrel imports from `@llui/*` packages when a sub-path export exists for the named import. Sub-paths short-circuit the barrel parse — smaller bundle, faster cold builds.',
    },
    schema: [],
    messages: {
      preferSubpath:
        "Import '{{name}}' from the sub-path '{{source}}/{{name}}' instead of the barrel '{{source}}'. Sub-path imports skip the barrel parse — smaller bundle, faster cold builds. Autofixable.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      ImportDeclaration(node) {
        const src = node.source.value
        if (typeof src !== 'string' || !TARGETS.has(src)) return

        const subpaths = loadSubpaths(src, context.cwd)
        if (!subpaths) return

        const namedSpecs = node.specifiers.filter(
          (s): s is TSESTree.ImportSpecifier => s.type === AST_NODE_TYPES.ImportSpecifier,
        )
        const splittable: TSESTree.ImportSpecifier[] = []
        const remaining: TSESTree.ImportSpecifier[] = []
        const otherSpecs = node.specifiers.filter((s) => s.type !== AST_NODE_TYPES.ImportSpecifier)

        for (const spec of namedSpecs) {
          if (subpaths.has(specifierImportedName(spec))) {
            splittable.push(spec)
          } else {
            remaining.push(spec)
          }
        }

        if (splittable.length === 0) return

        // Build the autofix once. We attach it to the FIRST splittable
        // specifier's report. The remaining specifiers get reports
        // without fixes — they all describe the same root problem and
        // a single fix resolves them all. Letting only one specifier
        // carry the fix avoids ESLint's overlapping-fix conflict
        // detection (which would suppress all our fixes if multiple
        // tried to rewrite the same range).
        const buildFix: TSESLint.ReportFixFunction = (fixer) => {
          const lines: string[] = []

          // Surviving barrel import (if any non-splittable specifiers remain).
          if (remaining.length > 0 || otherSpecs.length > 0) {
            const otherText = otherSpecs
              .map((s) => {
                if (s.type === AST_NODE_TYPES.ImportDefaultSpecifier) return s.local.name
                if (s.type === AST_NODE_TYPES.ImportNamespaceSpecifier) {
                  return `* as ${s.local.name}`
                }
                return ''
              })
              .filter(Boolean)
            const remText = remaining.map((s) => {
              const imported = specifierImportedName(s)
              return imported === s.local.name ? s.local.name : `${imported} as ${s.local.name}`
            })
            const head = otherText.length > 0 ? otherText.join(', ') : ''
            const named = remText.length > 0 ? `{ ${remText.join(', ')} }` : ''
            const middle = [head, named].filter(Boolean).join(', ')
            lines.push(`import ${middle} from '${src}'`)
          }

          // One sub-path import per splittable name.
          for (const spec of splittable) {
            const imported = specifierImportedName(spec)
            const local = spec.local.name
            const named = imported === local ? `{ ${local} }` : `{ ${imported} as ${local} }`
            lines.push(`import ${named} from '${src}/${imported}'`)
          }

          return fixer.replaceText(node, lines.join('\n'))
        }

        for (let i = 0; i < splittable.length; i++) {
          const spec = splittable[i]!
          const imported = specifierImportedName(spec)
          context.report({
            node: spec,
            messageId: 'preferSubpath',
            data: { name: imported, source: src },
            // Only the first report carries the fix.
            fix: i === 0 ? buildFix : undefined,
          })
        }
      },
    }
  },
})

export default noBarrelImportWhenSubpathExistsRule
