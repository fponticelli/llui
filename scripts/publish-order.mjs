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

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgsDir = join(root, 'packages')

const pkgs = []
for (const dir of readdirSync(pkgsDir)) {
  const pj = join(pkgsDir, dir, 'package.json')
  if (!existsSync(pj)) continue
  const json = JSON.parse(readFileSync(pj, 'utf8'))
  pkgs.push({ dir, name: json.name, private: !!json.private, json })
}

const byName = new Map(pkgs.map((p) => [p.name, p]))
const publishable = pkgs.filter((p) => !p.private)

// Direct in-repo runtime edges: p -> depName (depName must ship before p).
function directDeps(p) {
  const specs = {
    ...(p.json.dependencies || {}),
    ...(p.json.peerDependencies || {}),
    ...(p.json.optionalDependencies || {}),
  }
  return Object.keys(specs).filter((dep) => byName.has(dep) && !byName.get(dep).private)
}

// Kahn topological sort over publishable packages, tie-broken by name for
// deterministic output.
const names = new Set(publishable.map((p) => p.name))
const adj = new Map() // name -> set of names that depend on it (edges dep -> dependent)
const indeg = new Map()
for (const p of publishable) {
  indeg.set(p.name, indeg.get(p.name) || 0)
  for (const dep of directDeps(p)) {
    if (!names.has(dep)) continue
    if (!adj.has(dep)) adj.set(dep, new Set())
    if (!adj.get(dep).has(p.name)) {
      adj.get(dep).add(p.name)
      indeg.set(p.name, (indeg.get(p.name) || 0) + 1)
    }
  }
}

const ready = publishable
  .filter((p) => (indeg.get(p.name) || 0) === 0)
  .map((p) => p.name)
  .sort()
const order = []
while (ready.length) {
  const name = ready.shift()
  order.push(name)
  const dependents = [...(adj.get(name) || [])].sort()
  for (const d of dependents) {
    indeg.set(d, indeg.get(d) - 1)
    if (indeg.get(d) === 0) {
      // insert keeping the queue sorted
      let i = ready.findIndex((x) => x > d)
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

// Transitive dep closure per package (over publishable graph).
function transitive(name) {
  const p = byName.get(name)
  const seen = new Set()
  const stack = directDeps(p).filter((d) => names.has(d))
  while (stack.length) {
    const d = stack.pop()
    if (seen.has(d)) continue
    seen.add(d)
    for (const dd of directDeps(byName.get(d))) if (names.has(dd)) stack.push(dd)
  }
  return [...seen]
}

for (const name of order) {
  const p = byName.get(name)
  process.stdout.write(`${p.dir}\t${p.name}\t${transitive(name).join(',')}\n`)
}
