# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**: the twenty-three `packages/*` are layers of one framework, not independent domains, so there is one glossary and one ADR log at the root.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary of domain terms.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── packages/
```

## How this relates to the docs already in the repo

An ADR complements the existing prose; it does not duplicate it. Know which surface you're on:

- **`CLAUDE.md`** (repo root) — the operating manual for agents: commands, monorepo map, invariants & landmines. Load-bearing rules go here, and a change that violates one is a bug.
- **`site/content/`** — the authoritative user-facing docs, published to [llui.dev](https://llui.dev). Behaviour changes must update these.
- **`docs/proposals/`** — in-flight design work, superseded in places; read for direction, not current state.
- **`docs/adr/`** — the _decision record_: why an alternative was rejected, and under what constraints. Write one when a choice is non-obvious and would otherwise be re-litigated.

`docs/designs/` was **removed** with the pre-signal runtime. Do not reference it.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (…) — but worth reopening because…_
