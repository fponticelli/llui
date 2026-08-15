#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { withLock, lockPathFor } from './lib/worktree-lock.mjs'

/**
 * The repo's pre-commit hook (wired via `simple-git-hooks` in package.json).
 *
 * It runs `pnpm lint-staged` — but SERIALIZED across every worktree of this
 * repository, because lint-staged's backup is a `git stash` and the stash stack
 * is a single shared ref (issue #179). Measured, on lint-staged 16.4.0:
 *
 *     git stash create
 *     git stash store --quiet --message "lint-staged automatic backup" <sha>
 *     git stash list --format="%h %s" -z
 *     git stash drop --quiet 0
 *
 * State the mechanism precisely, because the obvious reading is wrong in a way
 * that understates nothing but misplaces the fix: that trailing `0` is NOT a
 * blind "drop the top". `getBackupStash()` (gitWorkflow.js:124) resolves the
 * entry by SHORT HASH out of the `stash list` above it and returns its INDEX —
 * it just happened to be 0. The defect is that the lookup and the use are two
 * separate git invocations against a ref EVERY WORKTREE SHARES, so a lane that
 * pushes or drops in between shifts every index and the second call lands on
 * somebody else's entry. Demonstrated: lane A resolves its backup to index 0,
 * another worktree's hook stores its own backup, and A's `stash drop 0` deletes
 * THAT one while A's leaks onto the stack forever. The error path is the
 * expensive half — `stash apply --index <n>` (gitWorkflow.js:405) against a
 * shifted index applies a foreign lane's working tree into this one, which is
 * exactly the "inexplicably foreign changes" two lanes reported.
 *
 * Serializing the hook closes it: with one holder at a time there is nobody to
 * shift the index. Manual `git stash` in a worktree stays hazardous and stays a
 * convention ("don't"), because no lock can cover a command a human types — but
 * that is the case a lane controls, and the hook is the one it does not.
 *
 * WHY NOT `--no-stash`, the cheap option the issue floats: measured on 16.4.0 it
 * does remove every stash call (11 git invocations, none of them `stash`) and it
 * does NOT change what gets committed — partial staging still works, because
 * `--no-stash` implies only `--no-revert`, not `--no-hide-partially-staged`, and
 * the hide/restore mechanism uses a patch file rather than the stash. But it
 * trades the race for silent DATA LOSS on the failure path: with a partially
 * staged file and a failing task (`prettier --write` on an unparseable file),
 * "Restoring unstaged changes" does not complete and the unstaged hunks are gone
 * with no recovery path, while the successful tasks' modifications stay applied
 * to the index. Swapping a loud, recoverable race for a silent, unrecoverable
 * one is not an improvement, so the backup stays and the lock makes it safe.
 */

const gitCommonDir = resolve(
  execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim(),
)
const lockPath = lockPathFor(gitCommonDir, 'llui-lint-staged.lock')

const exitCode = await withLock(
  lockPath,
  {
    label: 'lint-staged pre-commit',
    // A lint-staged run is seconds. Five minutes is room for a dozen lanes
    // queueing behind one slow one, and still fails loudly rather than hanging.
    timeoutMs: 300_000,
    // Beyond this a holder is presumed dead (a crashed hook, a killed agent).
    // Well clear of any real run so a slow-but-live holder is never stolen from.
    staleMs: 600_000,
    onWait: (message) => process.stderr.write(`[llui] ${message}\n`),
  },
  () =>
    new Promise((resolvePromise, rejectPromise) => {
      const child = spawn('pnpm', ['lint-staged'], { stdio: 'inherit', shell: false })
      child.on('error', rejectPromise)
      child.on('exit', (code, signal) => resolvePromise(signal !== null ? 1 : (code ?? 1)))
    }),
)

process.exit(exitCode)
