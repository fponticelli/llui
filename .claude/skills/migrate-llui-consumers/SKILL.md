---
name: migrate-llui-consumers
description: Find every project under a path that depends on @llui/* packages and migrate each to the latest llui versions. Use when asked to migrate, upgrade, or update consumer projects to the newest LLui libraries, audit consumers for outdated @llui deps, or replace hand-rolled code with what an llui library already provides (e.g. @llui/components, @llui/markdown). Also handles bugs found in llui itself by fixing them on a branch.
---

# Migrate llui consumers

Scans a directory tree for projects that consume `@llui/*` packages, then
migrates each one to the **latest published** versions — fixing the breaking
changes that come with a pre-v1, frequently-breaking library, and folding in
refactors that replace hand-rolled code with what an llui library already
provides.

This skill lives inside the llui repo on purpose. Each step is anchored on an
**authoritative oracle**, not a proxy:

- **what is latest** → the npm registry's `dist-tags.latest` (what a consumer's
  install actually resolves), reconciled against the local checkout.
- **what changed** → the `version` field of `packages/<pkg>/package.json` across
  git history (exact, structured) — there are no CHANGELOG files and the release
  tags are stale (stop at the 0.0.x era).
- **did the migration work** → the consumer's own build + typecheck + test going
  green, plus llui's **compile-time lint** (a botched migration won't compile).

The driver scripts read directly from this repo; **run them from the llui repo
root** (`/Users/francoponticelli/projects/llui`). All paths below are relative
to that root.

## How it's driven

Two deterministic helpers do the mechanical work; agents do the judgement; a
schema keeps the judgement verifiable:

| Step             | Tool                          | What it does                                                  |
| ---------------- | ----------------------------- | ------------------------------------------------------------- |
| 1. Discover      | `discover.mjs`                | Find consumer projects + version gap vs npm-latest            |
| 1b. Git precheck | **git per repo**              | Pull origin; skip repos not on a clean default branch         |
| 2. Delta         | `changelog.mjs`               | Exact commit log for a package since the pinned version       |
| 3. Audit + plan  | **Explore agent per project** | Map usage, find lib-duplication → `plan.schema.json` artifact |
| 4. Gate          | **you + the user**            | Review plan artifacts, wait for go-ahead                      |
| 5. Implement     | **subagent per project**      | Apply plan; success = the verify oracles go green             |
| 6. Upstream      | **subagent in llui**          | Real llui bug → fix on a branch, report                       |

## Prerequisites

Node ≥ 20 and git. Nothing to install — both drivers are dependency-free
(`node:` builtins only). Confirmed working on Node 24, git 2.50.

## Step 1 — Discover (run this first)

```bash
# default root is ~/projects; pass a path to scope it
node .claude/skills/migrate-llui-consumers/discover.mjs
node .claude/skills/migrate-llui-consumers/discover.mjs ~/projects --json
node .claude/skills/migrate-llui-consumers/discover.mjs --no-npm   # offline: target = local checkout
```

"Latest" is the npm registry `dist-tags.latest` (fetched concurrently — what a
consumer install resolves). The human table flags each project
`⬆ NEEDS MIGRATION` / `✓ up to date` and lists every dep as
`behind | current | local-link | unknown-package` with the `pinned → target`
gap. `--json` emits `{ root, lluiRepo, npmReachable, npm, local, divergence, projects[] }`
(each `project` has `dir`, `rel`, `behind`, `packages[]`; each package row
carries `pinned`, `target`, `targetSource`, `localVersion`, `npmLatest`). The
llui repo itself is excluded from the scan.

- If npm is unreachable, it **falls back to the local checkout and says so**
  (`--no-npm` forces this).
- **`divergence`** lists packages where the local checkout is _ahead_ of npm —
  unreleased changes a consumer can't install yet. That's a Step-6 signal: a
  fix the consumer needs may require cutting a release first.
- `workspace:`/`link:`/`file:` deps show as `local-link` — they track local
  source; no bump, but still audit for breaking-change exposure + lib-duplication.

## Step 1b — Git-state precheck (pull + branch gate)

A migration writes to the consumer's working tree, so it must start from a
clean, up-to-date checkout — **never** on top of unrelated in-flight work. Do
this before investing in deltas/audit, and **after** discovery (which gives you
the dirs).

The git state is **per repo, not per project** — `discover.mjs` can return
several projects in one repo (e.g. dungeonlogs has `apps/client` _and_
`packages/ui`). Collapse the discovered `dir`s to their unique repo roots first:

```bash
git -C "<project dir>" rev-parse --show-toplevel   # → the repo root
```

For each unique repo root:

1. **Fetch:** `git -C <repo> fetch --quiet origin`.
2. **Read state:** current branch (`git -C <repo> symbolic-ref --quiet --short HEAD`)
   and dirtiness (`git -C <repo> status --porcelain`). Find the repo's default
   branch — `git -C <repo> symbolic-ref --quiet --short refs/remotes/origin/HEAD`
   (strip the `origin/` prefix), falling back to `main` then `master`.
3. **Gate:**
   - On the default branch **and** clean working tree → `git -C <repo> pull --ff-only`
     and proceed. (If `--ff-only` fails — diverged history — treat it as a skip
     and call it out; don't force.)
   - **Not** on the default branch, **or** a dirty working tree → **SKIP every
     consumer project under that repo.** Do not stash, switch, or commit on the
     user's behalf.

**Call out the skips explicitly** before moving on — name each skipped repo, the
branch it's actually on (or "uncommitted changes"), and the consumer projects
that were dropped as a result — so the user can park that work and re-run later.
A repo shared by an approved project and a skipped reason doesn't get split: if
the repo isn't clean-on-default, all its projects are skipped together.

## Step 2 — Per-package change delta

For each `behind` package, get the exact commits to read for breaking changes.
The anchor is found by reading the `version` field of the package manifest at
each commit (not by parsing commit subjects) — the commit that _set_ the version
to the pinned value is the start of the delta:

```bash
node .claude/skills/migrate-llui-consumers/changelog.mjs @llui/dom 0.9.0
node .claude/skills/migrate-llui-consumers/changelog.mjs @llui/effects 0.1.0 --json
```

Output: the anchor commit (the release that shipped the pinned version), then
every non-release/-docs commit touching `packages/<pkg>` since — the
`feat:`/`fix:`/`perf:` subjects are the breaking-change shortlist. **Read the
actual diffs** of the suspicious ones with `git show <hash>` before planning;
pre-v1 commits don't mark themselves breaking, so the diff is the truth.

## Step 3 — Audit + plan (one Explore agent per project)

For each project that needs work, spawn an **Explore agent** scoped to that
project's `dir`. The agent's output is a JSON **plan artifact** conforming to
[`plan.schema.json`](plan.schema.json) — structured so the gate can review it,
the implementer can consume it, and it can be checked against the deterministic
discover/changelog output instead of trusted as prose. Brief:

> Read `plan.schema.json` first; your output must conform. Audit `<project dir>`
> as an llui consumer. (1) For each behind package run `changelog.mjs` and
> `git show <hash>` to find the BREAKING deltas. (2) Inventory how the project
> uses each `@llui/*` package and map which call sites break. (3) Find **custom
> code that duplicates an llui library** — hand-rolled dialog/tabs/accordion/
> select/tree/tour vs `@llui/components`; bespoke markdown vs `@llui/markdown`;
> custom router vs `@llui/router`; effect plumbing vs `@llui/effects`. (4) Note
> genuine llui bugs as `upstreamIssues`. Do NOT edit anything. Output one JSON
> object per the schema.

Save each plan (e.g. `migration-plans/<project>.json`). The deterministic
fields (`bumps`) must reconcile with `discover.mjs`; if they don't, the agent
drifted — re-run.

## Step 4 — Approval gate (do not skip)

Present all plan artifacts to the user together. **Wait for explicit go-ahead**
before any consumer repo is touched — per project or all at once. Pre-v1
breaking changes are risky; the user gates them.

## Step 5 — Implement (one subagent per approved project)

Spawn an implementation subagent per approved project. Because these are
**separate git repos**, each works in its own repo directly (no shared
worktree). Brief:

> Migrate `<project dir>` to latest llui per this plan: <plan JSON>. Create a
> branch first. Bump the `@llui/*` versions in package.json, reinstall, apply
> every breakingFix and refactor. **Do not trust the plan's line numbers —
> re-locate each site by its content (grep the `before`/symbol) before editing;
> they are hints, not addresses.** Keep refactor commits separate from bump
> commits. Success is defined by the plan's `verify.commands` ALL going green
> (build + typecheck + test; the llui vite-plugin's compile-time lint runs in
> build, so a bad migration fails to compile) — report their output, don't just
> claim success. Do not push or open a PR. If a fix reveals a bug in llui itself
> (not the consumer), STOP that thread, capture a minimal repro + affected
> package as an upstream issue, and report back — do not work around it.

Run independent projects in parallel. The migration is done for a project only
when its `verify` oracles pass; collect and report each one's actual output.

## Step 6 — Upstream fixes (llui bug found → fix on a branch)

When a subagent reports a genuine llui bug/gap (per the user's decision: report
**and** fix in llui), in the llui repo:

1. Write up the issue: repro, affected package, suggested fix.
2. Create a dedicated branch (`git checkout -b fix/<short-desc>` — never commit
   the migration's incidental changes onto `main`).
3. Have a subagent implement + test the fix in the relevant `packages/*` (TDD:
   failing test first — see CLAUDE.md). Do **not** push or merge automatically.
4. Report the branch + what it fixes. The consumer migration that surfaced it
   may need to wait for a new llui release, or temporarily pin local source.

## Gotchas

- **Plan line numbers are unreliable; content is not.** A verified dry-run on
  `@dl/client` had the Explore agent identify the correct breaking change, file,
  and fix — but report line 358 for a site that was actually at line 8861 (a
  huge `app.ts`). The implementer (Step 5) **re-locates every site by content**,
  treating the plan's line number as a hint. This is baked into the Step-5 brief.
- **"Latest" is npm, and it can differ from this checkout.** `discover.mjs`
  targets the registry's `dist-tags.latest`. When the local checkout is ahead
  (unreleased bumps), the run reports it under `divergence` — the consumer
  _cannot install_ those changes until a release is cut. Don't plan a bump to a
  version that isn't published.
- **No CHANGELOG, stale tags.** `changelog.mjs` anchors on the manifest
  `version` field across history, not commit subjects or tags (tags stop at the
  0.0.x era). If it prints "no commit sets the manifest to X," the pinned
  version predates this branch or came from a range — fall back to
  `git log --oneline -- packages/<pkg>` and reason about the span manually.
- **The scan excludes anything under the llui repo path** — its own
  examples/packages/site are not "consumers." Point the root elsewhere
  (`~/projects`) to find real consumers.
- **Hidden dirs and `node_modules`/`dist`/`build`/`.turbo`/`coverage`/`.next`
  are skipped** during the walk. Verify the consumer count looks right.
- **Git state is per repo, not per project (Step 1b).** A repo with several
  consumer projects passes or fails the precheck as a unit — if it isn't on a
  clean default branch, every project under it is skipped together. Never stash,
  switch branches, or commit on the user's behalf to make a dirty repo eligible;
  call it out and let the user park it.
- **Library-replacement refactors are folded into the migration** (user
  decision), so a bump may also delete hand-rolled code and wire in
  `@llui/components`. Keep these as clearly-labeled commits — reviewable apart
  from the bumps even though they ship together.

## Troubleshooting

- `discover: root is not a directory` — the path arg doesn't exist; check it.
- Empty output / "(none found)" — no consumers under that root, or you pointed
  it at the llui repo itself (excluded). Try `~/projects`.
- `⚠ npm registry unreachable` in the header — offline or registry down; the run
  fell back to local versions. Re-run with network, or accept local as target
  via `--no-npm` if migrating against this checkout deliberately.
- `changelog.mjs` warns "no commit sets the manifest to X" — see the stale-tags
  gotcha; inspect `git log -- packages/<pkg>` manually.
