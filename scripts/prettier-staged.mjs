#!/usr/bin/env node
// `prettier --write` for lint-staged, minus the staged SYMLINKS.
//
// Prettier REFUSES an explicitly named symlink and exits 2:
//
//     $ npx prettier --write AGENTS.md
//     [error] Explicitly specified pattern "AGENTS.md" is a symbolic link.
//     $ echo $?
//     2
//
// (measured on prettier 3.8.1). Two things make that a pre-commit failure
// rather than a curiosity. lint-staged always names staged files EXPLICITLY —
// it does not glob a directory, and it does not filter symlinks itself (the
// only mention of one in lint-staged 16.4.0 is a comment about git's `T`
// status in `getStagedFiles.js`) — and `.prettierignore` does NOT suppress it:
// the symlink check runs ahead of the ignore rules for an explicit pattern, so
// listing the file there leaves the exit code at 2 (measured both ways).
//
// So a commit that stages a symlink fails the hook outright. That went from
// latent to live when `AGENTS.md` became a symlink to `CLAUDE.md` (#258); the
// three `site/content/*.md` symlinks have always had it and never fired only
// because nothing re-stages them.
//
// Skipping them loses no coverage. A symlink has no content of its own, so
// there is nothing to format: prettier formats the TARGET when the target is
// staged, and `pnpm format` / `pnpm format:check` glob a directory, where
// prettier skips symlinks silently and exits 0 (measured with the link in
// place). The filter is `lstat`-based rather than a hard-coded list, so a
// future symlink is covered without anyone remembering this file exists.
//
// A path that does not exist is PASSED THROUGH rather than dropped, so a real
// prettier error still surfaces instead of being silently swallowed here.

import { lstatSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const files = process.argv.slice(2).filter((file) => {
  try {
    return !lstatSync(file).isSymbolicLink()
  } catch {
    return true
  }
})

// Nothing but symlinks staged — prettier with no file arguments would format
// nothing and exit 0 anyway, but it prints a usage error, so return early.
if (files.length === 0) process.exit(0)

// Resolved through the module graph rather than taken from PATH: this runs
// under a git hook, where PATH is whatever the committing shell had, and a
// `prettier` picked up from outside the workspace would format against a
// different version than `pnpm format:check` verifies with.
const require = createRequire(import.meta.url)
const prettierBin = path.join(
  path.dirname(require.resolve('prettier/package.json')),
  'bin/prettier.cjs',
)

const result = spawnSync(process.execPath, [prettierBin, '--write', ...files], {
  stdio: 'inherit',
  shell: false,
})
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
