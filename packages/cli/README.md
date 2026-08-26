# @llui/cli

`llui add <item>` — copy registry components into your LLui app.

This is shadcn/ui's distribution model: components are **source you own**, not a
dependency you import. It fits LLui better than it fits React, because the copied file
is compiled by _your_ `@llui/vite-plugin` — so it gets view lowering, the compile-time
lint rules, and the agent metadata (`$ms` / `$ss` / `__lluiVariants`) that a precompiled
library cannot give you.

```bash
pnpm add -D @llui/cli
pnpm llui init
pnpm llui list
pnpm llui add button card dialog
```

## Commands

|                      |                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `llui init`          | Write `components.json`. `--ui`/`--lib` set target dirs, `--alias` sets an import prefix. |
| `llui add <item...>` | Copy items and their `registryDependencies`. `--overwrite`, `--dry-run`.                  |
| `llui list`          | Show what the registry offers.                                                            |

All commands accept `--registry <url|path>` and `--cwd <dir>`.

## `components.json`

```json
{
  "registry": "https://llui.dev/r",
  "paths": { "ui": "src/components/ui", "lib": "src/lib" }
}
```

Add `"aliases": { "ui": "@/components/ui", "lib": "@/lib" }` **only if** your tsconfig
declares those paths. Without it the CLI rewrites the registry's `@/lib/utils` import to
a **relative** specifier computed from where the file landed. That is the default, not a
fallback: an alias the project does not declare produces a file that type-checks
nowhere, which is a worse outcome than a longer path.

## Safety

- **`llui add` never overwrites.** The copied file is your source and is expected to
  have been edited; a second `add` reports it as skipped. `--overwrite` is the opt-in.
- **Registry file targets are validated at load.** A registry is remote third-party
  content, so `..` and absolute paths are rejected before anything is written.
- **Unknown registry keys are ignored**, so a registry that is ahead of your CLI still
  installs rather than failing closed.

## Using a different registry

The registry format is a subset of shadcn's `registry-item.json`. Point at any host, a
local directory, or a checkout:

```bash
llui add button --registry ./registry
llui add button --registry https://example.com/r
```

A local source may leave file contents on disk (`files[].path`); a remote one must serve
them inlined (`files[].content`), which `scripts/build-registry.mjs` produces.
