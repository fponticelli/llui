// `no-barrel-import-when-subpath-exists` — errors when a name is imported
// from an `@llui/*` package's barrel and the package ships a sub-path
// export for that name. Sub-paths skip the barrel parse — smaller
// bundle, faster cold builds. Migrated from
// `@llui/eslint-plugin/src/rules/no-barrel-import-when-subpath-exists.ts`.
// Autofix dropped per the migration plan; the error includes the exact
// split-import replacement.

import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

const TARGETS = new Set(['@llui/components'])
type SubpathSet = Set<string> | null
const subpathCache = new Map<string, SubpathSet>()

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
    result = null
  }
  subpathCache.set(cacheKey, result)
  return result
}

export function noBarrelImportWhenSubpathExistsModule(): CompilerModule {
  return {
    name: 'no-barrel-import-when-subpath-exists',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/no-barrel-import-when-subpath-exists',
        description: 'Barrel import has a sub-path export — use the sub-path for smaller bundles.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        // Look up sub-paths relative to the file's directory. If the
        // package isn't installed (test fixture, sandboxed env), the
        // helper returns null and the rule silently skips.
        const fromDir = sf.fileName ? dirname(sf.fileName) : process.cwd()
        for (const stmt of sf.statements) {
          if (!ts.isImportDeclaration(stmt)) continue
          if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
          const src = stmt.moduleSpecifier.text
          if (!TARGETS.has(src)) continue
          const clause = stmt.importClause
          if (!clause || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue
          const subpaths = loadSubpaths(src, fromDir)
          if (!subpaths) continue
          for (const spec of clause.namedBindings.elements) {
            const importedName = (spec.propertyName ?? spec.name).text
            if (!subpaths.has(importedName)) continue
            const localName = spec.name.text
            const fixLine =
              importedName === localName
                ? `import { ${localName} } from '${src}/${importedName}'`
                : `import { ${importedName} as ${localName} } from '${src}/${importedName}'`
            ctx.reportDiagnostic({
              id: 'llui/no-barrel-import-when-subpath-exists',
              severity: 'error',
              category: 'perf',
              message:
                `Import \`${importedName}\` from the sub-path '${src}/${importedName}' instead of ` +
                `the barrel '${src}'. Sub-path imports skip the barrel parse — smaller bundle, ` +
                `faster cold builds. Fix: \`${fixLine}\` (split off from the existing barrel import).`,
              location: {
                file: sf.fileName,
                range: rangeFromOffsets(sf.text, spec.getStart(sf), spec.getEnd()),
              },
            })
          }
        }
      },
    },
  }
}
