---
title: Styling & the component registry
description: Theme tokens, the shadcn/ui contract, and copying components into your app with `llui add`.
---

# Styling & the component registry

LLui's components are **headless**: `connect()` returns part bags carrying behaviour,
ARIA and `data-*` state, and **never a `class`**. Everything on this page is additive —
nothing here can change focus handling, dismissal or accessibility.

There are exactly two supported ways to make them look like something. Pick one per
project; they are not meant to be combined.

|           | Baseline stylesheet                           | Registry components                 |
| --------- | --------------------------------------------- | ----------------------------------- |
| You write | `@import '@llui/components/styles/theme.css'` | `llui add button card dialog`       |
| You get   | Every component styled, immediately           | Source files you own and edit       |
| Best for  | Prototypes, internal tools, docs              | Product UI with a design of its own |

## The token contract

Both paths read the same tokens, and they follow **shadcn/ui**: paired surface and
foreground variables, one `--radius` that derives the rest of the scale, oklch values.

```css
@import 'tailwindcss';
@import '@llui/components/styles/theme.css';
@import '@llui/components/styles/theme-dark.css';
```

A shadcn/ui theme — including the output of the community theme generators — pastes
over the `:root` block verbatim. **Its dark half needs one edit**: generator output scopes
everything under `.dark` alone, and nothing in `@llui/components` writes that class, so add
`[data-theme='dark']` to the selector. See [dark-mode overrides](#overriding-a-base-token-in-dark-mode).
Overriding a base token is all you need:

```css
:root {
  --primary: oklch(0.55 0.21 258);
  --primary-foreground: oklch(0.99 0 0);
  --radius: 1rem;
}
```

`--primary-hover`, `--accent-strong`, `--border-hover`, `--destructive-hover` and
`--primary-soft-foreground` are LLui additions for interaction states the baseline
stylesheet needs. Each is a `color-mix()` toward `--foreground`, so the same expression
darkens on a light theme and lightens on a dark one — **do not restate them in a dark
block**, and do not define them at all unless you want a different mix.

Dark mode activates three ways, all at once: `[data-theme='dark']` (what
`@llui/components/theme-switch` writes — **the only one this package ever writes**), a
`.dark` class (the shadcn/ui convention, supported for consumers whose own tooling sets it —
`next-themes`, an SSR-rendered class), and `prefers-color-scheme`. `[data-theme='light']` or
`.light` opts a subtree out.

`applyTheme()` publishes the user's **preference**, so `'system'` REMOVES `data-theme`
rather than resolving `prefers-color-scheme` in JS and pinning the answer — that is the
state the media query exists to answer, it keeps `watchSystemTheme` off the critical path,
and it is the only spelling SSR can render. It deliberately writes **no `.dark` class**
([#242](https://github.com/fponticelli/llui/issues/242)): `.dark` names a _resolved_ theme,
so maintaining it would reintroduce that JS resolve, and a class that goes stale when the OS
flips does not merely fail to help — it suppresses the media query that was correct with no
JS at all. Measured with the preference on `'system'` throughout:

| class on `<html>` | OS light         | OS dark           |
| ----------------- | ---------------- | ----------------- |
| _(none)_          | light ✓          | dark ✓            |
| `.dark` (stale)   | **dark — wrong** | dark ✓            |
| `.light` (stale)  | light ✓          | **light — wrong** |

### Overriding a base token in dark mode

Write your dark override under **both** selectors, and add a twin under the media guard if
you support the `'system'` preference:

```css
.dark,
[data-theme='dark'] {
  --primary: oklch(0.7 0.15 258);
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme='light'])):where(:not(.light)) {
    --primary: oklch(0.7 0.15 258);
  }
}
```

Why each half is needed, measured in real Chromium across all six (preference × OS) cells:

- **`[data-theme='dark']` is what the theme switch writes.** A generator's `.dark`-only
  block matches nothing unless your own code sets that class
  ([#242](https://github.com/fponticelli/llui/issues/242)). One find-and-replace.
- **The twin covers `'system'` on a dark OS.** There the preference writes no attribute and
  this package writes no class, so there is nothing for your selector to match at all —
  no specificity change can repair that cell. The twin's guard is true whenever the
  attribute is absent or `'dark'`, so it covers it.
- The derived `color-mix()` tokens need no twin — they re-resolve from `--foreground` in
  whichever block wins.

> **Fixed in the shipped stylesheet:** the media guard used to be
> `:root:not([data-theme='light']):not(.light)` — specificity **(0,3,0)** — which outranked
> every consumer override of a base token on a dark OS, _including_ `[data-theme='dark']`
> under an explicit `'dark'` preference, where the selector matches perfectly well and still
> lost. It is now `:root:where(:not(…)):where(:not(…))`, which is **(0,1,0)**: it ties with
> `:root`, `.dark` and `[data-theme='dark']`, so a block imported after this stylesheet wins
> on source order ([#241](https://github.com/fponticelli/llui/issues/241)). Note the
> consequence, if you were relying on the old behaviour: a plain `:root` override now leaks
> into dark mode consistently, where before it leaked on a light OS and was overruled on a
> dark one. Override a surface token in the dark block too, not in `:root` alone.

> **Tailwind v4 is required.** The colour tokens are mapped into Tailwind's `--color-*`
> namespace with `@theme inline`, and the radius/shadow/duration/z-index scales come
> from a plain `@theme`. Without a Tailwind v4 pipeline those scales emit nothing.

### Namespace names are not what they look like

If you add your own scale tokens, use Tailwind's real namespace names:

| You want        | Declare                      | Not               |
| --------------- | ---------------------------- | ----------------- |
| `duration-fast` | `--transition-duration-fast` | `--duration-fast` |
| `z-dialog`      | `--z-index-dialog`           | `--z-dialog`      |
| `p-gutter`      | `--spacing-gutter`           | `--space-gutter`  |

The wrong spelling still emits a perfectly good custom property, so `var(--duration-fast)`
in a plain CSS rule works — while the `duration-fast` **class** compiles to nothing. That
asymmetry is why an earlier version of this package shipped 116 dead utility occurrences
across 55 files with a green test suite. Verify a namespace by compiling it.

## Registry components

> **New here?** [Using the components](/components) is the walkthrough — install to a
> styled, state-wired screen, plus the customization levels and the silent traps. It opens
> with [choosing a styling path](/components#choosing-a-styling-path): this registry, or the
> opt-in baseline stylesheet, with the trade-offs of each and why you must import one and not
> both. This page is the reference behind it.

`@llui/cli` copies component source into your project — shadcn's distribution model,
which fits LLui better than it fits React: the copied file is compiled by _your_
`@llui/vite-plugin`, so it gets view lowering, the compile-time lint rules, and the
agent metadata (`$ms` / `$ss` / `__lluiVariants`) that a precompiled library cannot give
you.

```bash
pnpm add -D @llui/cli
pnpm llui init
pnpm llui list
pnpm llui add button card dialog
```

`init` writes `components.json`:

```json
{
  "registry": "https://llui.dev/r",
  "paths": { "ui": "src/components/ui", "lib": "src/lib" }
}
```

Add `"aliases": { "ui": "@/components/ui", "lib": "@/lib" }` if your tsconfig declares
those paths. Without it the CLI emits **relative** imports — an alias your tsconfig does
not declare resolves nowhere, so relative is the default rather than the fallback.

`llui add` never overwrites an existing file. The copied file is your source and is
expected to have been edited; pass `--overwrite` when you really mean it.

### Two things `overlay()` does not give you

Both are invisible while the baseline stylesheet is doing the work, and both bite the
moment you style with utilities:

- **The positioner needs `fixed inset-0` from you.** `overlay()` builds the floating
  wrapper div, but the part bag it spreads carries only `data-*` — nothing positions it.
  Pass it, with the z-index, as `positionerClass`.
- **The backdrop is yours to render**, inside `content()`. The engine does not emit one.
  It sits _inside_ the positioner, so it wants `absolute inset-0`, not `fixed`.

```ts
dialogOverlay({
  state, send, parts,
  positionerClass: 'fixed inset-0 z-dialog grid place-items-center p-4',
  content: () => [DialogBackdrop({ ...parts.backdrop }), DialogContent({ ...parts.content }, [...])],
})
```

### Presentational vs. skin items

- **Presentational** — `button`, `card`, `input`, `textarea`, `label`, `badge`,
  `separator`, `skeleton`, `alert`, `table`. Plain element helpers, no state.
- **Skins** — `switch`, `tabs`, `accordion`, `dialog`, `popover`, `tooltip`. Classes and
  the right tag for `@llui/components` parts. The state machine stays in the package.

A skin is used by spreading the part bag into it:

```ts
const parts = switchConnect(state.at('enabled'), switchSend)
Switch({ ...parts.root }, [SwitchThumb({ ...parts.thumb })])
```

## State-driven styling: use `data-*`

Every part bag already emits `data-state`, `data-disabled`, `data-orientation` and
`data-side`. Write the variant in the recipe:

```ts
'data-[state=open]:bg-muted data-[disabled]:opacity-50'
```

The alternative — reading state in the view to build a class — is a **build error**:

```ts
class: cn('base', state.at('open') && 'is-open') // ✗ operator-on-signal
class: state.at('open').map((open) => cn('base', open && 'is-open')) // ✓ one binding
```

`mergeClass` (in the registry's `lib/utils`) handles the second form for you: pass a
Signal as `class` and it maps rather than stringifying it. `cn()` alone would turn the
handle into `"[object Object]"` — a silently stuck attribute.

Note that `cn` is not `cx` from `@llui/components/styles`. `cx` concatenates, so your
`class: 'p-2'` loses to a recipe's `p-4` by source order; `cn` resolves the conflict,
which is what makes `class` a real override.
