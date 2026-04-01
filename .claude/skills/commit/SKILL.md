---
description: Update docs, commit, and push the current chunk of work
user_invocable: true
---

# /commit — Commit and push current work

Update documentation if needed, create a git commit, and push to remote.

## Steps

### 1. Update ROADMAP if needed

Read `ROADMAP.md`. If the current changes complete a roadmap item, mark it done with `~~strikethrough~~`. If the changes imply new roadmap items, add them. If no updates are needed, skip this step.

### 2. Update README if needed

Read `README.md`. If the current changes introduce new features, change commands, alter manual verification steps, or modify user-facing behavior that is documented in the README, update it. If no updates are needed, skip this step.

### 3. Git commit

Follow the standard commit flow:

- Run `git status` and `git diff --stat` to see all changes
- Run `git log --oneline -5` to match the commit message style
- Stage all relevant files (do NOT stage `.claude/settings.local.json` or other local-only files)
- Write a concise commit message that focuses on the "why" not the "what"
- Include the Co-Authored-By trailer

### 4. Git push

Push the current branch to the remote with `git push`. If the branch has no upstream, use `git push -u origin <branch>`.
