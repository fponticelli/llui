/**
 * Theme token types — documents the CSS custom properties defined by
 * `styles/theme.css`, which follows the shadcn/ui token contract: paired
 * `--x` / `--x-foreground` surfaces plus `--border` / `--input` / `--ring`,
 * the chart and sidebar scales, and a single `--radius` that derives the rest.
 *
 * A shadcn/ui theme (including the output of the community theme generators)
 * can be pasted over the `:root` / `.dark` blocks of `theme.css` verbatim.
 *
 * Override a token in your own CSS — plain `:root`, no Tailwind needed, because
 * `theme.css` maps them into Tailwind's `--color-*` namespace with `@theme inline`:
 * ```css
 * :root { --primary: oklch(0.55 0.22 264); --radius: 1rem; }
 * ```
 */

/** The base surface/foreground pairs and functional colors — the tokens a
 * shadcn/ui theme defines. Every one is overridable per `.dark` /
 * `[data-theme='dark']` scope. */
export interface ThemeBaseTokens {
  '--background': string
  '--foreground': string
  '--card': string
  '--card-foreground': string
  '--popover': string
  '--popover-foreground': string
  '--primary': string
  '--primary-foreground': string
  '--secondary': string
  '--secondary-foreground': string
  '--muted': string
  '--muted-foreground': string
  '--accent': string
  '--accent-foreground': string
  '--destructive': string
  '--destructive-foreground': string
  '--border': string
  '--input': string
  '--ring': string

  '--chart-1': string
  '--chart-2': string
  '--chart-3': string
  '--chart-4': string
  '--chart-5': string

  '--sidebar': string
  '--sidebar-foreground': string
  '--sidebar-primary': string
  '--sidebar-primary-foreground': string
  '--sidebar-accent': string
  '--sidebar-accent-foreground': string
  '--sidebar-border': string
  '--sidebar-ring': string
}

/** LLui additions: interaction states the baseline stylesheet needs and shadcn
 * expresses per-component. Each is a `color-mix()` over a base token mixed toward
 * `--foreground`, so it tracks light/dark automatically — override a base token
 * and these follow. Defining one explicitly is supported but rarely needed. */
export interface ThemeDerivedTokens {
  '--accent-strong': string
  '--border-hover': string
  '--primary-hover': string
  '--primary-active': string
  '--primary-soft-foreground': string
  '--destructive-hover': string
}

/** Non-colour scales. These live in `theme.css`'s `@theme` block, so each is BOTH
 * a real custom property and a Tailwind utility (`rounded-md`, `shadow-lg`,
 * `duration-fast`, `z-dialog`).
 *
 * The namespace prefixes are load-bearing: Tailwind v4 reads durations from
 * `--transition-duration-*` and z-indexes from `--z-index-*`. Spelling them
 * `--duration-*` / `--z-*` produces valid-looking classes that emit NO CSS. */
export interface ThemeScaleTokens {
  '--radius': string
  '--radius-sm': string
  '--radius-md': string
  '--radius-lg': string
  '--radius-xl': string

  '--shadow-sm': string
  '--shadow-md': string
  '--shadow-lg': string

  '--transition-duration-fast': string
  '--transition-duration-normal': string

  '--z-index-popover': string
  '--z-index-dialog': string
  '--z-index-tooltip': string

  '--spacing-1': string
  '--spacing-2': string
  '--spacing-3': string
  '--spacing-4': string
  '--spacing-6': string
  '--spacing-8': string
}

/** The value-hued categorical chip scale. `--chip-hue` is per-CHIP (set inline
 * from `chipHue(value)`); the other three are the fixed lightness / chroma / mix
 * that make one contrast measurement cover every hue, and overriding them moves
 * the whole scale — including off the AA guarantee, which is measured against
 * the shipped values by `scripts/test/chip-contrast.test.ts`. */
export interface ThemeChipTokens {
  '--chip-lightness': string
  '--chip-chroma': string
  '--chip-mix': string
  '--chip-hue': string
}

export interface ThemeTokens
  extends ThemeBaseTokens, ThemeDerivedTokens, ThemeScaleTokens, ThemeChipTokens {}

export type ThemeToken = keyof ThemeTokens
