/**
 * Theme token types — documents the CSS custom properties available
 * in theme.css for TypeScript consumers.
 *
 * Override any token via Tailwind 4 `@theme` in your CSS:
 * ```css
 * @theme {
 *   --color-primary: #8b5cf6;
 *   --radius-lg: 1rem;
 * }
 * ```
 */

export interface ThemeTokens {
  // Surface
  '--color-surface': string
  '--color-surface-muted': string
  '--color-surface-hover': string
  '--color-surface-active': string

  // Border
  '--color-border': string
  '--color-border-hover': string
  '--color-border-focus': string

  // Text
  '--color-text': string
  '--color-text-muted': string
  '--color-text-inverted': string

  // Primary
  '--color-primary': string
  '--color-primary-hover': string
  '--color-primary-active': string

  // Destructive
  '--color-destructive': string
  '--color-destructive-hover': string

  // Radius
  '--radius-sm': string
  '--radius-md': string
  '--radius-lg': string
  '--radius-xl': string

  // Spacing
  '--space-1': string
  '--space-2': string
  '--space-3': string
  '--space-4': string
  '--space-6': string
  '--space-8': string

  // Shadows
  '--shadow-sm': string
  '--shadow-md': string
  '--shadow-lg': string

  // Transitions
  '--duration-fast': string
  '--duration-normal': string

  // Z-index
  '--z-popover': string
  '--z-dialog': string
  '--z-tooltip': string
}

export type ThemeToken = keyof ThemeTokens
