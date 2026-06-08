import { div, nav, a, span, button, text, onMount } from '@llui/dom'
import type { Signal, Send } from '@llui/dom'
import { EXAMPLES } from '../examples-data'

export type LayoutMsg = { type: 'toggleMenu' }

/**
 * Site chrome wrapper — header, sidebar nav, content slot, footer.
 *
 * `slug` is static per page (drives the active nav link), so it stays a plain
 * string. `menuOpen` is reactive (the burger toggles it), so it arrives as a
 * `Signal<boolean>`. `content` is the already-built page node array.
 */
export function siteLayout({
  slug,
  menuOpen,
  send,
  content,
}: {
  slug: Signal<string>
  menuOpen: Signal<boolean>
  send: Send<LayoutMsg>
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
          [span({ class: 'theme-icon' }, [text('☽')])],
        ),
        button(
          {
            type: 'button',
            class: 'menu-toggle',
            'aria-label': 'Toggle navigation menu',
            onClick: () => send({ type: 'toggleMenu' }),
          },
          [text('☰')],
        ),
      ]),
    ]),

    div({ class: 'site-body' }, [
      // Sidebar nav
      nav(
        {
          class: menuOpen.map((open) => `site-nav${open ? ' open' : ''}`),
          'aria-label': 'Main navigation',
        },
        [
          span({ class: 'nav-section' }, [text('Guide')]),
          navLink('/', 'index', 'Home', slug),
          navLink('/getting-started', 'getting-started', 'Getting Started', slug),
          navLink('/cookbook', 'cookbook', 'Cookbook', slug),
          navLink('/composition-patterns', 'composition-patterns', 'Composition Patterns', slug),
          navLink(
            '/publishing-a-precompiled-library',
            'publishing-a-precompiled-library',
            'Publishing a Library',
            slug,
          ),
          navLink('/architecture', 'architecture', 'Architecture', slug),
          navLink('/benchmarks', 'benchmarks', 'Benchmarks', slug),
          navLink('/changelog', 'changelog', 'Changelog', slug),
          span({ class: 'nav-section' }, [text('AI Integration')]),
          navLink('/debugging', 'debugging', 'Debugging', slug),
          navLink('/agents', 'agents', 'Agents', slug),
          span({ class: 'nav-section' }, [text('Examples')]),
          navLink('/examples', 'examples', 'Overview', slug),
          // Generated from EXAMPLES (single source of truth) so adding an example
          // to examples-data.ts adds its sidebar link automatically.
          ...EXAMPLES.map((ex) =>
            navLink(`/examples/${ex.slug}`, `examples/${ex.slug}`, ex.title, slug),
          ),
          span({ class: 'nav-section' }, [text('Packages')]),
          navLink('/api/dom', 'api/dom', 'dom', slug),
          navLink('/api/compiler', 'api/compiler', 'compiler', slug),
          navLink('/api/vite-plugin', 'api/vite-plugin', 'vite-plugin', slug),
          navLink(
            '/api/compiler-introspection',
            'api/compiler-introspection',
            'compiler-introspection',
            slug,
          ),
          navLink('/api/compiler-devtools', 'api/compiler-devtools', 'compiler-devtools', slug),
          navLink('/api/compiler-ssr', 'api/compiler-ssr', 'compiler-ssr', slug),
          navLink('/api/effects', 'api/effects', 'effects', slug),
          navLink('/api/components', 'api/components', 'components', slug),
          navLink('/api/router', 'api/router', 'router', slug),
          navLink('/api/transitions', 'api/transitions', 'transitions', slug),
          navLink('/api/test', 'api/test', 'test', slug),
          navLink('/api/vike', 'api/vike', 'vike', slug),
          navLink('/api/mcp', 'api/mcp', 'mcp', slug),
          navLink('/api/agent', 'api/agent', 'agent', slug),
          navLink('/api/agent-bridge', 'api/agent-bridge', 'agent-bridge', slug),
          navLink('/api/devmode-annotate', 'api/devmode-annotate', 'devmode-annotate', slug),
          navLink('/api/lexical', 'api/lexical', 'lexical', slug),
          navLink('/api/markdown-editor', 'api/markdown-editor', 'markdown-editor', slug),
        ],
      ),

      // Main content
      div({ class: 'site-content-area' }, content),
    ]),

    // Footer
    div({ class: 'site-footer' }, [
      text('LLui — MIT License · '),
      a({ href: 'https://github.com/fponticelli/llui', class: 'footer-link' }, [text('GitHub')]),
      text(' · '),
      a({ href: '/llms.txt', class: 'footer-link' }, [text('llms.txt')]),
      text(' · '),
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
  icon.textContent = pref === 'system' ? '◐' : resolved === 'dark' ? '☽' : '☀'
  btn.title = `Theme: ${pref}`
  btn.setAttribute('aria-label', `Theme: ${pref}. Click to switch.`)
}

function navLink(href: string, slug: string, label: string, currentSlug: Signal<string>): Node {
  return a(
    {
      href,
      class: currentSlug.map((current) => (current === slug ? 'nav-link active' : 'nav-link')),
      'aria-current': currentSlug.map((current) => (current === slug ? 'page' : undefined)),
    },
    [text(label)],
  )
}
