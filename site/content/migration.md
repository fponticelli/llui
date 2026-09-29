---
title: Migration guide
description: Breaking changes with before/after examples — stylesheet entry points, tokens, component discovery, defaults, demos and scripts.
---

# Migration guide

Each section names what changed, why it breaks, and what to write instead. LLui is pre-1.0,
so a minor release may break; the [changelog](/changelog) records which release shipped each
change.

## Component product contract and styling paths

This section covers the component initiative that made `@llui/components` and the registry
two explicit, documented surfaces
([#261](https://github.com/fponticelli/llui/issues/261)–[#267](https://github.com/fponticelli/llui/issues/267),
[#270](https://github.com/fponticelli/llui/issues/270),
[#273](https://github.com/fponticelli/llui/issues/273)). Items marked **0.20.0** shipped in
`@llui/components@0.20.0`; the rest arrive with the next release.

### Checklist

1. Replace a `theme-dark.css` or `layout.css` import ([stylesheet entry points](#stylesheet-entry-points)).
2. Rename any baseline scale token you override ([tokens](#tokens)).
3. Stop assuming an `llui add` name is an import path ([discovery](#discovery-add-names-are-not-import-paths)).
4. Pass an `id` and place `directionSync` / `exitCompletion` where you use those machines
   ([defaults](#defaults-and-component-apis)).
5. Re-pull copied registry files you have not edited, and diff the ones you have
   ([registry source](#registry-source-you-already-copied)).
6. Update scripts or links that named the old demos ([demos and scripts](#demos-and-scripts)).

### Stylesheet entry points

**`theme-dark.css` is removed (0.20.0).** `theme.css` now includes the dark tokens, so the
second import fails to resolve.

```css
/* before */
@import '@llui/components/styles/theme.css';
@import '@llui/components/styles/theme-dark.css';

/* after */
@import '@llui/components/styles/theme.css';
```

If you imported only the dark half, import `@llui/components/styles/semantic-tokens-dark.css`
instead.

**`layout.css` is removed; `specialized-tools.css` replaces it.** The splitter moved out of
`layout.css`, and the pickers, editors, upload and canvas tools moved out of
`form-controls.css`, into the new `specialized-tools.css`. Only a _modular_ bundle is
affected — `theme.css` already imports the new module.

```css
/* before — a modular bundle */
@import '@llui/components/styles/semantic-tokens.css';
@import '@llui/components/styles/semantic-tokens-dark.css';
@import '@llui/components/styles/foundation.css';
@import '@llui/components/styles/form-controls.css'; /* also styled date-picker, time-picker… */
@import '@llui/components/styles/layout.css';
@import '@llui/components/styles/motion.css';

/* after */
@import '@llui/components/styles/semantic-tokens.css';
@import '@llui/components/styles/semantic-tokens-dark.css';
@import '@llui/components/styles/foundation.css';
@import '@llui/components/styles/form-controls.css';
@import '@llui/components/styles/specialized-tools.css'; /* pickers, splitter, upload, … */
@import '@llui/components/styles/motion.css';
```

[Styling → entry points](/styling#baseline-stylesheet-entry-points) lists every module and the
component scopes each one styles, generated from the stylesheets themselves.

**The optional `tailwindcss` peer dependency is dropped (0.20.0).** The Baseline theme never
needed Tailwind. Keep `tailwindcss` only if you use Registry skins, which need it for their
own build.

**The two styling paths stay separate.** Nothing changed about the rule: import `theme.css`
for the Baseline theme, or `tokens.css` + `tokens-dark.css` in your Tailwind v4 stylesheet for
Registry skins — never both.

### Tokens

**Baseline scales moved out of Tailwind's namespaces (0.20.0).** The shadcn/ui base names
(`--primary`, `--background`, `--radius` and their pairs) are unchanged. The scales the
baseline reads were renamed, because Tailwind's namespaces mean something only inside a
Tailwind build:

| Before                                                                        | After                                                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`                    | `--llui-radius-sm` … `--llui-radius-xl`                                                            |
| `--shadow-2xs`, `--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`    | `--llui-shadow-2xs` … `--llui-shadow-lg`                                                           |
| `--transition-duration-fast`, `--transition-duration-normal`                  | `--llui-duration-fast`, `--llui-duration-normal`                                                   |
| `--z-index-popover`, `--z-index-dialog`, `--z-index-tooltip`                  | `--llui-z-popover`, `--llui-z-dialog`, `--llui-z-tooltip`                                          |
| `--spacing-1` … `--spacing-8`                                                 | `--llui-space-1` … `--llui-space-8`                                                                |
| `--animate-accordion-down`, `--animate-accordion-up`, `--animate-caret-blink` | `--llui-animation-accordion-down`, `--llui-animation-accordion-up`, `--llui-animation-caret-blink` |

```css
/* before */
:root {
  --radius-lg: 1rem;
  --z-index-dialog: 60;
}

/* after — reaches both paths: tailwind.css maps the Tailwind names onto these */
:root {
  --llui-radius-lg: 1rem;
  --llui-z-dialog: 60;
}
```

On the Registry skins path the Tailwind utility names (`rounded-lg`, `z-dialog`, …) still
work; `tailwind.css` maps them onto the `--llui-*` values with `@theme inline`, so override the
`--llui-*` token rather than the Tailwind one.

**Disabled opacity is one token.** Every disabled part in the Baseline theme now reads
`--llui-disabled-opacity` (default `0.5`) instead of a per-family literal. Override it once.
(Registry skins keep shadcn's `disabled:opacity-50` in each recipe.)

**Status tokens.** `--info` and `--success` join `--warning` and `--destructive`, and
`--warning`'s light value darkened so a status glyph clears 3:1. Both toast skins take their
status colours from these tokens, so a theme that restyles status colours now restyles toasts.

### Discovery: add names are not import paths

`llui list` used to print one name and a description per registry item, which read as if every
name were also a package subpath. It now shows the two surfaces side by side:

```text
ADD NAME       PRODUCT      DISPLAY NAME            CATEGORY    ARTIFACT           MACHINE IMPORT                         STYLING MODES
—              accordion    Accordion               controls    machine            @llui/components/accordion             baseline, styleless
accordion      accordion    Accordion               controls    skin               @llui/components/accordion             registry/Tailwind
calendar       date-picker  Calendar / Date Picker  forms       skin               @llui/components/date-picker           registry/Tailwind
dropdown-menu  menu         Dropdown Menu           navigation  alias skin → menu  @llui/components/menu                  registry/Tailwind
form           form-field   Form                    patterns    pattern adapter    @llui/components/patterns/form-field   registry/Tailwind
```

No `llui add` name was renamed or removed, so existing commands keep working. What changed is
that the relationship is now stated, and a few names you might have guessed never existed as
imports:

```ts
// before — guessed from the add name; neither module exists
import { dropdownMenu } from '@llui/components/dropdown-menu'
import { formField } from '@llui/components/form' // a different machine

// after — the machine each copied skin spreads
import { menu } from '@llui/components/menu'
import { formField } from '@llui/components/patterns/form-field'
```

These add names are aliases of a canonical component (generated from the product contract):

<!-- product-contract:aliases:start — generated by site/src/generate-component-docs.ts; do not edit -->

| `llui add` alias | Installs        | Canonical component           | Headless import                                                                                | Gallery                                                                              |
| ---------------- | --------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `breadcrumb`     | skin            | Breadcrumbs (`breadcrumbs`)   | [`@llui/components/breadcrumbs`](/api/components#lluicomponentsbreadcrumbs)                    | [open](/apps/component-gallery/?entry=breadcrumbs&path=registry&artifact=breadcrumb) |
| `command`        | pattern adapter | Command Menu (`command-menu`) | [`@llui/components/patterns/command-menu`](/api/components#lluicomponentspatternscommand-menu) | [open](/apps/component-gallery/?entry=command-menu&path=registry&artifact=command)   |
| `dropdown-menu`  | skin            | Menu (`menu`)                 | [`@llui/components/menu`](/api/components#lluicomponentsmenu)                                  | [open](/apps/component-gallery/?entry=menu&path=registry&artifact=dropdown-menu)     |
| `input-otp`      | skin            | Pin Input (`pin-input`)       | [`@llui/components/pin-input`](/api/components#lluicomponentspin-input)                        | [open](/apps/component-gallery/?entry=pin-input&path=registry&artifact=input-otp)    |
| `resizable`      | skin            | Splitter (`splitter`)         | [`@llui/components/splitter`](/api/components#lluicomponentssplitter)                          | [open](/apps/component-gallery/?entry=splitter&path=registry&artifact=resizable)     |
| `sonner`         | skin            | Toast (`toast`)               | [`@llui/components/toast`](/api/components#lluicomponentstoast)                                | [open](/apps/component-gallery/?entry=toast&path=registry&artifact=sonner)           |

```bash
llui add breadcrumb     # copies the Breadcrumbs skin; its machine is @llui/components/breadcrumbs
llui add command        # copies the Command Menu pattern adapter; its machine is @llui/components/patterns/command-menu
llui add dropdown-menu  # copies the Menu skin; its machine is @llui/components/menu
llui add input-otp      # copies the Pin Input skin; its machine is @llui/components/pin-input
llui add resizable      # copies the Splitter skin; its machine is @llui/components/splitter
llui add sonner         # copies the Toast skin; its machine is @llui/components/toast
```

<!-- product-contract:aliases:end -->

The [component catalog](/component-catalog) lists every other difference — extra copied
variants, pattern adapters, and machines with nothing to copy.

### Defaults and component APIs

**Automatic direction needs an `id` and a placed `directionSync`.** `tabs`, `carousel`,
`pagination`, `navigation-menu`, `menu`, `context-menu` and `menubar` follow the page's `dir`
by observing their own root after mount. That observation is a `Mountable`; until you place it,
the component stays `'ltr'` whatever the page says, with no warning.

```ts
// before
const t = tabs.connect(state.at('tabs'), send)
div({ ...t.root }, [div({ ...t.list }, triggers)])

// after
const t = tabs.connect(state.at('tabs'), send, { id: 'settings-tabs' })
div({ ...t.root }, [t.directionSync, div({ ...t.list }, triggers)])
```

`menu.floatingDir` is removed (placement reads `state.dir`), a menu's `dir` is never `null`,
and `ContextMenuParts.trigger` and `MenubarParts.root` gained a required `id`.

**Submenus get real positioning.** A hand-rolled submenu block still works, but renders pinned
to its container's top-left corner. Render each submenu with `subOverlay` instead, which
floats it beside its trigger and flips at the viewport edge.

```ts
// before
show(
  openPath.map((p) => p.includes(item.value)),
  () => [
    div({ ...parts.subPositioner(item.value) }, [
      div({ ...parts.subContent(item.value) }, children),
    ]),
  ],
)

// after
menu.subOverlay({
  value: item.value,
  state,
  parts,
  content: () => [div({ ...parts.subContent(item.value) }, children)],
})
```

**Animated accordion and collapsible exits are opt-in, and the registry root takes the
watcher.** `init({ animated: true })` keeps closing content mounted until its animation ends.
The copied `Accordion` / `Collapsible` roots now take a required third argument:

```ts
// before
Accordion({ ...parts.root }, items)

// after
Accordion({ ...parts.root }, items, { exitCompletion: parts.exitCompletion })
```

**Toasts.**

```ts
// before
if (toast.paused) showPausedBadge()
Sonner({ ...t.root, variant: 'success' }, children)

// after
if (isPaused(toast)) showPausedBadge() // `pausedBy` holds the reasons
Sonner({ ...t.root }, children) // the colour follows the machine's data-type
```

`toast.update`'s patch is narrowed to presentation fields (`type`, `title`, `description`,
`duration`, `dismissable`, `ariaLive`); `id`, `remainingMs`, `status` and `pausedBy` are
reducer-owned. A toast part's `role`, `aria-live` and `data-type` are signals now, so patching
`type` on a mounted toast also updates what it announces.

**A two-phase overlay must keep its floating attachment.** `createOverlay` throws a
`LluiFrameworkError` when `floating` and `visibleWhen` are combined without
`floating.persistent: true`:

```ts
// before — silently re-attached mid exit animation
createOverlay({ floating: { placement: 'bottom-start' }, visibleWhen, ...rest })

// after
createOverlay({ floating: { placement: 'bottom-start', persistent: true }, visibleWhen, ...rest })
```

**Smaller changes.**

- `rating-group`'s `clickItem` / `hoverItem` renamed `isLeftHalf` to `isStartHalf` (0.20.0),
  and `slider` mirrors under `dir="rtl"`.
- `table`'s `row(id, index)`, `cell(rowIndex, colIndex)` and `rowCheckbox(id, index)` accept the
  row's index signal; the returned `aria-rowindex` / `data-row-index` are always signals. Pass
  the index `each` gives you instead of `.peek()`-ing it, or the row freezes at its first
  position after a reorder.
- `combobox` / `searchableSelect`: `loadSuccess` replaces the whole list, and omitting
  `groups` resets them.
- The baseline `foundation.css` no longer sets `direction: inherit` on parts, so a `dir` on a
  portaled positioner is respected.

The [`@llui/components` README](https://github.com/fponticelli/llui/blob/main/packages/components/README.md)
carries the full notes for each machine.

### Registry source you already copied

`llui add` never overwrites, so files you copied before this release keep their old recipes:
without the logical (RTL) utilities, the forced-colors variants, the 24px pointer targets on
small controls, and the recipe changes above. Re-pull a file you have not edited; for one you
have, compare first:

```bash
pnpm llui add switch --dry-run          # shows what would be written
pnpm llui add switch --overwrite        # replaces your copy
```

**`llui add` checks `@llui/*` versions before writing (#273).** Every registry item records
the minimum version of each `@llui/*` package it needs. An older installed version stops the
command with the upgrade to run; `--force` copies anyway and prints the mismatch as a warning.

```text
These registry items need newer @llui packages than this project has:
  @llui/components: installed 0.19.0, requires >= 0.20.1 (sonner)
Upgrade: pnpm add @llui/components@^0.20.1
Nothing was written. Pass --force to copy the files anyway.
```

### Demos and scripts

The [Component Gallery](/apps/component-gallery/) is the component inventory: it renders
every component, with deterministic scenarios, on both paths, and the
[component catalog](/component-catalog) links each component to its gallery page. The two
hand-written showcase apps are gone from that role:

| Before                                                                | Now                                                                                                                                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Components Demo" (`examples/components-demo`)                        | **Removed.** The Gallery's Baseline theme document shows every component on that path. `/examples/components-demo` and its `@llui/example-components-demo` package no longer exist.      |
| "Registry Demo" (`examples/registry-demo`, `/examples/registry-demo`) | **A test fixture, not a showcase.** It keeps the source `llui add` copied, so the repository can check that copy stays in sync with the registry. It is no longer published on the site. |

New root scripts in the LLui repository:

```bash
pnpm gallery            # the gallery shell with both path documents
pnpm gallery:baseline   # the Baseline theme document alone
pnpm gallery:registry   # the Registry skins document alone
pnpm gallery:build      # all three builds
```

`pnpm check:registry` now delegates to the registry package's own `check`, which also
type-checks `registry/test/`.

### New, additive

- `@llui/cli/presentation-scenarios` — the browser-safe scenario protocol the gallery and
  visual tests compile against the product contract.
- `@llui/cli/gallery` — the gallery's URL contract (`galleryHref`, `parseGalleryQuery`). Build
  gallery links with it rather than by hand.
