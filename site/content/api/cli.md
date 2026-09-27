---
title: '@llui/cli'
description: '`llui add …` — copy registry components into your LLui app'
---

# @llui/cli

<!-- package-version:start -->

**Current package version:** `0.2.1`

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
| `llui add <item...>` | Copy items and their `registryDependencies`. `--overwrite`, `--force`, `--dry-run`.         |
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
- **`@llui/*` versions are checked before anything is written** — see below.

## `@llui/*` minimum versions

A registry item is written against a specific release of the packages it imports. A
`sonner` skin that uses a token or part attribute an older `@llui/components` lacks
would copy cleanly and then break at runtime, so every item records a minimum for each
`@llui/*` dependency, in shadcn's own `dependencies` spec form:

```json
{ "name": "sonner", "dependencies": ["@llui/dom@^0.14.0", "@llui/components@^0.20.1"] }
```

The minimum is the version of that package the registry was built against — derived
by the registry build, never hand-maintained. The caret is read as a floor only: a
newer install passes even past the caret's upper bound. Non-`@llui` dependencies are
relayed as written.

Before writing any file, `llui add` resolves the project's version of every `@llui/*`
package the requested items need, including those reached only through
`registryDependencies`: first the **installed** `node_modules/<pkg>/package.json`
(looked up from the project directory and each ancestor, as Node resolves an import),
otherwise the **`package.json` range**, compared by the lowest version it allows
(`^0.19.2` counts as 0.19.2) because that is what a fresh install may resolve. A range
with no determinable floor (`latest`, `*`, a git or file spec) produces a warning, not
a failure. Versions are ordered by semver precedence, so `0.21.0-rc.1` does not satisfy
a `0.21.0` minimum.

| Project has                  | Result                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------- |
| the minimum or newer         | copies as usual                                                                   |
| an older version             | exits non-zero, writes nothing, names each package, both versions and the upgrade |
| an older version + `--force` | copies anyway and prints the same report as a warning                             |
| the package not installed    | copies, and the `Install:` line carries the minimum: `@llui/components@^0.20.1`   |

A registry that lists an `@llui/*` package without a minimum is rejected with an error
naming the item.

## Using another registry

The item format is a deliberate subset of shadcn's `registry-item.json`. Point at any
host, a local directory, or a checkout:

```bash
llui add button --registry ./registry
llui add button --registry https://example.com/r
```

A local source may leave file contents on disk (`files[].path`); a remote one must serve
them inlined (`files[].content`). Likewise a local source may declare
`@llui/<pkg>@workspace:^`, resolved from the registry directory's own `node_modules`;
a remote one must serve the built `@llui/<pkg>@^<version>`.

<!-- auto-api:start -->

## Functions

### `add()`

Copy registry items into the project.

Not overwriting by default is the whole safety story of this command: the
point of the registry model is that the copied file becomes the consumer's
source, which they are expected to edit. A second `llui add button` after
those edits must not silently discard them, so an existing file is reported
as skipped and `--overwrite` is the explicit opt-in.

The version pre-flight runs before the first write for the same reason: a
skin built against a newer `@llui/components` copies cleanly and then fails
at runtime, and a half-installed set of files is worse than none. `--force`
is its opt-in, mirroring `--overwrite`.

```typescript
function add(options: AddOptions): Promise<AddResult>
```

### `aliasKeyOf()`

The alias KEY a registry `@/`-import maps to (`@/lib/utils` -> 'lib').

```typescript
function aliasKeyOf(specifier: string): 'ui' | 'lib' | null
```

### `assertDependencySpecs()`

Every `@llui/*` dependency must say which version its item was written
against, as `@llui/<pkg>@^<version>`. A skin that uses something new in
`@llui/components` (a token, a part attribute, a floating CSS variable)
otherwise copies cleanly into a project on an older release and breaks
silently at runtime — which is why `llui add` checks that floor before it
writes anything, and why an item that does not declare one is REJECTED here
rather than waved through unchecked.

The form is shadcn's own: a `dependencies` entry is an npm spec, and
shadcn's CLI passes `name@range` straight to the package manager. Only the
caret-on-a-full-version form is accepted, because it is the only one the
registry build emits and the only one whose floor is unambiguous. `llui add`
reads the caret as a MINIMUM: a newer install passes even past the caret's
upper bound. Non-`@llui` entries are relayed untouched.

`kind` says where the item came from. A `'workspace'` registry — an unbuilt
`registry/registry.json` read from a local path — may instead say
`@llui/<pkg>@workspace:^`, pnpm's protocol for "this workspace's version",
which the loader then resolves exactly as the build does. A `'built'`
registry (anything fetched) must never carry that source form.

```typescript
function assertDependencySpecs(item: RegistryItem, kind: 'built' | 'workspace'): void
```

### `assertSafeTarget()`

A registry target is written INTO a directory the CLI chose, so it must not be
able to escape it. `..` and absolute paths are rejected at LOAD time rather
than at write time: a registry is remote, third-party content, and the write
site is several calls away from the place a reviewer would think to look.

```typescript
function assertSafeTarget(target: string, itemName: string): void
```

### `checkVersions()`

Compare every requirement that carries a minimum against the project.

```typescript
function checkVersions(
  cwd: string,
  requirements: readonly DependencyRequirement[],
): Promise<VersionCheck[]>
```

### `collectDependencies()`

Collect the npm packages the given items need — the union over every
resolved item, so a package reached only through `registryDependencies` is
here too — deduped and sorted by name.

An `@llui/*` package is keyed by NAME and carries the highest minimum any
item declares (the one floor that satisfies all of them). Anything else is
keyed by its whole spec, as before: the CLI relays third-party ranges, it
does not interpret them.

```typescript
function collectDependencies(items: readonly RegistryItem[]): {
  dependencies: DependencyRequirement[]
  devDependencies: DependencyRequirement[]
}
```

### `compareVersions()`

Semver 2.0 precedence: -1 if `a` < `b`, 0 if equal, 1 if `a` > `b`. Build metadata is ignored.

```typescript
function compareVersions(a: string, b: string): -1 | 0 | 1
```

### `findInstalled()`

The installed `name` visible from `fromDir`, walking up the `node_modules`
chain the way Node resolves a bare import. Reads `package.json` directly
rather than `require.resolve`-ing it: a package's `exports` map may not
expose `./package.json`.

```typescript
function findInstalled(
  fromDir: string,
  name: string,
): Promise<{ version: string; packageJson: string } | null>
```

### `formatProductList()`

Render registry discovery without collapsing copied source and package
machines into one misleading "component" list.

Registries without LLui's additive product metadata keep the historical
name/description output, which preserves third-party compatibility.

```typescript
function formatProductList(registry: Registry): string
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

### `minimumOfRange()`

The lowest version a `package.json` dependency range admits, or `null` when
that is not determinable (`*`, `latest`, `>1.2.3`, an upper bound alone, a
git/file/link/URL spec, `workspace:*`).

This is how `llui add` compares a DECLARED-but-not-installed dependency
against a registry minimum: a project whose `package.json` says `^0.19.0`
may resolve 0.19.0 on a fresh install, so 0.19.0 is the version it can
promise. `workspace:` and `npm:<name>@` prefixes are unwrapped; `a || b`
takes the lower of the two floors, and a compound set (`>=1.2.3 <2`) the
highest lower bound in it.

```typescript
function minimumOfRange(range: string): string | null
```

### `parseDependencySpec()`

Split an npm dependency spec (`clsx`, `clsx@^2`, `@llui/dom@^0.14.0`) into its
package name and the range after the `@`, if any. A scoped name's leading `@`
is part of the NAME, so the separator is the first `@` after position 0.

```typescript
function parseDependencySpec(spec: string): { name: string; range: string | null }
```

### `parseVersion()`

Parse a FULL version (`1.2.3`, `1.2.3-rc.1+build`), or `null`.

```typescript
function parseVersion(text: string): Version | null
```

### `projectVersion()`

The project's version of `name`: installed, declared, or missing (see the module doc).

```typescript
function projectVersion(cwd: string, name: string): Promise<ProjectVersion>
```

### `readConfig()`

```typescript
function readConfig(cwd: string): Promise<Config | null>
```

### `resolveCopiedArtifact()`

Resolve an `llui add` name without confusing it with an equal package name.

```typescript
function resolveCopiedArtifact(
  contract: ProductContract,
  target: string,
): ResolvedCopiedArtifact | undefined
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

### `resolveProductIdentity()`

```typescript
function resolveProductIdentity(
  contract: ProductContract,
  name: string,
): ResolvedProductIdentity | undefined
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

### `PresentationCoverage`

```typescript
export type PresentationCoverage =
  | StyledPresentationCoverage
  | PartialPresentationCoverage
  | ComposedPresentationCoverage
  | StylelessPresentationCoverage
  | NotApplicablePresentationCoverage
```

### `PresentationFamily`

```typescript
export type PresentationFamily = (typeof PRESENTATION_FAMILY_VALUES)[number]
```

### `ProductCategory`

```typescript
export type ProductCategory =
  | 'controls'
  | 'forms'
  | 'navigation'
  | 'overlays'
  | 'feedback'
  | 'data-display'
  | 'layout'
  | 'media'
  | 'patterns'
  | 'utilities'
```

### `ProjectVersion`

Where a project's version of a package came from.

```typescript
export type ProjectVersion =
  | { kind: 'installed'; version: string; packageJson: string }
  | { kind: 'declared'; range: string; version: string | null }
  | { kind: 'missing' }
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

### `ResolvedCopiedArtifact`

```typescript
export type ResolvedCopiedArtifact = {
  canonical: ProductEntry
  artifact: Omit<CopiedArtifact, 'displayName' | 'scenarioId'> & {
    displayName: string
    scenarioId: string
  }
  alias?: ProductAlias
}
```

### `ResolvedProductIdentity`

```typescript
export type ResolvedProductIdentity = {
  canonical: ProductEntry
  alias?: ProductAlias
}
```

### `VersionStatus`

```typescript
export type VersionStatus = 'ok' | 'older' | 'missing' | 'unverified'
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
  /**
   * Copy even when an installed `@llui/*` package is older than an item needs.
   * Default false — `add` then throws `VersionMismatchError` before writing.
   * With it, the mismatches are returned in `AddResult.mismatches` instead.
   */
  force?: boolean
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
  /** Every npm package the items need, including via `registryDependencies`. */
  dependencies: DependencyRequirement[]
  devDependencies: DependencyRequirement[]
  /** One check per `@llui/*` requirement, against the project's version. */
  versions: VersionCheck[]
  /** Installed packages older than required. Non-empty only under `force`. */
  mismatches: VersionMismatch[]
  /** Install-command arguments: a bare name when the project already satisfies
   * it, `name@^<min>` when it is missing or too old. */
  install: { dependencies: string[]; devDependencies: string[] }
  /** The command that upgrades every mismatch, or `null` when there are none. */
  upgradeCommand: string | null
}
```

### `ComposedPresentationCoverage`

```typescript
export interface ComposedPresentationCoverage {
  mode: 'composed'
  products: string[]
  rationale: string
}
```

### `CopiedArtifact`

```typescript
export interface CopiedArtifact {
  name: string
  displayName?: string
  artifactKind: 'skin' | 'presentational' | 'pattern'
  styling: StylingSupport
  scenarioId?: string
}
```

### `DependencyRequirement`

One npm package the resolved items need.

```typescript
export interface DependencyRequirement {
  name: string
  /** What to install when the project lacks it (`@llui/dom@^0.14.0`, `clsx`). */
  spec: string
  /** The lowest acceptable version — set for every `@llui/*` package, `null` otherwise. */
  minimum: string | null
  /** The items that declare it, in resolution order. */
  requiredBy: string[]
}
```

### `MachineFree`

```typescript
export interface MachineFree {
  kind: 'none'
  reason: 'presentational' | 'application-owned-state'
}
```

### `NotApplicablePresentationCoverage`

```typescript
export interface NotApplicablePresentationCoverage {
  mode: 'not-applicable'
  rationale: string
}
```

### `PartialPresentationCoverage`

```typescript
export interface PartialPresentationCoverage {
  mode: 'partial'
  rationale: string
}
```

### `ProductAlias`

```typescript
export interface ProductAlias {
  name: string
  canonicalName: string
}
```

### `ProductContract`

Canonical v2 inventory. ProductContract remains the sole product-metadata owner.

```typescript
export interface ProductContract {
  version: 2
  entries: ProductEntry[]
  aliases: ProductAlias[]
}
```

### `ProductEntry`

```typescript
export interface ProductEntry {
  name: string
  displayName: string
  category: ProductCategory
  artifactKind: 'machine' | 'skin' | 'presentational' | 'pattern'
  machine: PublicMachine | MachineFree
  copiedArtifacts: CopiedArtifact[]
  styling: StylingSupport
  presentation: ProductPresentation
  scenarioId: string
}
```

### `ProductPresentation`

```typescript
export interface ProductPresentation {
  family: PresentationFamily
  baseline: PresentationCoverage
  registryTailwind: PresentationCoverage
}
```

### `PublicMachine`

```typescript
export interface PublicMachine {
  kind: 'public'
  importPath: string
}
```

### `StyledPresentationCoverage`

```typescript
export interface StyledPresentationCoverage {
  mode: 'styled'
}
```

### `StylelessPresentationCoverage`

```typescript
export interface StylelessPresentationCoverage {
  mode: 'styleless'
  rationale: string
}
```

### `StylingSupport`

```typescript
export interface StylingSupport {
  baseline: boolean
  registryTailwind: boolean
  styleless: boolean
}
```

### `Version`

The small slice of semver `llui add` needs: parse a version, order two of
them, and find the lowest version a `package.json` range admits.

Hand-written rather than a dependency on purpose — the CLI's only runtime
dependency is zod, and the question it asks is narrow: "is the installed
`@llui/*` package at least as new as the one this registry item was built
against?". That is an ORDERING question (semver 2.0 §11 precedence), not a
range-satisfaction one, so npm's rule that a range excludes prereleases of
other tuples does not apply: `0.21.0-beta.0` installed against a `0.20.1`
floor is newer, and passes.

```typescript
export interface Version {
  major: number
  minor: number
  patch: number
  /** Dot-separated identifiers; numeric ones are numbers. Empty = release. */
  prerelease: (string | number)[]
}
```

### `VersionCheck`

```typescript
export interface VersionCheck {
  name: string
  minimum: string
  requiredBy: string[]
  project: ProjectVersion
  status: VersionStatus
}
```

### `VersionMismatch`

A package the project has, older than the items need.

```typescript
export interface VersionMismatch {
  name: string
  /** The version compared: installed, or the declared range's floor. */
  installed: string
  minimum: string
  requiredBy: string[]
  /** Set when `installed` is a `package.json` range's floor, not an installed package. */
  declared?: string
}
```

## Classes

### `VersionMismatchError`

Thrown by `add()` BEFORE anything is written when an installed `@llui/*`
package is older than an item needs. `--force` turns it into a warning.

```typescript
class VersionMismatchError extends Error {
  mismatches: VersionMismatch[]
  upgradeCommand: string
  constructor(mismatches: VersionMismatch[], upgradeCommand: string)
}
```

## Constants

### `ComposedPresentationCoverageSchema`

The product owns no styling on this path; its presentation is composed from canonical products.

```typescript
const ComposedPresentationCoverageSchema
```

### `CONFIG_FILE`

```typescript
const CONFIG_FILE
```

### `ConfigSchema`

```typescript
const ConfigSchema
```

### `CopiedArtifactSchema`

```typescript
const CopiedArtifactSchema
```

### `DEFAULT_CONFIG`

```typescript
const DEFAULT_CONFIG: Config
```

### `LLUI_SCOPE`

The npm scope whose packages registry items must declare with a minimum.

```typescript
const LLUI_SCOPE
```

### `MachineFreeSchema`

```typescript
const MachineFreeSchema
```

### `NotApplicablePresentationCoverageSchema`

A machine-free canonical product with no public headless artifact.

```typescript
const NotApplicablePresentationCoverageSchema
```

### `PartialPresentationCoverageSchema`

The product directly supplies meaningful styling but names the presentation boundary it leaves open.

```typescript
const PartialPresentationCoverageSchema
```

### `PresentationCoverageSchema`

One path's explicit visual-coverage classification.

```typescript
const PresentationCoverageSchema
```

### `PresentationFamilySchema`

Single-owner visual-language cohort. This is independent of the user-facing product category.
Derived from the one canonical tuple in `product-contract-types.ts` — do not restate the
literals here.

```typescript
const PresentationFamilySchema
```

### `ProductAliasSchema`

```typescript
const ProductAliasSchema
```

### `ProductCategorySchema`

```typescript
const ProductCategorySchema
```

### `ProductContractSchema`

Canonical v2 product inventory, including presentation ownership and validated composition.

```typescript
const ProductContractSchema
```

### `ProductEntrySchema`

```typescript
const ProductEntrySchema
```

### `ProductPresentationSchema`

Canonical family ownership and baseline/registry coverage for one product.

```typescript
const ProductPresentationSchema
```

### `PublicMachineSchema`

```typescript
const PublicMachineSchema
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

### `StyledPresentationCoverageSchema`

The product directly supplies the path's complete default visual treatment.

```typescript
const StyledPresentationCoverageSchema
```

### `StylelessPresentationCoverageSchema`

A public package machine or pattern that remains useful without owned visual treatment.

```typescript
const StylelessPresentationCoverageSchema
```

### `StylingSupportSchema`

```typescript
const StylingSupportSchema
```

### `WORKSPACE_SPEC`

The source-registry spec `scripts/build-registry.mjs` replaces with `^<workspace version>`.

```typescript
const WORKSPACE_SPEC
```

## Public Entry Points

### `@llui/cli/registry`

#### Functions

##### `assertDependencySpecs()` from `@llui/cli/registry`

Every `@llui/*` dependency must say which version its item was written
against, as `@llui/<pkg>@^<version>`. A skin that uses something new in
`@llui/components` (a token, a part attribute, a floating CSS variable)
otherwise copies cleanly into a project on an older release and breaks
silently at runtime — which is why `llui add` checks that floor before it
writes anything, and why an item that does not declare one is REJECTED here
rather than waved through unchecked.

The form is shadcn's own: a `dependencies` entry is an npm spec, and
shadcn's CLI passes `name@range` straight to the package manager. Only the
caret-on-a-full-version form is accepted, because it is the only one the
registry build emits and the only one whose floor is unambiguous. `llui add`
reads the caret as a MINIMUM: a newer install passes even past the caret's
upper bound. Non-`@llui` entries are relayed untouched.

`kind` says where the item came from. A `'workspace'` registry — an unbuilt
`registry/registry.json` read from a local path — may instead say
`@llui/<pkg>@workspace:^`, pnpm's protocol for "this workspace's version",
which the loader then resolves exactly as the build does. A `'built'`
registry (anything fetched) must never carry that source form.

```typescript
function assertDependencySpecs(item: RegistryItem, kind: 'built' | 'workspace'): void
```

##### `assertSafeTarget()` from `@llui/cli/registry`

A registry target is written INTO a directory the CLI chose, so it must not be
able to escape it. `..` and absolute paths are rejected at LOAD time rather
than at write time: a registry is remote, third-party content, and the write
site is several calls away from the place a reviewer would think to look.

```typescript
function assertSafeTarget(target: string, itemName: string): void
```

##### `collectDependencies()` from `@llui/cli/registry`

Collect the npm packages the given items need — the union over every
resolved item, so a package reached only through `registryDependencies` is
here too — deduped and sorted by name.

An `@llui/*` package is keyed by NAME and carries the highest minimum any
item declares (the one floor that satisfies all of them). Anything else is
keyed by its whole spec, as before: the CLI relays third-party ranges, it
does not interpret them.

```typescript
function collectDependencies(items: readonly RegistryItem[]): {
  dependencies: DependencyRequirement[]
  devDependencies: DependencyRequirement[]
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

##### `parseDependencySpec()` from `@llui/cli/registry`

Split an npm dependency spec (`clsx`, `clsx@^2`, `@llui/dom@^0.14.0`) into its
package name and the range after the `@`, if any. A scoped name's leading `@`
is part of the NAME, so the separator is the first `@` after position 0.

```typescript
function parseDependencySpec(spec: string): { name: string; range: string | null }
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

#### Interfaces

##### `DependencyRequirement` from `@llui/cli/registry`

One npm package the resolved items need.

```typescript
export interface DependencyRequirement {
  name: string
  /** What to install when the project lacks it (`@llui/dom@^0.14.0`, `clsx`). */
  spec: string
  /** The lowest acceptable version — set for every `@llui/*` package, `null` otherwise. */
  minimum: string | null
  /** The items that declare it, in resolution order. */
  requiredBy: string[]
}
```

#### Constants

##### `LLUI_SCOPE` from `@llui/cli/registry`

The npm scope whose packages registry items must declare with a minimum.

```typescript
const LLUI_SCOPE
```

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

##### `WORKSPACE_SPEC` from `@llui/cli/registry`

The source-registry spec `scripts/build-registry.mjs` replaces with `^<workspace version>`.

```typescript
const WORKSPACE_SPEC
```

### `@llui/cli/presentation-scenarios`

#### Functions

##### `compileScenarioFamily()` from `@llui/cli/presentation-scenarios`

Join family-owned semantic cases to ProductContract's canonical inventory. `definitions` must
be statically known here — there is no `unknown` fallthrough, so a `Definitions` literal that
fails to satisfy `PresentationScenarioDefinitions` (an extra field on a case, an unknown
`environmentAxes` value, a function in `input`, …) is a COMPILE error, not a value silently
degraded to `CompiledPresentationScenarioFamily`'s erased, `string`-keyed shape. For a
definitions value received from an untyped/serialized boundary, decode it with
`decodeScenarioFamily` instead.

```typescript
function compileScenarioFamily<const Definitions extends PresentationScenarioDefinitions>(
  contract: ProductContract,
  family: PresentationFamily,
  definitions: ExactDefinitions<Definitions>,
): CompiledPresentationScenarioFamily<Definitions>
```

##### `decodeScenarioFamily()` from `@llui/cli/presentation-scenarios`

Validate and compile definitions received from an untyped serialized boundary (a network
response, a `JSON.parse`, a dynamic import, …). Prefer `compileScenarioFamily` whenever the
definitions are a statically-known literal — this is the deliberately erased escape hatch, not
a more permissive alternative to it.

```typescript
function decodeScenarioFamily(
  contract: ProductContract,
  family: PresentationFamily,
  definitions: unknown,
): CompiledPresentationScenarioFamily
```

##### `decodeScenarioSelection()` from `@llui/cli/presentation-scenarios`

Validate and resolve a catalog and selection received from serialized boundaries (a network
response, a `JSON.parse`, a dynamic import, …). Prefer `resolveScenarioSelection` whenever the
catalog is a statically-known compiled result — this is the deliberately erased escape hatch,
not a more permissive alternative to it.

```typescript
function decodeScenarioSelection(
  contract: ProductContract,
  catalog: unknown,
  selection: unknown,
): ResolvedPresentationScenarioSelection
```

##### `resolveScenarioSelection()` from `@llui/cli/presentation-scenarios`

Resolve one deterministic renderer input from a compiled family catalog. `catalog` must be
statically known here — there is no `unknown` fallthrough, so a catalog or selection literal
that fails to satisfy its typed shape is a COMPILE error rather than a value silently accepted
and narrowed away to `string`. For a catalog or selection received from an
untyped/serialized boundary, decode it with `decodeScenarioSelection` instead.

```typescript
function resolveScenarioSelection<Definitions extends PresentationScenarioDefinitions>(
  contract: ProductContract,
  catalog: CompiledPresentationScenarioFamily<Definitions>,
  selection: PresentationScenarioSelection,
): ResolvedPresentationScenarioSelection<Definitions>
```

#### Types

##### `CompiledPresentationScenario` from `@llui/cli/presentation-scenarios`

A definition-keyed discriminated union of compiled ProductContract joins.

```typescript
export type CompiledPresentationScenario<
  Definitions extends PresentationScenarioDefinitions = PresentationScenarioDefinitions,
> =
  string extends ScenarioId<Definitions>
    ? ErasedCompiledPresentationScenario
    : {
        readonly [Id in ScenarioId<Definitions>]: {
          readonly productId: string
          readonly scenarioId: Id
          readonly defaultCaseId: Definitions[Id]['defaultCaseId']
          readonly cases: readonly CompiledPresentationScenarioCase<
            DefinitionCase<Definitions, Id>
          >[]
        }
      }[ScenarioId<Definitions>]
```

##### `CompiledPresentationScenarioCase` from `@llui/cli/presentation-scenarios`

Canonical renderer input copied from a validated family case.

```typescript
export type CompiledPresentationScenarioCase<
  Case extends PresentationScenarioCase = PresentationScenarioCase,
> = Case extends PresentationScenarioCase
  ? {
      readonly id: Case['id']
      readonly label: Case['label']
      readonly input: PresentationScenarioJsonSnapshot<Case['input']>
      readonly environmentAxes: Readonly<Case['environmentAxes']>
      readonly copiedArtifactNames?: Readonly<NonNullable<Case['copiedArtifactNames']>>
    }
  : never
```

##### `CompiledPresentationScenarioFamily` from `@llui/cli/presentation-scenarios`

Deterministic, JSON-safe catalog for one presentation family.

```typescript
export type CompiledPresentationScenarioFamily<
  Definitions extends PresentationScenarioDefinitions = PresentationScenarioDefinitions,
> = {
  readonly version: 1
  readonly family: PresentationFamily
  readonly scenarios: readonly CompiledPresentationScenario<Definitions>[]
}
```

##### `PresentationScenarioDefinitions` from `@llui/cli/presentation-scenarios`

Family-owned definitions keyed by ProductContract `scenarioId`.

```typescript
export type PresentationScenarioDefinitions = Readonly<
  Record<string, PresentationScenarioDefinition>
>
```

##### `PresentationScenarioEnvironment` from `@llui/cli/presentation-scenarios`

Fully resolved environment supplied independently to either renderer path.

```typescript
export type PresentationScenarioEnvironment = {
  readonly [Axis in PresentationScenarioEnvironmentAxis]: (typeof PRESENTATION_SCENARIO_ENVIRONMENT_VALUES)[Axis][number]
}
```

##### `PresentationScenarioEnvironmentAxis` from `@llui/cli/presentation-scenarios`

One environment dimension a case explicitly supports varying.

```typescript
export type PresentationScenarioEnvironmentAxis =
  keyof typeof PRESENTATION_SCENARIO_ENVIRONMENT_VALUES
```

##### `PresentationScenarioErrorCode` from `@llui/cli/presentation-scenarios`

Stable failure categories exposed to gallery routing and build tooling.

```typescript
export type PresentationScenarioErrorCode =
  | 'invalid-definitions'
  | 'unknown-product'
  | 'unknown-case'
  | 'invalid-environment'
  | 'invalid-copied-artifact'
  | 'invalid-catalog'
  | 'invalid-selection'
  | 'invalid-path'
```

##### `PresentationScenarioJson` from `@llui/cli/presentation-scenarios`

Renderer-neutral data accepted as a scenario input.

```typescript
export type PresentationScenarioJson =
  | null
  | boolean
  | number
  | string
  | readonly PresentationScenarioJson[]
  | { readonly [key: string]: PresentationScenarioJson }
```

##### `PresentationScenarioJsonSnapshot` from `@llui/cli/presentation-scenarios`

Recursive readonly shape emitted for a validated JSON input snapshot.

```typescript
export type PresentationScenarioJsonSnapshot<
  Value extends PresentationScenarioJson = PresentationScenarioJson,
> = DeepReadonlyJson<Value>
```

##### `PresentationScenarioPath` from `@llui/cli/presentation-scenarios`

A renderer path whose availability is owned by ProductContract.

```typescript
export type PresentationScenarioPath = (typeof PRESENTATION_SCENARIO_PATHS)[number]
```

##### `ResolvedPresentationScenarioSelection` from `@llui/cli/presentation-scenarios`

Definition-correlated renderer input returned for a presentation selection.

```typescript
export type ResolvedPresentationScenarioSelection<
  Definitions extends PresentationScenarioDefinitions = PresentationScenarioDefinitions,
> = ResolvedScenario<CompiledPresentationScenario<Definitions>>
```

#### Interfaces

##### `PresentationScenarioCase` from `@llui/cli/presentation-scenarios`

One stable, product-local state owned by a presentation family.

```typescript
export interface PresentationScenarioCase<
  Input extends PresentationScenarioJson = PresentationScenarioJson,
> {
  readonly id: string
  readonly label: string
  readonly input: Input
  readonly environmentAxes: readonly PresentationScenarioEnvironmentAxis[]
  /** Registry copied artifacts this case supports; omitted means every owned artifact. */
  readonly copiedArtifactNames?: readonly string[]
}
```

##### `PresentationScenarioDefinition` from `@llui/cli/presentation-scenarios`

All semantic cases declared for one ProductContract scenario identity.

```typescript
export interface PresentationScenarioDefinition<
  Case extends PresentationScenarioCase = PresentationScenarioCase,
> {
  readonly defaultCaseId: string
  readonly cases: readonly Case[]
}
```

##### `PresentationScenarioSelection` from `@llui/cli/presentation-scenarios`

Route-like request for one scenario case, renderer path, and environment.

```typescript
export interface PresentationScenarioSelection {
  readonly productId: string
  readonly caseId?: string
  readonly path: PresentationScenarioPath
  readonly environment?: Partial<PresentationScenarioEnvironment>
  readonly copiedArtifact?: string
}
```

#### Classes

##### `PresentationScenarioError` from `@llui/cli/presentation-scenarios`

A stable, machine-readable protocol or selection failure.

```typescript
class PresentationScenarioError extends Error {
  name
  code: PresentationScenarioErrorCode
  issues: readonly string[]
  constructor(code: PresentationScenarioErrorCode, issues: readonly string[])
}
```

#### Constants

##### `DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT` from `@llui/cli/presentation-scenarios`

Canonical environment used when a selection omits supported overrides.

```typescript
const DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT
```

##### `PRESENTATION_SCENARIO_COMPLEXITY_LIMITS` from `@llui/cli/presentation-scenarios`

Frozen boundary-decoding complexity budget. `familyNodes`/`familyFields`/`familyStringUnits`
meter ONLY case payload content (never protocol scaffolding — see the constants above this
export), summed across one family submission, sized with generous headroom against a
realistic worst case of ~40 products x ~12 cases x a few-hundred-node payload each (see the
sizing-basis constants above this export). `stringLength` and `arrayLength` bound one payload
value at a time and are unaffected by family size. `depth` bounds payload nesting depth to keep
the decoder's explicit stack bounded. `products`, `casesPerProduct`, and `identifierLength`
bound the SEPARATE structural scaffolding dimensions — how many scenarios/cases a family may
declare, and how long a `scenarioId`/`productId`/`family` identifier may be — entirely
independent of the payload budgets, which is what makes a compiled catalog's scaffolding
(absent from raw definitions) cost nothing against them. (`defaultCaseId` is NOT one of these:
its string VALUE is shared, verbatim, between a raw definition and its compiled scenario, so it
is metered payload content like any other case content, bounded by `stringLength`/
`familyStringUnits` above — only the WRAPPER holding it is scaffolding.)

```typescript
const PRESENTATION_SCENARIO_COMPLEXITY_LIMITS
```

##### `PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS` from `@llui/cli/presentation-scenarios`

At most 100 issues (including truncation) and 16,384 UTF-16 units (including paths and separators).

```typescript
const PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS
```

##### `PRESENTATION_SCENARIO_ENVIRONMENT_VALUES` from `@llui/cli/presentation-scenarios`

Stable values accepted by each composable presentation environment axis.

```typescript
const PRESENTATION_SCENARIO_ENVIRONMENT_VALUES
```

##### `PRESENTATION_SCENARIO_PATHS` from `@llui/cli/presentation-scenarios`

Renderer paths joined by the protocol while remaining implementation-isolated.

```typescript
const PRESENTATION_SCENARIO_PATHS
```

<!-- auto-api:end -->
