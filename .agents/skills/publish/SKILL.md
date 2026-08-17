---
description: Prepare a release — bump changed packages, update CHANGELOG, commit, push, and print the final publish command
user_invocable: true
---

# /publish — Prepare a release and print the publish command

Detect which `@llui/*` packages have changed since the last release, decide the cascade with the user, bump their versions, write a new `CHANGELOG.md` entry, run the full verify matrix, commit, push — and **print the final `./scripts/publish.sh` command** for the user to run. The skill **does not publish to npm itself**; that step stays in the user's hands so they can review and run it when ready.

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

- `git status --porcelain` returns any output (uncommitted changes, untracked files). Tell the user to run `/commit` first or clean up — then re-run `/publish`. **Never stash in this repository.**
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

Discover the publishable package directories dynamically — every directory under `packages/` whose `package.json` lacks `private: true`:

```bash
PUBLISHABLE=$(node -e '
const fs = require("fs");
for (const dir of fs.readdirSync("packages")) {
  const p = `packages/${dir}/package.json`;
  if (!fs.existsSync(p)) continue;
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  if (pkg.private) continue;
  console.log(dir);
}
')

for pkg in $PUBLISHABLE; do
  if [ -n "$(git diff --name-only "$LAST_RELEASE"..HEAD -- "packages/$pkg/")" ]; then
    name=$(node -e "console.log(require('./packages/$pkg/package.json').name)")
    echo "CHANGED: $name"
  fi
done
```

Note: directory names don't always match the published package name. `agent-bridge/` publishes as `llui-agent`. The detection loop reads `package.json` for the name; downstream steps that reference the package use the directory name (since publish.sh and add-js-extensions.mjs operate on directories).

Also check root-level changes that affect all package build output:

- `scripts/add-js-extensions.mjs` or any `scripts/publish*.sh` — affects all packages
- `tsconfig*.json` at the repo root — affects all packages

If root build plumbing changed, all packages must be bumped and republished — treat that as `--all`.

If `--all` was passed on the command line, skip detection entirely.

### 3. Apply the dependency cascade

If a dependency changed, determine whether its published dependents must bump so consumers can
resolve the new version. **Never use a hand-maintained graph.** `scripts/publish-order.mjs` derives
the current graph and topological order from every publishable manifest's `dependencies`,
`peerDependencies`, and `optionalDependencies`. Its transitive column covers newer packages such
as `interactions`, `lexical-collab`, `lexical-loro`, `devmode-annotate`, and
`devmode-annotate-editor` automatically:

```bash
node scripts/publish-order.mjs
```

Cascade rules:

- For any changed in-repo dependency, **it depends on the bump size and the published range.**
  Current internal runtime dependencies and peers use `workspace:^`, which `pnpm publish` rewrites
  to `^<resolved version>`. For pre-1.0 packages, that means:
  - **patch** (`0.12.0 → 0.12.1`) → **no cascade** when the already-published range admits the
    new dependency version. Consumers pick the fix up on their next install; republishing
    unchanged dependents would be version churn.
  - **minor / major** (`0.12.x → 0.13.0`) → cascade to every direct dependent whose
    published range excludes the new version, then repeat transitively for each dependent you
    bump. Without that republish, consumers get an unsatisfiable dependency or peer. Derive the
    closure from manifests and the publish-order output, never by package-name memory.

  Either way, **ask the user** — this materially changes what lands on npm.

**Peer ranges normally need NO manual edit.** Every in-repo `@llui/*` peer is declared `workspace:^`, which `pnpm publish` rewrites at pack time to `^<resolved version>` — so the committed `package.json` never names a version and can't go stale. This includes `@llui/markdown-editor`'s extra `@llui/lexical` and `@llui/components` peers.

That was not always true: peers used to be pinned (`^0.0.14`), and step 5 existed to rewrite them. **Verify before assuming** — run the snippet below. Any peer that is NOT `workspace:^` is a pinned holdover and MUST be bumped by hand (or converted to `workspace:^`), otherwise it declares compatibility with an old dom while importing from a new one.

```bash
node -e '
const fs = require("fs");
let pinned = 0;
for (const dir of fs.readdirSync("packages")) {
  const p = `packages/${dir}/package.json`;
  if (!fs.existsSync(p)) continue;
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const [dep, range] of Object.entries(pkg.peerDependencies ?? {})) {
    if (!dep.startsWith("@llui/")) continue;
    if (range === "workspace:^" || range === "workspace:*") {
      console.log(`✓ ${pkg.name}: peer ${dep} = ${range}`);
    } else {
      console.error(`✗ ${pkg.name}: peer ${dep} = ${range}  (PINNED — bump by hand)`);
      pinned++;
    }
  }
}
process.exit(pinned ? 1 : 0);
'
```

If this exits non-zero, hand-bump each pinned range to the new version (or convert it to `workspace:^`) before continuing. If it exits 0 — the current state — there is nothing to edit and step 5 reduces to bumping `version` fields.

Other cross-package references use `workspace:*` which `pnpm publish` rewrites automatically — no manual update needed for those.

**Anti-pattern check — singleton packages `@llui/dom` and `@llui/interactions` must NOT appear in
`dependencies` of any publishable package.** A direct DOM dependency can split render context;
a direct interactions dependency can split document-level dismissal, focus, nested-layer, and
modal registries. Both must be peer + dev dependencies so app and library share one copy.

Run this **before bumping** and refuse to proceed if it returns anything (skips `private: true` packages — those never get published, so the pin-rewrite path doesn't apply):

```bash
node -e '
const fs = require("fs");
let bad = 0;
for (const dir of fs.readdirSync("packages")) {
  const p = `packages/${dir}/package.json`;
  if (!fs.existsSync(p)) continue;
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  if (pkg.private) continue;
  for (const singleton of ["@llui/dom", "@llui/interactions"]) {
    if (pkg.dependencies?.[singleton]) {
      console.error(`✗ ${pkg.name}: ${singleton} in dependencies (must be peer + dev)`);
      bad++;
    }
  }
}
process.exit(bad ? 1 : 0);
'
```

If this fires, stop and move the singleton from `dependencies` to `peerDependencies` as
`workspace:^`, then add it to `devDependencies` as `workspace:*`.

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
const bumps = {
  "packages/dom/package.json":         ["0.12.0", "0.12.1"],
  // ... one entry per changed package, with its OWN current version
};
for (const [f, [from, to]] of Object.entries(bumps)) {
  const pkg = JSON.parse(fs.readFileSync(f, "utf8"));
  if (pkg.version !== from) { console.error(f, "expected", from, "got", pkg.version); process.exit(1); }
  pkg.version = to;
  fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + "\n");
  console.log("bumped", pkg.name, from, "→", to);
}
'
```

The script bumps `version` and nothing else — `workspace:^` peers need no rewrite (step 3). **Only if step 3's check reported a PINNED peer** does it also need a rewrite block; add one for that specific package rather than reinstating a blanket `@llui/dom` rewrite.

After the script runs, confirm nothing became pinned and every intended version landed:

```bash
node -e '
const fs = require("fs");
let bad = 0;
for (const dir of fs.readdirSync("packages")) {
  const p = `packages/${dir}/package.json`;
  if (!fs.existsSync(p)) continue;
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const [dep, range] of Object.entries(pkg.peerDependencies ?? {})) {
    if (!dep.startsWith("@llui/")) continue;
    if (range !== "workspace:^" && range !== "workspace:*") {
      console.error(`✗ ${pkg.name}: peer ${dep} = ${range}  (PINNED — must name the new version)`);
      bad++;
    }
  }
}
console.log(bad ? "FAIL" : "✓ no pinned @llui/* peers — pnpm rewrites all of them at pack time");
process.exit(bad ? 1 : 0);
'
git --no-pager diff --stat -- 'packages/*/package.json'
```

The `git diff --stat` is the real check: it must list **exactly** the packages you meant to bump, nothing more.

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
- `<qualifier>` is the tier-1 lockstep version when tier-1 packages bumped (e.g. `2026-04-14 — 0.0.14`). Even when `@llui/effects` / `@llui/mcp` shipped at different numbers on the same day, the tier-1 version is the primary anchor — the full version list goes in the **Released:** line immediately below.
- When only one or two off-cadence packages shipped, use them as the qualifier instead: `2026-04-13 — @llui/effects@0.1.0, @llui/mcp@0.0.7`.
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
4. **Off-cadence packages** — `@llui/effects`, `@llui/mcp`, `@llui/agent`, `llui-agent` after tier-1.
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
pnpm turbo build --force --filter=!@llui/site
pnpm turbo check
pnpm turbo lint
pnpm -r --workspace-concurrency=2 run test
pnpm test:scripts
pnpm smoke:examples
pnpm check:docs
pnpm check:generated
pnpm format:check
```

Turbo caches aggressively, so `--force` on the build is required to actually rebuild with the new `package.json` metadata. If verify fails, stop — something about the version bump broke something; fix it before continuing.

Quick sanity check on the build output:

```bash
pnpm check:dist
```

`scripts/check-dist.mjs` verifies three things about EVERY publishable package's
`dist/`, all of which are invisible in-repo and only bite a consumer who installs
the tarball:

1. **Every relative import carries a `.js` extension.** Node's ESM resolver does
   not guess — an extensionless specifier is a hard `ERR_MODULE_NOT_FOUND`.
   `scripts/add-js-extensions.mjs` adds them post-`tsc`; if that pass breaks,
   nothing else notices. (Broken ESM imports were one of the bugs the 0.0.14
   release shipped a fix for; don't regress it.)
2. **Every sourcemap's `sources` resolve to a file that actually ships.**
3. **No orphaned artifacts** — `tsc` never deletes the output of a REMOVED
   source, so a stale `dist/` ships dead modules. `publish.sh` `rm -rf dist`
   before building, so a tarball is safe either way, but a hit here means your
   local `dist` is stale: clean-rebuild before trusting anything else it says.

It parses with the TypeScript compiler rather than grepping, because this repo's
own compiler sources quote `export { X } from './y'` inside comments and a text
scan reports those as violations — a release gate that cries wolf gets disabled.

**On sourcemaps and `inlineSources`:** these packages deliberately do NOT set it.
`files` already includes `src`, so the `.ts` sources ship verbatim and the maps
point at them relatively (`../../src/signals/mount.ts`) — verified resolving
inside the packed tarball. Embedding them again would duplicate ~340KB per
package for no gain. An earlier version of this step asserted `sourcesContent`
was populated, which could never pass; it only appeared to because it read a
`dist/mount.js.map` path that had not existed for some time and threw first.
Check 2 above is the invariant that actually matters — if someone drops `src`
from `files` or moves `outDir`, every published sourcemap silently resolves to
nothing.

### 8. Commit the release

One commit with all version bumps + the CHANGELOG entry:

```bash
git add packages/*/package.json CHANGELOG.md
git commit -m "$(cat <<'EOF'
release: @llui/{dom,vite-plugin,test,router,transitions,components,vike}@X.Y.Z, @llui/effects@A.B.C, ...

<one-line summary of what this release ships>

<the Co-Authored-By / Codex-Session trailers your harness specifies — don't hard-code a model name here, it goes stale>
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

Print **exactly one** concrete `./scripts/publish.sh` line — never a placeholder, never an "example (full release)" alternative, never a menu of options. The line must contain exactly the directory names of the packages bumped in step 5, in the topological order emitted by `scripts/publish-order.mjs`.

Derive the command from the bumps map written in step 5 — don't hand-type the list, that's how stale package names like `eslint-plugin` survive past their deprecation. Pseudocode:

```
DIRS=$(node -e '
  const bumps = { /* paste from step 5 */ };
  const dirs = Object.keys(bumps).map(p => p.match(/packages\/([^/]+)\//)[1]);
  const wanted = new Set(dirs);
  const { execFileSync } = require("node:child_process");
  const order = execFileSync(process.execPath, ["scripts/publish-order.mjs"], { encoding: "utf8" })
    .trim().split("\n").map((line) => line.split("\t")[0]);
  console.log(order.filter((dir) => wanted.has(dir)).join(" "));
')
```

Then output exactly:

```
Ready to publish. Run:

  ./scripts/publish.sh <DIRS>

The script uses `pnpm publish`, which rewrites workspace:* to concrete versions
at pack time. If a package fails with an auth error, check your npm token in
~/.npmrc or run `pnpm login`.
```

with `<DIRS>` replaced by the derived list. No commentary about "drop X if the script complains," no "example" block, no parenthetical guidance about tier ordering — the list is already correctly ordered. The user asked for the publish line; they get a publish line.

Then stop. The user runs the command when they're ready.

## Reasoning notes

**Why not auto-publish:** npm publishes are irreversible and visible to every downstream consumer. The user explicitly wanted a "give me the final command" flow so they can review the prepared state, the git log, and the CHANGELOG before pulling the trigger. Publishing is the one step where the blast radius justifies manual confirmation even when everything else looks green.

**Why detect releases via `release:` commit instead of git tag:** this repo doesn't create tags for releases. Searching for `release:` commits is the single source of truth for "what's been published." Adding tags just to track releases would duplicate that signal and create a second thing to keep in sync.

**Why force a clean working tree:** the release commit must name exactly what ships on npm. If uncommitted fixes end up in the release commit, the CHANGELOG entry we write will describe commits we didn't actually include (and the reverse — commits we did include won't appear in the notes). Easier to refuse and make the user run `/commit` first than to try to reason about mixed state.

**Why verify peer ranges:** workspace peer specs are rewritten automatically by `pnpm publish`,
but concrete ranges stay exactly as committed. Forgetting one can publish a package that declares
compatibility with an old dependency while building against a new one. Check every in-repo peer,
not only DOM.

**Why singleton packages must be peers, not direct deps:** two physical `@llui/dom` installs split
the module-scoped render context, while two `@llui/interactions` installs split global overlay
ownership. Overrides only hide the packaging error; the peer + dev pattern prevents it. The
anti-pattern check in step 3 enforces both on every release.

**Why pass the commit message via HEREDOC:** multi-line commit messages with `-m "..."` lose formatting. HEREDOC preserves the body exactly, which matters because the brace-expanded `release:` subject can get long and the body typically has a structured one-line summary.
