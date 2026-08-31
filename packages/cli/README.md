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

Then import the **tokens** in your app CSS — not `styles/theme.css`:

```css
@import 'tailwindcss';
@import '@llui/components/styles/tokens.css';
@import '@llui/components/styles/tokens-dark.css';
```

`theme.css` is the opt-in baseline stylesheet. Its `[data-scope][data-part]` rules are
unlayered, and unlayered CSS beats `@layer utilities` — importing it alongside registry
components makes every one of their classes lose, with nothing to tell you.

## Commands

|                      |                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `llui init`          | Write `components.json`. `--ui`/`--lib` set target dirs, `--alias` sets an import prefix. |
| `llui add <item...>` | Copy items and their `registryDependencies`. `--overwrite`, `--dry-run`.                  |
| `llui list`          | Show copied artifacts beside their related public machine imports and styling modes.      |

All commands accept `--registry <url|path>` and `--cwd <dir>`.

`llui add` and `@llui/components/*` are deliberately different surfaces. `add` copies a
registry/Tailwind skin, pattern or presentational component into your app; a package
subpath imports a headless state machine. Run `llui list` to see the relationship instead
of guessing from a shared name. It labels machine-only products, machine-backed skins,
patterns, presentational items, intentional application-owned-state skins and direct
aliases. A dash in the **ADD NAME** or **MACHINE IMPORT** column means that artifact has no
equivalent on that surface.

Every copied row is resolved from its own typed artifact record, rather than borrowing a
machine's title or kind. That keeps variant installs such as `calendar`/`date-picker` and
`drawer`/`sheet` distinct, and labels aliases by the copied artifact they actually install
(`alias pattern`, `alias skin` or `alias presentational`).

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
