// Derive Vite `resolve.alias` entries that redirect every subpath a package's
// own `exports` map publishes to its TypeScript/CSS SOURCE files, instead of
// the built `dist/` artifacts a consumer normally resolves to. A dev-server
// test that wants to exercise real source against a running example (so a fix
// or a regression is visible without a package build) needs exactly this for
// every `@llui/*` package it boots.
//
// This replaces a HAND-WRITTEN copy of the mapping that broke silently
// (#264): it assumed every subpath of `@llui/components` lived under
// `src/components/`, so `@llui/components/icon` (published from `dist/icon.js`,
// i.e. `src/icon.ts`) was routed to the nonexistent `src/components/icon.ts`
// instead — Vite resolved nothing, and the six `registryTailwind` cases that
// import it (transitively, via the registry's icon components) timed out
// waiting for a selector that never appeared rather than erroring loudly.
// Deriving aliases from the package's own `exports` map means a NEW export is
// covered automatically, and a moved one cannot silently mis-route: `tsc`
// mirrors `src/` into `dist/` path-for-path (only the extension changes), so
// the `dist/` target an export already names is exactly the coordinate its
// `src/` counterpart lives at, wildcard subpath exports (`./utils/*`) included.

import { readFileSync } from 'node:fs'

/**
 * @typedef {{ find: string | RegExp, replacement: string }} ViteSourceAlias
 */

/**
 * @param {unknown} target - a package.json `exports` map value (a string, or
 *   a conditions object such as `{ types, import }` / `{ types, default }`).
 * @returns {string | null} the `import`/`default` condition's target, or
 *   `null` if this target names no such condition.
 */
function resolveImportTarget(target) {
  if (typeof target === 'string') return target
  if (target !== null && typeof target === 'object') {
    const conditions = /** @type {Record<string, unknown>} */ (target)
    if (typeof conditions.import === 'string') return conditions.import
    if (typeof conditions.default === 'string') return conditions.default
  }
  return null
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExpLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Derive the Vite aliases for one package's `exports` map.
 *
 * @param {object} opts
 * @param {string} opts.packageName - the bare import specifier consumers use, e.g. `'@llui/components'`.
 * @param {string} opts.packageJsonPath - absolute path to that package's `package.json`.
 * @param {string} opts.srcDir - absolute path to that package's `src` directory.
 * @returns {ViteSourceAlias[]}
 */
export function sourceAliasesFromExports({ packageName, packageJsonPath, srcDir }) {
  const pkg = /** @type {{ exports?: unknown }} */ (
    JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  )
  const exportsMap = pkg.exports
  if (exportsMap === null || typeof exportsMap !== 'object') {
    throw new Error(`${packageJsonPath} has no "exports" map to derive source aliases from`)
  }

  const distPrefix = './dist/'
  /** @type {ViteSourceAlias[]} */
  const literalAliases = []
  /** @type {ViteSourceAlias[]} */
  const wildcardAliases = []

  for (const [subpath, target] of Object.entries(exportsMap)) {
    if (subpath === './package.json') continue // the standard "read my own package.json" export; no source equivalent

    const importTarget = resolveImportTarget(target)
    if (importTarget === null) {
      throw new Error(
        `${packageJsonPath} export "${subpath}" has no resolvable "import"/"default" condition`,
      )
    }
    if (!importTarget.startsWith(distPrefix)) {
      throw new Error(
        `${packageJsonPath} export "${subpath}" -> "${importTarget}" does not point under ` +
          `dist/, so a source alias cannot be derived from it`,
      )
    }

    const distRelative = importTarget.slice(distPrefix.length)
    const srcRelative = distRelative.endsWith('.js')
      ? `${distRelative.slice(0, -'.js'.length)}.ts`
      : distRelative
    const specifier = subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`

    if (specifier.includes('*')) {
      const segments = specifier.split('*')
      if (segments.length !== 2 || !srcRelative.includes('*')) {
        throw new Error(`${packageJsonPath} export "${subpath}" uses an unsupported wildcard shape`)
      }
      const [prefix, suffix] = segments
      const find = new RegExp(`^${escapeRegExpLiteral(prefix)}(.+)${escapeRegExpLiteral(suffix)}$`)
      const replacement = `${srcDir}/${srcRelative.replace('*', '$1')}`
      wildcardAliases.push({ find, replacement })
    } else {
      literalAliases.push({ find: specifier, replacement: `${srcDir}/${srcRelative}` })
    }
  }

  // Vite (via `@rollup/plugin-alias`) treats a STRING `find` as matching either
  // an exact id or a path-PREFIX of it (the next character must be `/`), so the
  // bare package name (`'@llui/components'`, from the `.` export) would also
  // prefix-match every subpath id (`'@llui/components/icon'`) if it were tried
  // first. Sorting literal aliases by descending specifier length guarantees
  // every more-specific subpath alias is tried before the bare root alias, which
  // is always the shortest since every other specifier is `packageName + '/...'`.
  literalAliases.sort((a, b) => String(b.find).length - String(a.find).length)

  return [...wildcardAliases, ...literalAliases]
}
