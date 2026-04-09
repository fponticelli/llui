import { div, nav, a, span } from '@llui/dom'
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
  return div({ class: 'site-layout' }, [
    // Header
    div({ class: 'site-header' }, [
      a({ href: '/', class: 'site-logo' }, [text('LLui')]),
      div(
        {
          class: 'menu-toggle',
          onClick: () => send({ type: 'toggleMenu' } as M),
        },
        [text('\u2630')],
      ),
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
    ]),
  ])
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
