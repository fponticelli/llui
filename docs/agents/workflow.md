# Agent workflow: worktrees, commits, tooling

_Detail behind the short rules in the root `CLAUDE.md` (Committing, AGENTS.md, llui-mcp). Moved here verbatim so the always-loaded instructions stay small; read this before changing the area it covers._

## `AGENTS.md` is a symlink

This file provides guidance to coding agents working in this repository. **`AGENTS.md` is a symlink to it** — one file, two conventional names, so the tool that reads `AGENTS.md` and the tool that reads `CLAUDE.md` get the same text by construction. It used to be a second hand-maintained copy and had drifted 137 lines behind (#258), including a mechanical Claude→Codex substitution that corrupted a real path into `.Codex/skills/`, a directory that has never existed. Write for both audiences: nothing here may name one agent's private directory without naming the other's, and `scripts/test/agent-instructions-mirror.test.ts` fails the build if the symlink is ever replaced by a copy. **One consequence to know rather than to discover:** on a `core.symlinks=false` checkout (git's default on Windows without developer mode) `AGENTS.md` materializes as a ~10-byte regular file whose whole content is the string `CLAUDE.md` — an EMPTY INSTRUCTION SET that reads as SUCCESS, since the agent opens a file, gets ten bytes and proceeds with no model of this repo and no error to attribute it to. The repo already required symlink-capable checkouts for the three `site/content/*.md` links, so this is a fourth instance of a standing requirement and not a new one — but it is by far the highest-blast-radius instance, and it is REASONED from git's documented behaviour, not measured (no Windows machine was available).

## Committing (parallel worktrees)

- **Never run `git stash` in this repository.** `refs/stash` is ONE ref on the COMMON git dir — worktrees do not get their own — so two lanes stashing at overlapping times interleave on a single stack and a `pop`/`drop` acts on the wrong entry. Two lanes destroyed each other's entries this way in one batch of parallel agent work.
- The pre-commit hook is that hazard automated, which is why it is not left to convention: `lint-staged`'s backup IS a `git stash`, and it resolves its own entry's INDEX in one `git` call and uses it in the next (`stash drop <n>` / `stash apply --index <n>`), so a lane that pushes in between shifts the index and the second call lands on someone else's entry. The hook therefore runs through `scripts/pre-commit.mjs`, which serializes every worktree's `lint-staged` behind a lock on the common git dir (#179).
- **`SKIP_SIMPLE_GIT_HOOKS=1` DEFEATS THAT LOCK.** Its early exit lives in the wrapper `simple-git-hooks` generates, ahead of the line that invokes `scripts/pre-commit.mjs`, so exporting it does not merely skip formatting — it removes the serialization, and any lane that does so re-opens #179 for every lane racing it. Nothing in this repo can close that. It also loses the formatting gate outright (measured: an unformatted file commits and `prettier --check` then fails), which makes it strictly worse than `--no-stash`.
- Two other options were measured and rejected, both written up in the header of `scripts/pre-commit.mjs` — read it before revisiting this: `--no-stash` (removes every stash call and changes nothing about what gets committed, but on a FAILING task with a partially staged file the unstaged hunks silently leave the working tree and index — recoverable only via `.git/lint-staged_unstaged.patch`, which no git command offers you and which the next run overwrites), and `SIMPLE_GIT_HOOKS_RC` (genuinely _can_ serialize, but it is an env var: it cannot be committed and binds only shells that export it, and #179 needs two unprotected lanes).
- **The lock's stress tests are part of the contract, and their configuration is not decorative.** FOUR mutual-exclusion defects shipped past a GREEN version of `scripts/test/worktree-lock.test.ts`, each reachable only after the previous was fixed, and every one was found by contending harder rather than by reasoning. Do not lower the 48-process / ~0 ms-critical-section configuration, and do not drop the crash-recovery case (a third of contenders dying while holding) — that workload was absent, which is precisely why the fourth defect, on the stale-break path, was invisible.
- What the lock guarantees, precisely: mutual exclusion under normal contention and while recovering crashed holders, measured at 0 violations across 32–64 contenders with and without extra CPU load. The one residual is a FOREIGN-HOST record aged out by `staleMs`, whose owner may still be alive because no PID is readable across machines — inherent to a filesystem lock shared across hosts, and not reachable here, where every worktree is on one machine.
- Hooks are shared across worktrees, so a change to `simple-git-hooks.pre-commit` only reaches a lane after **that lane's** next `pnpm install`.
- **`lint-staged` runs `scripts/prettier-staged.mjs`, not `prettier` directly, and that indirection is load-bearing: prettier EXITS 2 on an explicitly named symlink** (`[error] Explicitly specified pattern "AGENTS.md" is a symbolic link.`, measured on prettier 3.8.1). lint-staged always names staged files explicitly and does not filter symlinks itself, and **`.prettierignore` does not suppress it** — the symlink check runs ahead of the ignore rules for an explicit pattern, measured both ways — so any commit that stages a symlink fails the hook outright. The three `site/content/*.md` symlinks have always had that exposure and never fired only because nothing re-stages them; `AGENTS.md` (#258) made it live. The wrapper drops symlinks (`lstat`, never a hard-coded list) and passes everything else through, so a real formatting error still exits non-zero. Nothing is lost: a symlink has no content of its own, and `pnpm format` / `format:check` glob a directory, where prettier skips symlinks silently and exits 0.
- **`pnpm --filter <pkg> build check lint test` is INVALID.** pnpm treats `build` as the one script name and forwards `check lint test` as its ARGV; it does not run the other three scripts. Before the exact component-style publisher, that mistake made the shell `cp` treat `test/` as its destination and corrupt the tree. The publisher now ignores those extra arguments, which makes the same command a misleadingly green build-only check. Run each script separately.
- **Parallel agent lanes share ONE scratchpad directory, and a mutation harness with a hardcoded absolute `ROOT` will silently mutate ANOTHER lane's tree.** Measured in the #231 batch: one lane invoked what it believed was its own `mutate.py` and patched a sibling lane's worktree instead; it survived only because that harness happened to restore in a `finally`. A mutation number measured against a tree another lane is concurrently patching is worthless in a way that reads as a perfectly normal result — the same class as an unfaithful mutation, arriving through infrastructure. Three rules: put the harness under a per-lane subdirectory; **assert** the root (`git rev-parse --show-toplevel` equals this lane's worktree, and the branch is this lane's) before writing a byte, failing loudly otherwise; and restore in a `finally`. Verify a lane's tree with `git diff` on every file, **never a file count** — the batch's one real contamination was a stray `deps: ['']` left by a skipped restore, and a count showed the expected number of modified files and looked correct. The same trap has a verifier-side form: a leftover-mutation check whose needle occurs twice in the file reports a false positive (#158's two-occurrences trap, one layer out).
- **A test that WALKS the repo must not walk `.claude/worktrees/`, and a floor-shaped vacuity guard cannot tell you that it did.** That directory is gitignored and holds a FULL CHECKOUT of every sibling lane, so a `readdirSync` walk from the repo root sees every other branch's files as if they were yours. Measured: a config-sweeping test found **210** `vitest*.config.ts` from the main worktree, **180 of them foreign**, failed on 18 divergences (a sibling's `vitest.stress.config.ts` reporting `testTimeout 180000`, with every allowlist key repo-relative and therefore unmatchable against a `.claude/...` path), and took its own transform from 5.6 s to 171 s by `import()`ing 180 foreign modules — down entirely if a sibling was mid-edit. **CI never reproduces it** (fresh checkout, no worktrees), so it fires exactly on the local `pnpm verify` this file tells lanes to run before merging. Enumerate with `git ls-files --cached --others --exclude-standard` (tracked plus untracked-but-not-ignored, so a brand-new file is still covered and anything gitignored is structurally unreachable), not a directory walk. And assert the EXACT set, never `length > N`: a floor only detects under-collection and would have waved 210 through.
- **A generated file that every lane regenerates is not mergeable by text, and each lane passing `check:generated` alone proves nothing about the merge.** `site/public/llms-full.txt` is built from EVERY package's API page, so three lanes each regenerated it in isolation and git text-merged the three results, silently dropping one lane's whole block while reporting no conflict. All three lanes were individually green. The only correct resolution is to regenerate AFTER the merge and commit that — make it a step of the merge, not something a lane can own.

## After merging

After merging branches locally, run `pnpm install` in the main worktree before believing any failure it reports: a stale `node_modules` resolves a different dependency graph than the lockfile describes (a merged-but-uninstalled tree resolved `vite@6` for the site while the lockfile said `vite@8`, producing two pages of `Plugin<any>` incompatibility that did not exist in CI).

## Spawned `llui-mcp` and the parent watchdog (#192)

The CLI polls `process.ppid` and shuts down when the process that started it goes away, because nothing propagates a parent's death to a non-detached child and a killed `pnpm dev` / vitest worker otherwise leaves it alive at PPID 1 still holding its port (one was found 31 h old). It fires on the ppid CHANGING, not on it being 1, and does not arm when the process was started BY init. **It DOES arm under a shell** — `nohup llui-mcp … & disown` is not reparented by `disown`, so when that shell exits the server shuts itself down. Export **`LLUI_MCP_NO_PARENT_WATCH=1`** when deliberately daemonizing it; that is the only thing covering that case.

## Commands (full comments)

```bash
pnpm turbo build          # Build all packages (tsc)
pnpm turbo check          # Type-check all packages (tsc --noEmit)
pnpm turbo lint           # ESLint all packages
pnpm check:benchmarks     # Type-check benchmark/setup/orchestration tooling
pnpm check:scripts        # Type-check ALL of scripts/ (.ts + .mjs, checkJs on) — #252
pnpm lint:scripts         # ESLint ALL of scripts/, TYPE-AWARE (.ts + .mjs) — #256
pnpm turbo test           # Run tests (vitest) across all packages
pnpm format               # Prettier format everything
pnpm format:check         # Check formatting without writing
pnpm gallery              # Component Gallery: shell + Baseline theme + Registry skins on one origin

pnpm test:durations       # Record the per-file test-duration baseline from a full run (#193)
pnpm check:test-durations # Re-run and diff against that baseline (load-normalized, see below)

# Single package
pnpm --filter @llui/dom build
pnpm --filter @llui/dom test
pnpm --filter @llui/dom check

# Single test file (from package dir)
cd packages/dom && pnpm vitest run test/signals/runtime.test.ts

# Benchmarks (js-framework-benchmark)
pnpm bench:setup              # One-time: clone + install + compile the js-framework-benchmark repo,
                              # then build the 5 ticker apps (scripts/setup-bench.ts; idempotent).
                              # Never hand-run the npm ci chain — upstream's root install ERESOLVEs
                              # and a && chain silently skips the installs the harness needs (#81).
pnpm bench                    # Build + run jfb + compare against saved baseline
pnpm bench --runs 3           # N runs, median-of-medians (reduces single-run noise)
pnpm bench --all              # Also re-run all competitor frameworks (~15 min)
pnpm bench:all --runs 5 --save # Only supported baseline save: complete, atomic standard+ticker capture
pnpm bench:container:smoke     # Build the pinned image and verify Node/pnpm/Chrome
pnpm bench:container -- --framework llui --runs 1 # One-shot Docker diagnostic with exact argv forwarding
pnpm bench:build              # Build jfb app only (no benchmark run)
```
