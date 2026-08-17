#!/usr/bin/env node
// changelog.mjs — derive the change delta for one llui package since a given
// version, straight from this monorepo's git history.
//
// There are no CHANGELOG files and no usable release tags (tagging stopped at
// the 0.0.x era — verified). The DURABLE, exact anchor is the `version` field
// in `packages/<pkg>/package.json` across history: it is structured JSON, it
// changes only at release commits, and each value occupies one contiguous span
// (versions are monotonic). So the commit that SET the version to <from> is the
// OLDEST commit whose package.json shows that version. Everything after it,
// touching the package, is the from→latest delta. No free-form subject parsing.
//
// Usage:
//   node changelog.mjs <package> <fromVersion> [pkgDir] [--json]
//   e.g. node changelog.mjs @llui/dom 0.9.0
//
// pkgDir defaults to @llui/foo -> packages/foo, llui-agent -> packages/agent.

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const LLUI_REPO = join(SCRIPT_DIR, '..', '..', '..')

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const pos = argv.filter((a) => !a.startsWith('--'))
const PKG = pos[0]
const FROM = pos[1]
const DIR_OVERRIDE = pos[2]

if (!PKG || !FROM) {
  console.error('usage: node changelog.mjs <package> <fromVersion> [pkgDir] [--json]')
  process.exit(2)
}

const git = (...a) => execFileSync('git', ['-C', LLUI_REPO, ...a], { encoding: 'utf8' }).trimEnd()
const gitSafe = (...a) => {
  try {
    return git(...a)
  } catch {
    return ''
  }
}

const pkgDirName = DIR_OVERRIDE ?? (PKG === 'llui-agent' ? 'agent' : PKG.replace(/^@llui\//, ''))
const pkgPath = `packages/${pkgDirName}`
const manifest = `${pkgPath}/package.json`

if (!existsSync(join(LLUI_REPO, pkgPath))) {
  console.error(`changelog: package dir ${pkgPath} not found — pass an explicit pkgDir arg`)
  process.exit(1)
}

// Read the `version` field of the package manifest AS OF a given commit.
function versionAt(commit) {
  const raw = gitSafe('show', `${commit}:${manifest}`)
  if (!raw) return null
  try {
    return JSON.parse(raw).version ?? null
  } catch {
    const m = raw.match(/"version"\s*:\s*"([^"]+)"/)
    return m ? m[1] : null
  }
}

// All commits that touched the manifest, newest-first.
const manifestCommits = git('log', '--format=%H', '--', manifest).split('\n').filter(Boolean)

// The anchor: the OLDEST commit whose manifest version == FROM (the release that
// shipped FROM). Walk oldest→newest and take the first match.
let anchor = null
for (const c of [...manifestCommits].reverse()) {
  if (versionAt(c) === FROM) {
    anchor = c
    break
  }
}

const latest = versionAt('HEAD')

// Delta: non-release/-docs/-merge commits touching the package since the anchor.
const SKIP = /^(release|docs|chore|merge)\b/i
let commits = []
if (anchor) {
  commits = git('log', `${anchor}..HEAD`, '--format=%H%x09%s', '--', pkgPath)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, ...rest] = l.split('\t')
      return { hash: hash.slice(0, 9), subject: rest.join('\t') }
    })
    .filter((c) => !SKIP.test(c.subject))
}

const result = {
  package: PKG,
  from: FROM,
  latest,
  anchor: anchor
    ? { hash: anchor.slice(0, 9), subject: gitSafe('log', '-1', '--format=%s', anchor) }
    : null,
  pkgPath,
  commits,
}

if (asJson) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`${PKG}: ${FROM} → ${latest ?? '?'}`)
  if (!anchor) {
    console.log(`  ⚠ no commit in history sets ${manifest} to ${FROM} — the pinned version may`)
    console.log(`    predate this branch or resolve from a range. Inspect manually:`)
    console.log(`      git -C ${LLUI_REPO} log --oneline -- ${pkgPath}`)
  } else {
    console.log(`  anchor (shipped ${FROM}): ${result.anchor.hash}  ${result.anchor.subject}`)
    console.log(`  ${commits.length} non-release commit(s) touching ${pkgPath} since:\n`)
    for (const c of commits) console.log(`    ${c.hash}  ${c.subject}`)
    console.log(`\n  Read the diffs before planning: git -C ${LLUI_REPO} show <hash>`)
  }
}
