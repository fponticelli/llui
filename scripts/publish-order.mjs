#!/usr/bin/env node
// Emit the set of publishable packages in dependency (topological) order.
//
// Replaces the old hand-maintained TIER1/TIER2/TIER3 arrays in publish.sh: the
// publish list is derived from packages/*/package.json (every package that is
// NOT `"private": true`), topologically sorted so a package's in-repo runtime
// dependencies publish before it does.
//
// Output: one line per package, TAB-separated:
//   <dir>\t<name>\t<comma-separated transitive in-repo dep names>
//
// The dep column lets publish.sh cascade a failure: if a package fails to
// publish, every later package that (transitively) depends on it is skipped
// instead of published against a dependency that never shipped.
//
// Edges come from `dependencies` + `peerDependencies` + `optionalDependencies`
// (the specs that must resolve for a consumer) — NOT `devDependencies`, which
// are irrelevant to a published consumer and would introduce false cycles.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The subset of a package manifest this script reads.
 * @typedef {object} PackageManifest
 * @property {string} [name]
 * @property {boolean} [private]
 * @property {Record<string, string>} [dependencies]
 * @property {Record<string, string>} [peerDependencies]
 * @property {Record<string, string>} [optionalDependencies]
 */

/**
 * One workspace package under `packages/`.
 * @typedef {object} Pkg
 * @property {string} dir Directory name under `packages/`.
 * @property {string} name The manifest's `name`.
 * @property {boolean} private Whether the manifest marks it `"private": true`.
 * @property {PackageManifest} json
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgsDir = join(root, 'packages')

/** @type {Pkg[]} */
const pkgs = []
for (const dir of readdirSync(pkgsDir)) {
  const pj = join(pkgsDir, dir, 'package.json')
  if (!existsSync(pj)) continue
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(pj, 'utf8'))
  const json = /** @type {PackageManifest} */ (parsed)
  if (typeof json.name !== 'string' || json.name === '') {
    throw new Error(`publish-order: ${pj} has no "name"`)
  }
  pkgs.push({ dir, name: json.name, private: !!json.private, json })
}

/** @type {Map<string, Pkg>} */
const byName = new Map(pkgs.map((p) => [p.name, p]))
const publishable = pkgs.filter((p) => !p.private)

/**
 * Direct in-repo runtime edges: p -> depName (depName must ship before p).
 * @param {Pkg} p
 * @returns {string[]}
 */
function directDeps(p) {
  const specs = {
    ...(p.json.dependencies || {}),
    ...(p.json.peerDependencies || {}),
    ...(p.json.optionalDependencies || {}),
  }
  return Object.keys(specs).filter((dep) => {
    const target = byName.get(dep)
    return target !== undefined && !target.private
  })
}

// Kahn topological sort over publishable packages, tie-broken by name for
// deterministic output.
const names = new Set(publishable.map((p) => p.name))
/** @type {Map<string, Set<string>>} name -> set of names that depend on it (edges dep -> dependent) */
const adj = new Map()
/** @type {Map<string, number>} */
const indeg = new Map()
for (const p of publishable) {
  indeg.set(p.name, indeg.get(p.name) || 0)
  for (const dep of directDeps(p)) {
    if (!names.has(dep)) continue
    let dependents = adj.get(dep)
    if (dependents === undefined) {
      dependents = new Set()
      adj.set(dep, dependents)
    }
    if (!dependents.has(p.name)) {
      dependents.add(p.name)
      indeg.set(p.name, (indeg.get(p.name) || 0) + 1)
    }
  }
}

const ready = publishable
  .filter((p) => (indeg.get(p.name) || 0) === 0)
  .map((p) => p.name)
  .sort()
/** @type {string[]} */
const order = []
while (ready.length) {
  const name = ready.shift()
  if (name === undefined) break
  order.push(name)
  const dependents = [...(adj.get(name) || [])].sort()
  for (const d of dependents) {
    const remaining = indeg.get(d)
    if (remaining === undefined) {
      throw new Error(`publish-order: no in-degree recorded for ${d}`)
    }
    indeg.set(d, remaining - 1)
    if (remaining - 1 === 0) {
      // insert keeping the queue sorted
      const i = ready.findIndex((x) => x > d)
      if (i === -1) ready.push(d)
      else ready.splice(i, 0, d)
    }
  }
}

if (order.length !== publishable.length) {
  const missing = publishable.map((p) => p.name).filter((n) => !order.includes(n))
  console.error(
    `publish-order: dependency cycle among publishable packages, unresolved: ${missing.join(', ')}`,
  )
  process.exit(1)
}

/**
 * Look a package up by name, failing loudly rather than yielding `undefined`.
 * @param {string} name
 * @returns {Pkg}
 */
function pkgOf(name) {
  const p = byName.get(name)
  if (p === undefined) throw new Error(`publish-order: unknown package ${name}`)
  return p
}

/**
 * Transitive dep closure per package (over publishable graph).
 * @param {string} name
 * @returns {string[]}
 */
function transitive(name) {
  /** @type {Set<string>} */
  const seen = new Set()
  const stack = directDeps(pkgOf(name)).filter((d) => names.has(d))
  while (stack.length) {
    const d = stack.pop()
    if (d === undefined) break
    if (seen.has(d)) continue
    seen.add(d)
    for (const dd of directDeps(pkgOf(d))) if (names.has(dd)) stack.push(dd)
  }
  return [...seen]
}

for (const name of order) {
  const p = pkgOf(name)
  process.stdout.write(`${p.dir}\t${p.name}\t${transitive(name).join(',')}\n`)
}
