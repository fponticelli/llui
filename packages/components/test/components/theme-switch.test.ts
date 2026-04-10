import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init, update, connect, resolveTheme, applyTheme } from '../../src/components/theme-switch'
import type { ThemeSwitchState, Theme } from '../../src/components/theme-switch'

describe('theme-switch reducer', () => {
  it('initializes with system by default', () => {
    expect(init()).toEqual({ theme: 'system' })
  })

  it('init accepts explicit theme', () => {
    expect(init('dark')).toEqual({ theme: 'dark' })
  })

  it('setTheme updates state', () => {
    const [s] = update(init(), { type: 'setTheme', theme: 'dark' })
    expect(s.theme).toBe('dark')
  })

  it('setTheme is idempotent (same reference)', () => {
    const state: ThemeSwitchState = { theme: 'light' }
    const [next] = update(state, { type: 'setTheme', theme: 'light' })
    expect(next).toBe(state)
  })

  it('toggle cycles light → dark → system → light', () => {
    let s: ThemeSwitchState = { theme: 'light' }
    ;[s] = update(s, { type: 'toggle' })
    expect(s.theme).toBe('dark')
    ;[s] = update(s, { type: 'toggle' })
    expect(s.theme).toBe('system')
    ;[s] = update(s, { type: 'toggle' })
    expect(s.theme).toBe('light')
  })
})

describe('resolveTheme', () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia
    } else {
      delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia
    }
  })

  function mockPrefersDark(matches: boolean): void {
    window.matchMedia = ((query: string) =>
      ({
        matches: query === '(prefers-color-scheme: dark)' && matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia
  }

  it('returns light when theme is light', () => {
    mockPrefersDark(true)
    expect(resolveTheme('light')).toBe('light')
  })

  it('returns dark when theme is dark', () => {
    mockPrefersDark(false)
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('returns dark when system prefers dark', () => {
    mockPrefersDark(true)
    expect(resolveTheme('system')).toBe('dark')
  })

  it('returns light when system prefers light', () => {
    mockPrefersDark(false)
    expect(resolveTheme('system')).toBe('light')
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('sets data-theme="dark" on html when theme is dark', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('sets data-theme="light" on html when theme is light', () => {
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('theme-switch.connect', () => {
  type Ctx = { theme: ThemeSwitchState }

  it('root has data-scope and data-part', () => {
    const parts = connect<Ctx>((s) => s.theme, vi.fn(), { id: 'ts' })
    expect(parts.root['data-scope']).toBe('theme-switch')
    expect(parts.root['data-part']).toBe('root')
  })

  it('root aria-label defaults to Theme', () => {
    const parts = connect<Ctx>((s) => s.theme, vi.fn(), { id: 'ts' })
    expect(parts.root['aria-label']).toBe('Theme')
  })

  it('option returns pressed accessor reflecting current theme', () => {
    const parts = connect<Ctx>((s) => s.theme, vi.fn(), { id: 'ts' })
    const dark = parts.option('dark')
    expect(dark['aria-pressed']({ theme: { theme: 'dark' } })).toBe(true)
    expect(dark['aria-pressed']({ theme: { theme: 'light' } })).toBe(false)
  })

  it('option onClick sends setTheme', () => {
    const send = vi.fn()
    const parts = connect<Ctx>((s) => s.theme, send, { id: 'ts' })
    parts.option('dark').onClick({} as MouseEvent)
    expect(send).toHaveBeenCalledWith({ type: 'setTheme', theme: 'dark' })
  })

  it('toggle part onClick sends toggle', () => {
    const send = vi.fn()
    const parts = connect<Ctx>((s) => s.theme, send, { id: 'ts' })
    parts.toggle.onClick({} as MouseEvent)
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })
})

describe('Theme type', () => {
  it('accepts light, dark, system', () => {
    const themes: Theme[] = ['light', 'dark', 'system']
    expect(themes).toHaveLength(3)
  })
})
