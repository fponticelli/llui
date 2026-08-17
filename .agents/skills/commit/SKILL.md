---
description: Update docs, commit, and push the current chunk of work
user_invocable: true
---

# /commit — Commit and push current work

Update documentation if needed, create a git commit, and push to remote.

## Steps

### 1. Update user-facing docs if needed

Read `README.md`, the root `CHANGELOG.md` Unreleased section, and the relevant pages under
`site/content/`. If the current changes introduce features, change commands, alter manual
verification, or modify user-facing behavior, update every affected surface. The site changelog
is a symlink to the root changelog; never replace it with a second copy. Run `pnpm check:docs`
and `pnpm check:generated` after documentation changes.

### 2. Verify

Run the checks proportionate to the change. For a repository-wide chunk, use `pnpm verify`.
Remember that CI builds with `--filter=!@llui/site` but runs `check` and `lint` unfiltered.
Do not weaken or bypass failures.

### 3. Git commit

Follow the standard commit flow:

- Run `git status` and `git diff --stat` to see all changes
- Run `git log --oneline -5` to match the commit message style
- Stage all relevant files (do NOT stage `.codex/settings.local.json`,
  `.claude/settings.local.json`, or other local-only files)
- Write a concise commit message that focuses on the "why" not the "what"
- Include the Co-Authored-By trailer

Never run `git stash` in this repository. Let the shared pre-commit lock run normally; never set
`SKIP_SIMPLE_GIT_HOOKS=1`, which bypasses both serialization and the formatting gate.

### 4. Git push

Push the current branch to the remote with `git push`. If the branch has no upstream, use `git push -u origin <branch>`.
