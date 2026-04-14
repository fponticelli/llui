---
description: Prepare a release — bump changed packages, update CHANGELOG, commit, push, and print the final publish command
user_invocable: true
---

# /publish — Prepare a release and print the publish command

Detect which `@llui/*` packages have changed since the last release, bump their versions, update runtime `peerDependencies` on cascaded packages, write a new `CHANGELOG.md` entry, run the full verify matrix, commit, push — and **print the final `./scripts/publish.sh` command** for the user to run. The skill **does not publish to npm itself**; that step stays in the user's hands so they can review and run it when ready.

## Usage

```
/publish              # patch bump (default)
/publish patch
/publish minor
/publish major
/publish --all patch  # force-bump ALL packages, ignoring change detection
```

## Preflight — working tree must be clean

**Stop immediately and refuse to proceed** if any of these are true:

- `git status --porcelain` returns any output (uncommitted changes, untracked files). Tell the user to run `/commit` first, or stash, or clean up — then re-run `/publish`.
- Current branch isn't `main`. Confirm with the user before continuing on a non-main branch.
- `git log HEAD..@{u}` returns output (remote is ahead of local) — stop. Tell the user to `git pull` first.

`git log @{u}..HEAD` returning output (local ahead of remote) is fine — we'll push at the end.

Reason the working tree must be clean: the `release:` commit produced by this skill must contain ONLY version bumps and the CHANGELOG entry — nothing else. If uncommitted fixes land in it, rolling back a bad release becomes much harder, and the CHANGELOG entry will drift from the commit it names.

## Steps

### 1. Full verify before any changes

```bash
pnpm verify
```

If anything fails, stop. The user needs to fix the failure and re-run `/commit` before `/publish` can proceed. Never bump versions against a red build.

### 2. Detect changed packages

Find the most recent `release:` commit — this repo uses `release:` commit prefixes to mark releases, not git tags:

```bash
LAST_RELEASE=$(git log --grep='^release:' --format=%H -n 1)
```

If no `release:` commit exists, treat all packages as changed.

For each of the 10 packages (`dom`, `effects`, `vite-plugin`, `test`, `router`, `transitions`, `components`, `vike`, `mcp`, `lint-idiomatic`), check whether any files under `packages/<name>/` changed since `$LAST_RELEASE`:

```bash
for pkg in dom effects vite-plugin test router transitions components vike mcp lint-idiomatic; do
  if [ -n "$(git diff --name-only "$LAST_RELEASE"..HEAD -- "packages/$pkg/")" ]; then
    echo "CHANGED: @llui/$pkg"
  fi
done
```

Also check root-level changes that affect all package build output:

- `scripts/add-js-extensions.mjs` or any `scripts/publish*.sh` — affects all packages
- `tsconfig*.json` at the repo root — affects all packages

If root build plumbing changed, all packages must be bumped and republished — treat that as `--all`.

If `--all` was passed on the command line, skip detection entirely.

### 3. Apply the dependency cascade

If a dependency changed, every package that imports from it at runtime must also bump so consumers pick up the new behavior. The graph:

```
Tier 1 (no in-repo deps): dom, effects, lint-idiomatic
Tier 2 (depend on tier 1):
  dom             → vite-plugin, test, router, transitions, components, vike, mcp
  effects         → (no in-repo dependents)
  lint-idiomatic  → mcp
```

Cascade rules:

- `dom` changed → add `vite-plugin`, `test`, `router`, `transitions`, `components`, `vike`, `mcp` to the changed set.
- `lint-idiomatic` changed → add `mcp`.
- `effects` has no in-repo dependents today — no cascade.

Several packages carry runtime `peerDependencies` pointing at `@llui/dom`. These must be updated to the new `dom` version during the bump (step 5):

- `packages/components/package.json` → `peerDependencies["@llui/dom"]`
- `packages/router/package.json` → `peerDependencies["@llui/dom"]`
- `packages/transitions/package.json` → `peerDependencies["@llui/dom"]`

Other cross-package references use `workspace:*` which `pnpm publish` rewrites automatically — no manual update needed for those.

### 4. Present the plan and get confirmation

Before touching any files, print a plan like:

```
Release plan
============
Last release: 242697e (2026-04-14)

Bumps:
  @llui/dom              0.0.14 → 0.0.15   (direct)
  @llui/vite-plugin      0.0.14 → 0.0.15   (direct)
  @llui/components       0.0.14 → 0.0.15   (cascade: dom)
  ...

peerDependency updates:
  packages/components/package.json:  @llui/dom ^0.0.14 → ^0.0.15
  packages/router/package.json:      @llui/dom ^0.0.14 → ^0.0.15
  packages/transitions/package.json: @llui/dom ^0.0.14 → ^0.0.15

CHANGELOG entry: 0.0.15 — <today's date>

Proceed?
```

Wait for user confirmation. If the user wants to drop a package or adjust versions, do that before step 5.

### 5. Bump package versions

For each package in the changed set, read its CURRENT version from `packages/<name>/package.json` and compute the new version. Packages may be at different versions — never assume a shared baseline.

Do the edits via a Node one-liner (NOT Edit/Write — this is a bulk mechanical change):

```bash
node -e '
const fs = require("fs");
const DOM_FROM = "0.0.14", DOM_TO = "0.0.15";
const bumps = {
  "packages/dom/package.json":         ["0.0.14", "0.0.15"],
  "packages/vite-plugin/package.json": ["0.0.14", "0.0.15"],
  // ... one entry per changed package
};
for (const [f, [from, to]] of Object.entries(bumps)) {
  const pkg = JSON.parse(fs.readFileSync(f, "utf8"));
  if (pkg.version !== from) { console.error(f, "expected", from, "got", pkg.version); process.exit(1); }
  pkg.version = to;
  // Runtime dependency on @llui/dom (components/router/transitions)
  if (pkg.peerDependencies && pkg.peerDependencies["@llui/dom"] === "^" + DOM_FROM) {
    pkg.peerDependencies["@llui/dom"] = "^" + DOM_TO;
  }
  if (pkg.dependencies && pkg.dependencies["@llui/dom"] === "^" + DOM_FROM) {
    pkg.dependencies["@llui/dom"] = "^" + DOM_TO;
  }
  fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + "\n");
  console.log("bumped", pkg.name, from, "→", to);
}
'
```

After the script runs, **verify the peerDependency updates actually landed**:

```bash
grep '"@llui/dom"' packages/{components,router,transitions}/package.json
```

All three should show `^<new dom version>`. The bump script can silently miss them if the peer range was specified differently (e.g. `~0.0.14` instead of `^0.0.14`) — check explicitly.

### 6. Write the CHANGELOG entry

Read `CHANGELOG.md` and prepend a new entry at the top, below the intro paragraph and above the most recent previous entry.

**Structure — date-anchored with per-package sub-sections:**

```markdown
## YYYY-MM-DD — <qualifier>

**Released:** `@llui/{pkg1,pkg2,...}@X.Y.Z`; `@llui/other@A.B.C`

<optional one-sentence release summary>

### Breaking

- **`@llui/<pkg>@<version>`** — description. Include the concrete thing users must change.

### Migration

- One bullet per action users should take when upgrading. Usually mirrors the Breaking section but written as an action list ("revert your workaround", "pass `{ foo: bar }`").

### `@llui/<pkg>@<version>`

- **Added** one-line-or-paragraph description.
- **Fixed** ...
- **Improved** ...

### `@llui/<other-pkg>@<version>`

- **Fixed** ...

### All packages — build output

- **Fixed** changes that affect every package's published artifacts (e.g. the `.js` extension rewrite, the `inlineSources` sourcemap fix). Use this for truly cross-cutting items — don't duplicate them per package.

### Docs (optional)

- Documentation changes that aren't tied to a specific package's `dist/`.
```

**Heading conventions:**

- `## YYYY-MM-DD — <qualifier>` — date first so the anchor is stable across lockstep-vs-split releases.
- `<qualifier>` is the tier-1 lockstep version when tier-1 packages bumped (e.g. `2026-04-14 — 0.0.14`). Even when `@llui/effects` / `@llui/mcp` / `@llui/lint-idiomatic` shipped at different numbers on the same day, the tier-1 version is the primary anchor — the full version list goes in the **Released:** line immediately below.
- When only one or two off-cadence packages shipped, use them as the qualifier instead: `2026-04-13 — @llui/lint-idiomatic@0.0.10, @llui/mcp@0.0.7`.
- The `**Released:**` line directly below the heading spells out the concrete bumps. Always include it, even when the qualifier covers everything, so readers can grep a package name and find every release it appears in.

**Bullet conventions:**

- Every bullet lives inside a `### @llui/<pkg>@<version>` sub-section. No top-level orphan bullets — the sub-section header carries the attribution so individual bullets don't need a package prefix.
- Lead each bullet with one of four labels in bold: **Added**, **Fixed**, **Improved**, **Breaking**. Pick the one that best describes the user-visible impact.
- For a breaking change inside a package sub-section, write **Breaking** as a short pointer and keep the full explanation in the top-level Breaking section: `- **Breaking** \`mcpPort\` is now opt-in. See top of release block.`
- Cross-cutting changes that touch every package's build output go under **`### All packages — build output`**, not duplicated across each `@llui/<pkg>` section.

**Section order inside a release:**

1. **Breaking** — at the top, before any per-package section. Users evaluating an upgrade read this first.
2. **Migration** — immediately after Breaking, when actions are needed.
3. **Tier-1 packages first** — usually `@llui/dom` then `@llui/vite-plugin`, then the rest in rough dependency order.
4. **Off-cadence packages** — `@llui/effects`, `@llui/mcp`, `@llui/lint-idiomatic` after tier-1.
5. **All packages — build output** — near the end, before Docs.
6. **Docs** — if there's anything worth noting.

Omit empty sections. If a release only touches one package, you still use a `### @llui/<pkg>@<version>` sub-section — don't collapse it into bullets under the `**Released:**` line, because then the version attribution gets lost when someone grep's through the file.

**Source the entry from the actual commits since `$LAST_RELEASE`**:

```bash
git log "$LAST_RELEASE"..HEAD --oneline --no-merges
# For any commit with non-obvious user-visible impact, read the full body:
git log <hash> -1 --format=%B
```

Skip chores, formatting passes, and internal refactors with zero user-visible impact. Skip the release commit itself — it doesn't exist yet; we're writing it.

**If the current conversation context already contains the fixes** (e.g. the user just finished a round of bug fixes in this same session), prefer drafting the entry from that context rather than re-deriving it from git — the conversation usually has richer "why" detail than the commit bodies.

Show the draft entry to the user before writing it. Offer to revise before committing.

**Important — don't duplicate the content:**

The root `CHANGELOG.md` is the source of truth. The site renders the same file via a symlink at `site/content/changelog.md → ../../CHANGELOG.md`. Do NOT write to `site/content/changelog.md` directly — the symlink already points at root. Verify it still exists:

```bash
ls -la site/content/changelog.md   # should show → ../../CHANGELOG.md
```

If the symlink is missing or has been replaced with a regular file, stop and tell the user. Something has broken the site/repo sync.

### 7. Force rebuild and full verify

Packages need to be rebuilt against their new versions before publish, and the verify matrix must stay green with the bumped versions:

```bash
pnpm turbo build --force
pnpm turbo check lint test
```

Turbo caches aggressively, so `--force` on the build is required to actually rebuild with the new `package.json` metadata. If verify fails, stop — something about the version bump broke something; fix it before continuing.

Quick sanity check on the build output:

```bash
# Relative imports should keep their .js extensions
grep -o "from '[^']*'" packages/dom/dist/mount.js | head -3

# Sourcemaps should have inline sources
node -e 'console.log("has sourcesContent:", Array.isArray(JSON.parse(require("fs").readFileSync("packages/dom/dist/mount.js.map", "utf8")).sourcesContent))'
```

Both should succeed. If `.js` extensions are missing, the `scripts/add-js-extensions.mjs` pass hasn't run or is broken — fix it before publishing. Broken ESM imports were literally one of the bugs the 0.0.14 release shipped a fix for; don't regress it.

### 8. Commit the release

One commit with all version bumps + the CHANGELOG entry:

```bash
git add packages/*/package.json CHANGELOG.md
git commit -m "$(cat <<'EOF'
release: @llui/{dom,vite-plugin,test,router,transitions,components,vike}@X.Y.Z, @llui/effects@A.B.C, ...

<one-line summary of what this release ships>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

The commit message subject **MUST start with `release:`** — that's how step 2 finds it next time. Use brace expansion for packages that share a version line: `@llui/{dom,vite-plugin,...}@X.Y.Z`.

**Do NOT create git tags.** This repo tracks releases via `release:` commits, not tags. Creating tags would be dead state that nobody reads.

### 9. Push

```bash
git push
```

### 10. Print the final publish command

Print the final command for the user to run — **do NOT run it yourself.** `scripts/publish.sh` takes a list of package names and publishes them in dependency order:

```
Ready to publish. Run:

  ./scripts/publish.sh <space-separated list of bumped packages>

Example (all 10 from a full release):
  ./scripts/publish.sh dom effects lint-idiomatic vite-plugin test router transitions components vike mcp

(Only list the packages that were actually bumped in step 5. The script
enforces tier 1 → tier 2 order internally, so argument order doesn't
strictly matter, but passing them in tier order makes the log easier to read.)

The script uses `pnpm publish`, which rewrites workspace:* to concrete versions
at pack time. If a package fails with an auth error, check your npm token in
~/.npmrc or run `pnpm login`.
```

Then stop. The user runs the command when they're ready.

## Reasoning notes

**Why not auto-publish:** npm publishes are irreversible and visible to every downstream consumer. The user explicitly wanted a "give me the final command" flow so they can review the prepared state, the git log, and the CHANGELOG before pulling the trigger. Publishing is the one step where the blast radius justifies manual confirmation even when everything else looks green.

**Why detect releases via `release:` commit instead of git tag:** this repo doesn't create tags for releases. Searching for `release:` commits is the single source of truth for "what's been published." Adding tags just to track releases would duplicate that signal and create a second thing to keep in sync.

**Why force a clean working tree:** the release commit must name exactly what ships on npm. If uncommitted fixes end up in the release commit, the CHANGELOG entry we write will describe commits we didn't actually include (and the reverse — commits we did include won't appear in the notes). Easier to refuse and make the user run `/commit` first than to try to reason about mixed state.

**Why bump `peerDependencies` explicitly:** `workspace:*` gets rewritten automatically by `pnpm publish`, but `peerDependencies` declared as concrete ranges (`^0.0.14`) stay whatever is in the committed `package.json`. Forgetting to update these produces packages that declare compatibility with an old dom version while actually importing from a new one — silent version drift for consumers. Always grep to verify after the bump script runs.

**Why pass the commit message via HEREDOC:** multi-line commit messages with `-m "..."` lose formatting. HEREDOC preserves the body exactly, which matters because the brace-expanded `release:` subject can get long and the body typically has a structured one-line summary.
