import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'

/**
 * Theme Switch — light/dark/system theme toggle.
 *
 * State machine tracks the user's explicit preference (`light`, `dark`, or
 * `system`). `applyTheme()` publishes that PREFERENCE on `<html>` — writing
 * `data-theme` for an explicit choice and REMOVING it for `'system'`, which is
 * the state `tokens-dark.css`'s `prefers-color-scheme` block answers in pure
 * CSS. Do not resolve `'system'` in JS just to honour the OS setting: that
 * costs a flash of the wrong palette and makes `watchSystemTheme` mandatory.
 *
 * Typically wired via `onMount` or in app init:
 * ```ts
 * onMount(() => {
 *   applyTheme(state.theme.theme)
 * })
 * ```
 *
 * `resolveTheme()` and `watchSystemTheme()` remain for consumers who need the
 * resolved value IN JS — canvas theming, a `<meta name="theme-color">` — but
 * they are no longer on the critical path for merely following the OS.
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
 * Publish the user's PREFERENCE on `<html>`: `data-theme="light"` / `"dark"`
 * for an explicit choice, and the attribute REMOVED for `'system'`.
 *
 * Removing it is not "doing nothing" — it is how `'system'` is spelled, and
 * `tokens-dark.css` answers all three states from that one attribute:
 *
 * ```css
 * @media (prefers-color-scheme: dark) {
 *   :root:not([data-theme='light']):not(.light) { … }   // absent  -> follow OS
 * }
 * .dark,
 * [data-theme='dark'] { … }                             // "dark"   -> dark
 * ```
 *
 * with `:root` in `tokens.css` as the light default. So an absent attribute
 * follows the OS in CSS, and `data-theme="light"` opts a subtree back out of
 * the media query.
 *
 * This takes a {@link Theme}, not a {@link ResolvedTheme}, deliberately (#233).
 * Resolving `'system'` in JS and pinning the answer is strictly worse than
 * leaving it to CSS: first paint uses the media query and JS then writes an
 * attribute that may disagree (a flash of the wrong palette), `watchSystemTheme`
 * becomes mandatory to track OS changes CSS would have followed for free, and
 * SSR has no correct attribute to render. Use `resolveTheme()` only when you
 * genuinely need the resolved value IN JS — canvas theming, a
 * `<meta name="theme-color">` — never merely to honour the OS setting.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
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

export interface ThemeSwitchParts {
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
    'aria-pressed': Signal<boolean>
    'aria-label': string
    onClick: (e: MouseEvent) => void
  }
  toggle: {
    type: 'button'
    'data-scope': 'theme-switch'
    'data-part': 'toggle'
    'data-theme': Signal<Theme>
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

export function connect(
  state: Signal<ThemeSwitchState>,
  send: Send<ThemeSwitchMsg>,
  opts: ConnectOptions,
): ThemeSwitchParts {
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
      'aria-pressed': state.map((s) => s.theme === theme),
      'aria-label': LABELS[theme],
      onClick: tagSend(send, ['setTheme'], () => send({ type: 'setTheme', theme })),
    }),
    toggle: {
      type: 'button',
      'data-scope': 'theme-switch',
      'data-part': 'toggle',
      'data-theme': state.map((s) => s.theme),
      'aria-label': 'Toggle theme',
      onClick: tagSend(send, ['toggle'], () => send({ type: 'toggle' })),
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
