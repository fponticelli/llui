import { div, nav, a, span, button, onMount } from '@llui/dom'
import type { Send } from '@llui/dom'

interface LayoutState {
  slug: string
  menuOpen: boolean
}

type LayoutMsg = { type: 'toggleMenu' }

export function siteLayout<S extends LayoutState, M extends LayoutMsg>({
  slug: _slug,
  menuOpen: _menuOpen,
  text,
  send,
  content,
}: {
  slug: string
  menuOpen: boolean
  text: (v: string | ((s: S) => string)) => Text
  send: Send<M>
  content: Node[]
}): Node {
  // Wire theme toggle button after mount (self-contained — no component state)
  onMount(() => {
    setupThemeToggle()
  })

  return div({ class: 'site-layout' }, [
    // Header
    div({ class: 'site-header' }, [
      a({ href: '/', class: 'site-logo' }, [text('LLui')]),
      div({ class: 'site-header-actions' }, [
        button(
          {
            class: 'theme-toggle',
            id: 'theme-toggle',
            type: 'button',
            'aria-label': 'Toggle theme',
            title: 'Toggle theme',
          },
          [span({ class: 'theme-icon' }, [text('\u263D')])],
        ),
        div(
          {
            class: 'menu-toggle',
            onClick: () => send({ type: 'toggleMenu' } as M),
          },
          [text('\u2630')],
        ),
      ]),
    ]),

    div({ class: 'site-body' }, [
      // Sidebar nav
      nav(
        {
          class: (s: S) => `site-nav${s.menuOpen ? ' open' : ''}`,
          'aria-label': 'Main navigation',
        },
        [
          span({ class: 'nav-section' }, [text('Guide')]),
          navLink<S>('/', 'index', 'Home', text),
          navLink<S>('/getting-started', 'getting-started', 'Getting Started', text),
          navLink<S>('/cookbook', 'cookbook', 'Cookbook', text),
          navLink<S>('/architecture', 'architecture', 'Architecture', text),
          navLink<S>('/llm-guide', 'llm-guide', 'LLM Guide', text),
          navLink<S>('/benchmarks', 'benchmarks', 'Benchmarks', text),
          navLink<S>('/changelog', 'changelog', 'Changelog', text),
          span({ class: 'nav-section' }, [text('Packages')]),
          navLink<S>('/api/dom', 'api/dom', 'dom', text),
          navLink<S>('/api/vite-plugin', 'api/vite-plugin', 'vite-plugin', text),
          navLink<S>('/api/effects', 'api/effects', 'effects', text),
          navLink<S>('/api/components', 'api/components', 'components', text),
          navLink<S>('/api/router', 'api/router', 'router', text),
          navLink<S>('/api/transitions', 'api/transitions', 'transitions', text),
          navLink<S>('/api/test', 'api/test', 'test', text),
          navLink<S>('/api/vike', 'api/vike', 'vike', text),
          navLink<S>('/api/mcp', 'api/mcp', 'mcp', text),
          navLink<S>('/api/lint-idiomatic', 'api/lint-idiomatic', 'lint-idiomatic', text),
        ],
      ),

      // Main content
      div({ class: 'site-content-area' }, content),
    ]),

    // Footer
    div({ class: 'site-footer' }, [
      text('LLui \u2014 MIT License \u00b7 '),
      a({ href: 'https://github.com/fponticelli/llui', class: 'footer-link' }, [text('GitHub')]),
      text(' \u00b7 '),
      a({ href: '/llms.txt', class: 'footer-link' }, [text('llms.txt')]),
      text(' \u00b7 '),
      a({ href: '/llms-full.txt', class: 'footer-link' }, [text('llms-full.txt')]),
    ]),
  ])
}

type ThemePref = 'light' | 'dark' | 'system'

function readStoredTheme(): ThemePref {
  try {
    const v = localStorage.getItem('llui-theme')
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // ignore
  }
  return 'system'
}

function resolvedTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'light'
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

function setupThemeToggle(): void {
  const btn = document.getElementById('theme-toggle')
  if (!btn) return

  // Avoid double-binding on client navigation
  if (btn.dataset.wired === 'true') {
    updateIcon(btn, readStoredTheme())
    return
  }
  btn.dataset.wired = 'true'

  updateIcon(btn, readStoredTheme())

  btn.addEventListener('click', () => {
    const current = readStoredTheme()
    // Cycle: system → dark → light → system
    const next: ThemePref = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system'
    try {
      localStorage.setItem('llui-theme', next)
    } catch {
      // ignore
    }
    if (next === 'system') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.dataset.theme = next
    }
    updateIcon(btn, next)
  })
}

function updateIcon(btn: HTMLElement, pref: ThemePref): void {
  const icon = btn.querySelector('.theme-icon')
  if (!icon) return
  // ☽ = dark, ☀ = light, ◐ = system
  const resolved = resolvedTheme(pref)
  icon.textContent = pref === 'system' ? '\u25D0' : resolved === 'dark' ? '\u263D' : '\u2600'
  btn.title = `Theme: ${pref}`
  btn.setAttribute('aria-label', `Theme: ${pref}. Click to switch.`)
}

function navLink<S extends LayoutState>(
  href: string,
  slug: string,
  label: string,
  text: (v: string | ((s: S) => string)) => Text,
): Node {
  return a(
    {
      href,
      class: (s: S) => (s.slug === slug ? 'nav-link active' : 'nav-link'),
      'aria-current': (s: S) => (s.slug === slug ? 'page' : undefined),
    },
    [text(label)],
  )
}
