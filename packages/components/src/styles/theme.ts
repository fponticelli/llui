/**
 * Theme token types — documents the CSS custom properties defined by
 * `styles/theme.css`, which follows the shadcn/ui token contract: paired
 * `--x` / `--x-foreground` surfaces plus `--border` / `--input` / `--ring`,
 * the chart and sidebar scales, and a single `--radius` that derives the rest.
 *
 * A shadcn/ui theme (including the output of community theme generators) can
 * replace the base `:root` / `.dark` values. The baseline reads these semantic
 * tokens directly; `styles/tailwind.css` maps the same values independently for
 * copied Tailwind v4 registry skins.
 *
 * Override a token in your own CSS — plain `:root`, no Tailwind needed:
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

/** Shared non-colour semantic scales and baseline state conventions. The
 * `--llui-*` names are ordinary custom properties used by baseline family
 * modules. The independent Tailwind entry maps the applicable radius, shadow,
 * duration, z-index, and animation scales to utility namespaces without
 * duplicating their values. */
export interface ThemeScaleTokens {
  '--radius': string
  '--llui-radius-sm': string
  '--llui-radius-md': string
  '--llui-radius-lg': string
  '--llui-radius-xl': string

  '--llui-shadow-2xs': string
  '--llui-shadow-xs': string
  '--llui-shadow-sm': string
  '--llui-shadow-md': string
  '--llui-shadow-lg': string

  '--llui-duration-fast': string
  '--llui-duration-normal': string

  '--llui-z-popover': string
  '--llui-z-dialog': string
  '--llui-z-tooltip': string

  '--llui-space-1': string
  '--llui-space-2': string
  '--llui-space-3': string
  '--llui-space-4': string
  '--llui-space-6': string
  '--llui-space-8': string

  '--llui-animation-accordion-down': string
  '--llui-animation-accordion-up': string
  '--llui-animation-caret-blink': string

  '--llui-focus-ring-width': string
  '--llui-focus-ring-offset': string
  '--llui-disabled-opacity': string
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
