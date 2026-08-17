#!/usr/bin/env node
// discover.mjs — the deterministic front-half of the llui-consumer migration.
//
// Walks a directory tree for package.json files that depend on any @llui/*
// package (or `llui-agent`) and reports, per consumer, how far behind LATEST
// each dep is.
//
// "Latest" is AUTHORITATIVE = the npm registry `dist-tags.latest` — that is
// what a consumer's install actually resolves. The local monorepo version is
// read too and RECONCILED: when local > npm, there are unreleased changes the
// consumer cannot get yet (a Step-6 signal); workspace:/link: consumers track
// local source directly. Offline (or --no-npm): fall back to local, loudly.
//
// The llui repo itself (this script lives inside it) is excluded from the scan.
//
// Usage:
//   node discover.mjs [rootDir]            # human table (default root: ~/projects)
//   node discover.mjs [rootDir] --json     # machine-readable JSON for an agent
//   node discover.mjs [rootDir] --no-npm   # skip the registry; target = local
//
// Exit 0 always (discovery is not a pass/fail gate).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
// .claude/skills/migrate-llui-consumers/discover.mjs -> repo root is 3 up.
const LLUI_REPO = join(SCRIPT_DIR, '..', '..', '..')

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const noNpm = args.includes('--no-npm')
const ROOT = args.find((a) => !a.startsWith('--')) || join(homedir(), 'projects')

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.turbo', 'coverage', '.next'])
const LLUI_DEP = /^(@llui\/[a-z-]+|llui-agent)$/

// ── local monorepo versions (packages/*) ────────────────────────────────────
function localVersions() {
  const out = {}
  for (const entry of readdirSync(join(LLUI_REPO, 'packages'))) {
    try {
      const json = JSON.parse(
        readFileSync(join(LLUI_REPO, 'packages', entry, 'package.json'), 'utf8'),
      )
      if (json.name && json.private !== true) out[json.name] = json.version
    } catch {
      /* skip */
    }
  }
  return out
}

// ── authoritative latest from the npm registry, fetched concurrently ─────────
async function npmLatest(names) {
  const out = {}
  await Promise.all(
    names.map(async (name) => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 7000)
      try {
        const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
          signal: ctrl.signal,
          headers: { accept: 'application/vnd.npm.install-v1+json' }, // light dist-tags doc
        })
        if (res.ok) out[name] = (await res.json())['dist-tags']?.latest ?? null
        else out[name] = null
      } catch {
        out[name] = null // offline / aborted / unpublished
      } finally {
        clearTimeout(t)
      }
    }),
  )
  return out
}

// ── walk the consumer tree ───────────────────────────────────────────────────
function* findPackageJsons(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
      yield* findPackageJsons(join(dir, e.name))
    } else if (e.name === 'package.json') {
      yield join(dir, e.name)
    }
  }
}

function lluiDeps(json) {
  const found = {}
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (!json[field]) continue
    for (const [name, range] of Object.entries(json[field])) {
      if (LLUI_DEP.test(name)) found[name] = { range, field }
    }
  }
  return found
}

function pinnedVersion(range) {
  if (/^(workspace:|link:|file:|portal:|catalog:)/.test(range)) return null
  const m = String(range).match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null
}

function cmp(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

// ── main ─────────────────────────────────────────────────────────────────────
let root
try {
  root = statSync(ROOT).isDirectory() ? ROOT : null
} catch {
  root = null
}
if (!root) {
  console.error(`discover: root is not a directory: ${ROOT}`)
  process.exit(1)
}

const local = localVersions()

// Gather consumers first so we know which package names to query npm for.
const rawProjects = []
for (const pjPath of findPackageJsons(root)) {
  if (pjPath.startsWith(LLUI_REPO)) continue
  let json
  try {
    json = JSON.parse(readFileSync(pjPath, 'utf8'))
  } catch {
    continue
  }
  const deps = lluiDeps(json)
  if (Object.keys(deps).length === 0) continue
  rawProjects.push({ json, dir: dirname(pjPath), deps })
}

const usedNames = [...new Set(rawProjects.flatMap((p) => Object.keys(p.deps)))]
const npm = noNpm ? {} : await npmLatest(usedNames)
const npmReachable = !noNpm && usedNames.some((n) => npm[n] != null)

// target = npm latest when known, else local (with the source recorded).
function targetFor(name) {
  if (!noNpm && npm[name] != null) return { version: npm[name], source: 'npm' }
  if (local[name] != null) return { version: local[name], source: 'local' }
  return { version: null, source: 'none' }
}

const projects = rawProjects.map(({ json, dir, deps }) => {
  const packages = Object.entries(deps).map(([name, { range, field }]) => {
    const pinned = pinnedVersion(range)
    const tgt = targetFor(name)
    let status
    if (pinned == null) status = 'local-link'
    else if (tgt.version == null) status = 'unknown-package'
    else status = cmp(pinned, tgt.version) < 0 ? 'behind' : 'current'
    return {
      name,
      range,
      field,
      pinned,
      target: tgt.version,
      targetSource: tgt.source,
      localVersion: local[name] ?? null,
      npmLatest: noNpm ? null : (npm[name] ?? null),
      status,
    }
  })
  return {
    name: json.name ?? relative(root, dir),
    dir,
    rel: relative(root, dir),
    behind: packages.some((p) => p.status === 'behind'),
    packages,
  }
})
projects.sort((a, b) => a.rel.localeCompare(b.rel))

// Divergence: local ahead of npm = unreleased changes (Step-6 signal).
const divergence = noNpm
  ? []
  : usedNames
      .filter((n) => local[n] && npm[n] && cmp(local[n], npm[n]) > 0)
      .map((n) => ({ name: n, local: local[n], npm: npm[n] }))

if (asJson) {
  console.log(
    JSON.stringify(
      { root, lluiRepo: LLUI_REPO, npmReachable, npm, local, divergence, projects },
      null,
      2,
    ),
  )
} else {
  console.log(`llui consumers under ${root}`)
  console.log(
    noNpm
      ? `(latest = LOCAL ${LLUI_REPO}/packages; npm skipped via --no-npm)`
      : npmReachable
        ? `(latest = npm registry dist-tags.latest; local from ${LLUI_REPO}/packages)`
        : `⚠ npm registry unreachable — fell back to LOCAL ${LLUI_REPO}/packages`,
  )
  console.log('')
  if (projects.length === 0) console.log('  (none found)')
  for (const p of projects) {
    console.log(`▸ ${p.name}  [${p.rel}]  ${p.behind ? '⬆ NEEDS MIGRATION' : '✓ up to date'}`)
    for (const pk of p.packages) {
      const detail =
        pk.status === 'behind'
          ? `${pk.pinned} → ${pk.target}`
          : pk.status === 'local-link'
            ? `${pk.range} (local link)`
            : pk.status === 'current'
              ? `${pk.pinned} (current)`
              : `${pk.range} (?, target=${pk.target ?? 'unknown'})`
      const src = pk.targetSource === 'local' && !noNpm ? ' [target via local: npm unknown]' : ''
      console.log(`    ${pk.status.padEnd(13)} ${pk.name.padEnd(26)} ${detail}${src}`)
    }
    console.log('')
  }
  const needing = projects.filter((p) => p.behind).length
  console.log(`${projects.length} llui consumer project(s); ${needing} behind latest.`)
  if (divergence.length) {
    console.log(
      `\n⚠ local ahead of npm (unreleased — consumers cannot install yet; Step-6 signal):`,
    )
    for (const d of divergence) console.log(`    ${d.name}: local ${d.local} > npm ${d.npm}`)
  }
}
