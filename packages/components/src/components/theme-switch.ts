import type { Send } from '@llui/dom'

/**
 * Theme Switch — light/dark/system theme toggle.
 *
 * State machine tracks the user's explicit preference (`light`, `dark`, or
 * `system`). Use `resolveTheme()` to compute the effective theme (reading
 * `prefers-color-scheme` when `system`), and `applyTheme()` to set
 * `data-theme` on `<html>` so CSS selectors like `[data-theme='dark']` work.
 *
 * Typically wired via `onMount` or in app init:
 * ```ts
 * onMount(() => {
 *   applyTheme(resolveTheme(state.theme.theme))
 * })
 * ```
 *
 * For persistence, the app reducer reads/writes `localStorage.theme` in its
 * `init`/`update` — the state machine itself is storage-agnostic.
 */

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeSwitchState {
  theme: Theme
}

export type ThemeSwitchMsg = { type: 'setTheme'; theme: Theme } | { type: 'toggle' }

export function init(theme: Theme = 'system'): ThemeSwitchState {
  return { theme }
}

export function update(state: ThemeSwitchState, msg: ThemeSwitchMsg): [ThemeSwitchState, never[]] {
  switch (msg.type) {
    case 'setTheme':
      if (state.theme === msg.theme) return [state, []]
      return [{ theme: msg.theme }, []]
    case 'toggle': {
      // light → dark → system → light
      const next: Theme =
        state.theme === 'light' ? 'dark' : state.theme === 'dark' ? 'system' : 'light'
      return [{ theme: next }, []]
    }
  }
}

/**
 * Resolve a theme preference to the actual theme to apply. Returns 'dark' or
 * 'light' based on the user's setting, consulting `prefers-color-scheme` for
 * 'system'.
 */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'dark') return 'dark'
  if (theme === 'light') return 'light'
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

/**
 * Set `data-theme="light"` or `data-theme="dark"` on `<html>`. CSS selectors
 * like `[data-theme='dark'] { ... }` will then take effect.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolved
}

/**
 * Listen for system theme changes (when user has selected 'system'). Returns
 * a cleanup function. Call this in `onMount` and dispatch `setTheme` on
 * change if you want the UI to auto-follow OS settings.
 */
export function watchSystemTheme(callback: (theme: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e: MediaQueryListEvent): void => {
    callback(e.matches ? 'dark' : 'light')
  }
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}

export interface ThemeSwitchParts<S> {
  root: {
    'data-scope': 'theme-switch'
    'data-part': 'root'
    role: 'group'
    'aria-label': string
  }
  option: (theme: Theme) => {
    type: 'button'
    'data-scope': 'theme-switch'
    'data-part': 'option'
    'data-theme': Theme
    'aria-pressed': (s: S) => boolean
    'aria-label': string
    onClick: (e: MouseEvent) => void
  }
  toggle: {
    type: 'button'
    'data-scope': 'theme-switch'
    'data-part': 'toggle'
    'data-theme': (s: S) => Theme
    'aria-label': string
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  id: string
  /** Accessible label for the theme group (default: 'Theme'). */
  label?: string
}

const LABELS: Record<Theme, string> = {
  light: 'Light theme',
  dark: 'Dark theme',
  system: 'Use system theme',
}

export function connect<S>(
  get: (s: S) => ThemeSwitchState,
  send: Send<ThemeSwitchMsg>,
  opts: ConnectOptions,
): ThemeSwitchParts<S> {
  const label = opts.label ?? 'Theme'
  return {
    root: {
      'data-scope': 'theme-switch',
      'data-part': 'root',
      role: 'group',
      'aria-label': label,
    },
    option: (theme) => ({
      type: 'button',
      'data-scope': 'theme-switch',
      'data-part': 'option',
      'data-theme': theme,
      'aria-pressed': (s) => get(s).theme === theme,
      'aria-label': LABELS[theme],
      onClick: () => send({ type: 'setTheme', theme }),
    }),
    toggle: {
      type: 'button',
      'data-scope': 'theme-switch',
      'data-part': 'toggle',
      'data-theme': (s) => get(s).theme,
      'aria-label': 'Toggle theme',
      onClick: () => send({ type: 'toggle' }),
    },
  }
}

export const themeSwitch = {
  init,
  update,
  connect,
  resolveTheme,
  applyTheme,
  watchSystemTheme,
}
