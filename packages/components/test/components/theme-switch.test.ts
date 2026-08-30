import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init, update, connect, resolveTheme, applyTheme } from '../../src/components/theme-switch'
import type { ThemeSwitchState, Theme } from '../../src/components/theme-switch'
import { rootSignal, read } from '../_signal'

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

/**
 * #233: `applyTheme` used to take a RESOLVED theme and always write the
 * attribute, so a consumer on `'system'` had to resolve in JS and pin an
 * answer. It takes the full `Theme` and publishes the PREFERENCE: the
 * attribute for an explicit choice, and its ABSENCE for `'system'` — which is
 * the state `tokens-dark.css`'s `prefers-color-scheme` block already answers:
 *
 *   @media (prefers-color-scheme: dark) {
 *     :root:where(:not([data-theme='light'])):where(:not(.light)) { … }
 *   }
 *   .dark, [data-theme='dark'] { … }
 */
describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
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

  it('REMOVES a previously-set data-theme when theme is system', () => {
    // Not merely "does not add one": a control starts on light or dark far more
    // often than it starts on system, so the transition INTO system is the case
    // that matters. Leaving a stale `data-theme="dark"` behind pins the palette
    // against the OS with the state machine reading 'system'.
    applyTheme('dark')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(true)
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('adds no data-theme when system is applied to a clean document', () => {
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('round-trips all three preferences', () => {
    const attr = (): string | null => document.documentElement.getAttribute('data-theme')
    const seen: Array<string | null> = []
    for (const t of ['light', 'dark', 'system', 'dark', 'light', 'system'] as Theme[]) {
      applyTheme(t)
      seen.push(attr())
    }
    expect(seen).toEqual(['light', 'dark', null, 'dark', 'light', null])
  })

  it('does NOT consult matchMedia — system is answered by CSS, not by a JS resolve', () => {
    // The whole point of #233: honouring the OS setting must not require
    // reading `prefers-color-scheme` in JS, which is what made
    // `watchSystemTheme` mandatory and left SSR nothing correct to render.
    const spy = vi.fn(() => {
      throw new Error('applyTheme must not read matchMedia')
    })
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'matchMedia', { value: spy, configurable: true })
    try {
      applyTheme('system')
      applyTheme('dark')
      applyTheme('light')
    } finally {
      if (original) Object.defineProperty(window, 'matchMedia', original)
      else delete (window as { matchMedia?: unknown }).matchMedia
    }
    expect(spy).not.toHaveBeenCalled()
  })
})

/**
 * `applyTheme`'s contract is only half the fix — the other half lives in CSS,
 * and the two are one fact stated in two files. If the dark stylesheet ever
 * stops answering the absent-attribute case, `'system'` silently pins light on
 * a dark OS with nothing failing: the class of bug `registry-attrs.test.ts`
 * exists to catch, one layer down. So read the SELECTORS out of the shipped
 * stylesheet and run them against a real element in each of the three states.
 */
describe('applyTheme pairs with the selectors tokens-dark.css actually ships', () => {
  const css = readFileSync(
    resolve(import.meta.dirname, '../../src/styles/tokens-dark.css'),
    'utf8',
    // Both blocks carry prose ABOUT their own selectors, so a match run over the
    // raw text captures the comment as part of the selector.
  ).replace(/\/\*[\s\S]*?\*\//g, '')

  /** The guard inside `@media (prefers-color-scheme: dark)` — the branch an
   * absent `data-theme` is meant to fall into. */
  const mediaSelector = css
    .match(/@media \(prefers-color-scheme: dark\) \{\s*([^{}]+?)\s*\{/)?.[1]
    ?.trim()
  /** The explicit-dark selector list outside any media query. */
  const explicitSelector = css.match(/\n(\.dark,\n\[data-theme='dark'\]) \{/)?.[1]

  it('ships both selectors (a rename here is a silent theme break)', () => {
    expect(mediaSelector).toBe(":root:where(:not([data-theme='light'])):where(:not(.light))")
    expect(explicitSelector).toBe(".dark,\n[data-theme='dark']")
  })

  function stateOf(theme: Theme): { media: boolean; explicit: boolean } {
    applyTheme(theme)
    const html = document.documentElement
    return {
      media: html.matches(mediaSelector as string),
      explicit: html.matches((explicitSelector as string).replace(/\n/g, ' ')),
    }
  }

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it("'system' falls into the media branch, so the OS answers it", () => {
    // Matching the media guard means: dark when the OS is dark, and the
    // `:root` light default when it is not — with no JS resolve.
    expect(stateOf('system')).toEqual({ media: true, explicit: false })
  })

  it("'dark' matches the explicit block in BOTH OS settings", () => {
    expect(stateOf('dark')).toEqual({ media: true, explicit: true })
  })

  it("'light' is excluded from the media branch, so it opts OUT of a dark OS", () => {
    // This is the cell that would break if the guard were written
    // `:root:not([data-theme])` instead: a light preference on a dark OS.
    expect(stateOf('light')).toEqual({ media: false, explicit: false })
  })

  /**
   * #241 LANDED, and this assertion replaces the forward guard that used to sit
   * here demanding the guard NOT contain `:where(`. That guard did its job: it
   * failed on the change and forced the specificity prose in `applyTheme` and
   * `site/content/styling.md` to be re-read and rewritten.
   *
   * What is pinned now is the property, not the spelling. The guard is `:where()`
   * -wrapped so it is (0,1,0) rather than (0,3,0) — enough for a consumer block
   * imported after this stylesheet to win on source order, and still enough to
   * beat `tokens.css`'s own `:root`. Wrapping `:root` itself would be (0,0,0),
   * which loses to that `:root` and breaks dark mode outright — the broken
   * variant, not the fix.
   *
   * The specificity arithmetic lives in `test/styles/token-cascade.test.ts` and
   * the real cascade is measured against Chromium in
   * `test/styles/token-cascade.browser.test.ts`. This case keeps only the half
   * that belongs to `applyTheme`: whichever preference is published, the guard
   * still MATCHES in both cells a consumer writes a dark override for.
   */
  it('the media guard matches wherever a dark override applies, at (0,1,0) (#241)', () => {
    expect(mediaSelector).toContain(':where(')
    // Not `:where(:root)` — that is the (0,0,0) variant that breaks dark mode.
    expect(mediaSelector).toMatch(/^:root:where\(/)
    // The guard is true whenever the attribute is ABSENT or 'dark' — i.e. in both
    // of the cells a consumer would write a dark override for.
    applyTheme('dark')
    expect(document.documentElement.matches(mediaSelector as string)).toBe(true)
    applyTheme('system')
    expect(document.documentElement.matches(mediaSelector as string)).toBe(true)
  })

  /**
   * #242 — the decision, pinned where a reader of `applyTheme` will find it.
   * `.dark` names a RESOLVED theme, so maintaining it here would mean resolving
   * `prefers-color-scheme` in JS for `'system'`; the class then goes stale on an
   * OS flip and SUPPRESSES the media query that was correct with no JS at all.
   * See the doc comment on `applyTheme` for the measured matrix.
   */
  it('writes no .dark / .light class, in any preference (#242)', () => {
    const html = document.documentElement
    html.className = 'app-shell'
    for (const theme of ['light', 'dark', 'system'] as Theme[]) {
      applyTheme(theme)
      expect(html.classList.contains('dark'), `${theme} added .dark`).toBe(false)
      expect(html.classList.contains('light'), `${theme} added .light`).toBe(false)
    }
    // And it touches no class the consumer put there.
    expect(html.className).toBe('app-shell')
    html.className = ''
  })
})

describe('theme-switch.connect', () => {
  it('root has data-scope and data-part', () => {
    const parts = connect(rootSignal(), vi.fn(), { id: 'ts' })
    expect(parts.root['data-scope']).toBe('theme-switch')
    expect(parts.root['data-part']).toBe('root')
  })

  it('root aria-label defaults to Theme', () => {
    const parts = connect(rootSignal(), vi.fn(), { id: 'ts' })
    expect(parts.root['aria-label']).toBe('Theme')
  })

  it('option returns pressed accessor reflecting current theme', () => {
    const parts = connect(rootSignal(), vi.fn(), { id: 'ts' })
    const dark = parts.option('dark')
    expect(read(dark['aria-pressed'], { theme: 'dark' })).toBe(true)
    expect(read(dark['aria-pressed'], { theme: 'light' })).toBe(false)
  })

  it('option onClick sends setTheme', () => {
    const send = vi.fn()
    const parts = connect(rootSignal(), send, { id: 'ts' })
    parts.option('dark').onClick({} as MouseEvent)
    expect(send).toHaveBeenCalledWith({ type: 'setTheme', theme: 'dark' })
  })

  it('toggle part onClick sends toggle', () => {
    const send = vi.fn()
    const parts = connect(rootSignal(), send, { id: 'ts' })
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
