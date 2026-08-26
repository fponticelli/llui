---
title: '@llui/cli'
description: '`llui add …` — copy registry components into your LLui app'
---

# @llui/cli

<!-- package-version:start -->

**Current package version:** `0.1.0`

<!-- package-version:end -->

`llui add <item>` copies component **source** into your project — shadcn/ui's
distribution model, applied to [LLui](https://github.com/fponticelli/llui).

The model fits LLui better than it fits React. A copied file is compiled by _your_
`@llui/vite-plugin`, so it gets view lowering, the non-bypassable
[compile-time lint rules](/api/compiler), and the agent metadata (`$ms` / `$ss` /
`__lluiVariants`) that a precompiled library cannot give you. See
[Styling & the component registry](/styling) for the full guide.

```bash
pnpm add -D @llui/cli
pnpm llui init
pnpm llui list
pnpm llui add button card dialog
```

## Commands

| Command              | Does                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `llui init`          | Write `components.json`. `--ui` / `--lib` set target dirs; `--alias` sets an import prefix. |
| `llui add <item...>` | Copy items and their `registryDependencies`. `--overwrite`, `--dry-run`.                    |
| `llui list`          | Show what the registry offers.                                                              |

All commands accept `--registry <url\|path>` and `--cwd <dir>`.

## `components.json`

```json
{
  "registry": "https://llui.dev/r",
  "paths": { "ui": "src/components/ui", "lib": "src/lib" }
}
```

`aliases` is optional and unset by default. Add
`"aliases": { "ui": "@/components/ui", "lib": "@/lib" }` **only if** your tsconfig
declares those paths; otherwise the CLI rewrites the registry's `@/lib/utils` import to a
**relative** specifier computed from where the file landed. That is the default rather
than the fallback: an alias the project does not declare produces a file that
type-checks nowhere, which is a worse failure than a longer path.

## Safety

- **`llui add` never overwrites an existing file.** The copied file is your source and is
  expected to have been edited; a second `add` reports it as skipped. `--overwrite` is
  the explicit opt-in.
- **File targets are validated at load**, not at write. A registry is remote third-party
  content, so `..` and absolute paths are rejected before anything touches the disk.
- **Unknown registry keys are ignored**, so a registry ahead of your CLI still installs
  instead of failing closed.

## Using another registry

The item format is a deliberate subset of shadcn's `registry-item.json`. Point at any
host, a local directory, or a checkout:

```bash
llui add button --registry ./registry
llui add button --registry https://example.com/r
```

A local source may leave file contents on disk (`files[].path`); a remote one must serve
them inlined (`files[].content`).

<!-- auto-api:start -->

## Functions

### `add()`

Copy registry items into the project.

Not overwriting by default is the whole safety story of this command: the
point of the registry model is that the copied file becomes the consumer's
source, which they are expected to edit. A second `llui add button` after
those edits must not silently discard them, so an existing file is reported
as skipped and `--overwrite` is the explicit opt-in.

```typescript
function add(options: AddOptions): Promise<AddResult>
```

### `aliasKeyOf()`

The alias KEY a registry `@/`-import maps to (`@/lib/utils` -> 'lib').

```typescript
function aliasKeyOf(specifier: string): 'ui' | 'lib' | null
```

### `assertSafeTarget()`

A registry target is written INTO a directory the CLI chose, so it must not be
able to escape it. `..` and absolute paths are rejected at LOAD time rather
than at write time: a registry is remote, third-party content, and the write
site is several calls away from the place a reviewer would think to look.

```typescript
function assertSafeTarget(target: string, itemName: string): void
```

### `collectDependencies()`

Collect the npm packages the given items need, deduped and sorted.

```typescript
function collectDependencies(items: readonly RegistryItem[]): {
  dependencies: string[]
  devDependencies: string[]
}
```

### `isRemote()`

```typescript
function isRemote(source: string): boolean
```

### `loadRegistry()`

Load a registry INDEX from an https URL or a local path.

`registry.json` is appended for BOTH — a `registry` setting names the registry,
not one file in it, and the documented default (`https://llui.dev/r`) is a
directory. Appending only for local paths made every remote install 404 on the
default value. A source that already ends in `.json` is taken as-is, so a host
that publishes its index under another name still works.

```typescript
function loadRegistry(source: string): Promise<Registry>
```

### `loadRemoteItem()`

Fetch ONE item's full record, with its file contents inlined.

The index deliberately strips file bodies — `llui list` only needs to name
things, and inlining every component into the index would make the common
case the largest download. So an item resolved from the index carries the file
LIST but no content, and installing it needs this second request. A local
registry needs no equivalent: its `path` still points at a real file on disk.

```typescript
function loadRemoteItem(source: string, name: string): Promise<RegistryItem>
```

### `readConfig()`

```typescript
function readConfig(cwd: string): Promise<Config | null>
```

### `resolveItems()`

Resolve the requested names plus everything they depend on, in dependency-first
order.

Cycles are TOLERATED, not rejected: `visiting` short-circuits a name already on
the stack, so a registry whose items reference each other still installs every
file exactly once instead of recursing forever. A registry author's mistake
should not be a crash in someone else's install.

```typescript
function resolveItems(registry: Registry, names: readonly string[]): RegistryItem[]
```

### `rewriteImports()`

Rewrite the registry's `@/…` imports for one written file.

The registry ships `@/lib/utils` because that is the shadcn convention and
reads the same in every item. What it must become depends on the project:

- `aliases` configured -> `<alias>/utils`, the shadcn behaviour.
- no aliases -> a RELATIVE specifier computed from where this file actually
  landed. An alias the project's tsconfig does not declare produces a file
  that type-checks nowhere, which is a worse failure than a longer path, so
  relative is the default rather than the fallback of last resort.

Extensions: LLui packages are ESM with explicit `.js` specifiers, but a
consumer's bundler resolves extensionless TS imports fine and `@/lib/utils`
is what a shadcn user expects to see. Relative rewrites therefore keep the
project's own convention by emitting no extension either.

```typescript
function rewriteImports(source: string, fileTargetDir: string, config: Config): string
```

### `targetDir()`

Directory on disk for a registry file type (`registry:ui` -> paths.ui).

```typescript
function targetDir(config: Config, type: string): string
```

### `writeConfig()`

```typescript
function writeConfig(cwd: string, config: Config): Promise<string>
```

## Types

### `Config`

```typescript
export type Config = z.infer<typeof ConfigSchema>
```

### `Registry`

```typescript
export type Registry = z.infer<typeof RegistrySchema>
```

### `RegistryFile`

```typescript
export type RegistryFile = z.infer<typeof RegistryFileSchema>
```

### `RegistryItem`

```typescript
export type RegistryItem = z.infer<typeof RegistryItemSchema>
```

## Interfaces

### `AddOptions`

```typescript
export interface AddOptions {
  cwd: string
  config: Config
  names: readonly string[]
  /** Replace files that already exist. Default false — see `AddResult.skipped`. */
  overwrite?: boolean
  /** Resolve and report without touching the filesystem. */
  dryRun?: boolean
}
```

### `AddResult`

```typescript
export interface AddResult {
  written: string[]
  /** Files that already existed and were LEFT ALONE. */
  skipped: string[]
  items: RegistryItem[]
  dependencies: string[]
  devDependencies: string[]
}
```

## Constants

### `CONFIG_FILE`

```typescript
const CONFIG_FILE
```

### `ConfigSchema`

```typescript
const ConfigSchema
```

### `DEFAULT_CONFIG`

```typescript
const DEFAULT_CONFIG: Config
```

### `RegistryFileSchema`

Registry schema — a deliberate subset of shadcn/ui's `registry-item.json`, with
the same field names and semantics so an LLui item is readable by anyone who
has seen a shadcn one (and so a future shadcn-CLI-compatible host stays an
option). Fields shadcn defines that LLui has no use for — `registry:hook`,
`tailwind`, `docs`, `meta` — are simply not modelled; unknown keys are
IGNORED rather than rejected, because a registry is a remote document whose
author may be ahead of this CLI, and failing closed on an unread key would
make every additive registry change a breaking one.

```typescript
const RegistryFileSchema
```

### `RegistryItemSchema`

```typescript
const RegistryItemSchema
```

### `RegistrySchema`

```typescript
const RegistrySchema
```

## Public Entry Points

### `@llui/cli/registry`

#### Functions

##### `assertSafeTarget()` from `@llui/cli/registry`

A registry target is written INTO a directory the CLI chose, so it must not be
able to escape it. `..` and absolute paths are rejected at LOAD time rather
than at write time: a registry is remote, third-party content, and the write
site is several calls away from the place a reviewer would think to look.

```typescript
function assertSafeTarget(target: string, itemName: string): void
```

##### `collectDependencies()` from `@llui/cli/registry`

Collect the npm packages the given items need, deduped and sorted.

```typescript
function collectDependencies(items: readonly RegistryItem[]): {
  dependencies: string[]
  devDependencies: string[]
}
```

##### `isRemote()` from `@llui/cli/registry`

```typescript
function isRemote(source: string): boolean
```

##### `loadRegistry()` from `@llui/cli/registry`

Load a registry INDEX from an https URL or a local path.

`registry.json` is appended for BOTH — a `registry` setting names the registry,
not one file in it, and the documented default (`https://llui.dev/r`) is a
directory. Appending only for local paths made every remote install 404 on the
default value. A source that already ends in `.json` is taken as-is, so a host
that publishes its index under another name still works.

```typescript
function loadRegistry(source: string): Promise<Registry>
```

##### `loadRemoteItem()` from `@llui/cli/registry`

Fetch ONE item's full record, with its file contents inlined.

The index deliberately strips file bodies — `llui list` only needs to name
things, and inlining every component into the index would make the common
case the largest download. So an item resolved from the index carries the file
LIST but no content, and installing it needs this second request. A local
registry needs no equivalent: its `path` still points at a real file on disk.

```typescript
function loadRemoteItem(source: string, name: string): Promise<RegistryItem>
```

##### `resolveItems()` from `@llui/cli/registry`

Resolve the requested names plus everything they depend on, in dependency-first
order.

Cycles are TOLERATED, not rejected: `visiting` short-circuits a name already on
the stack, so a registry whose items reference each other still installs every
file exactly once instead of recursing forever. A registry author's mistake
should not be a crash in someone else's install.

```typescript
function resolveItems(registry: Registry, names: readonly string[]): RegistryItem[]
```

#### Types

##### `Registry` from `@llui/cli/registry`

```typescript
export type Registry = z.infer<typeof RegistrySchema>
```

##### `RegistryFile` from `@llui/cli/registry`

```typescript
export type RegistryFile = z.infer<typeof RegistryFileSchema>
```

##### `RegistryItem` from `@llui/cli/registry`

```typescript
export type RegistryItem = z.infer<typeof RegistryItemSchema>
```

#### Constants

##### `RegistryFileSchema` from `@llui/cli/registry`

Registry schema — a deliberate subset of shadcn/ui's `registry-item.json`, with
the same field names and semantics so an LLui item is readable by anyone who
has seen a shadcn one (and so a future shadcn-CLI-compatible host stays an
option). Fields shadcn defines that LLui has no use for — `registry:hook`,
`tailwind`, `docs`, `meta` — are simply not modelled; unknown keys are
IGNORED rather than rejected, because a registry is a remote document whose
author may be ahead of this CLI, and failing closed on an unread key would
make every additive registry change a breaking one.

```typescript
const RegistryFileSchema
```

##### `RegistryItemSchema` from `@llui/cli/registry`

```typescript
const RegistryItemSchema
```

##### `RegistrySchema` from `@llui/cli/registry`

```typescript
const RegistrySchema
```

<!-- auto-api:end -->
