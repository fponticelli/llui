import { component, div, h1, nav, a, span, article } from '@llui/dom'
import type { DocData } from '../markdown'

type State = DocData & { menuOpen: boolean }
type Msg = { type: 'toggleMenu' }

export const DocPage = component<State, Msg, never, DocData>({
  name: 'DocPage',
  init: (data) => [{ ...data, menuOpen: false }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'toggleMenu':
        return [{ ...state, menuOpen: !state.menuOpen }, []]
    }
  },
  view: ({ send, text }) => [
    div({ class: 'site-layout' }, [
      // Header
      div({ class: 'site-header' }, [
        a({ href: '/', class: 'site-logo' }, [text('LLui')]),
        div(
          {
            class: 'menu-toggle',
            onClick: () => send({ type: 'toggleMenu' }),
          },
          [text('\u2630')],
        ),
      ]),

      div({ class: 'site-body' }, [
        // Sidebar nav
        nav(
          {
            class: (s: State) => `site-nav${s.menuOpen ? ' open' : ''}`,
            'aria-label': 'Main navigation',
          },
          [
            span({ class: 'nav-section' }, [text('Guide')]),
            a(
              {
                href: '/',
                class: (s: State) => (s.slug === 'index' ? 'nav-link active' : 'nav-link'),
                'aria-current': (s: State) => (s.slug === 'index' ? 'page' : undefined),
              },
              [text('Home')],
            ),
            a(
              {
                href: '/getting-started',
                class: (s: State) =>
                  s.slug === 'getting-started' ? 'nav-link active' : 'nav-link',
                'aria-current': (s: State) => (s.slug === 'getting-started' ? 'page' : undefined),
              },
              [text('Getting Started')],
            ),
            a(
              {
                href: '/cookbook',
                class: (s: State) => (s.slug === 'cookbook' ? 'nav-link active' : 'nav-link'),
                'aria-current': (s: State) => (s.slug === 'cookbook' ? 'page' : undefined),
              },
              [text('Cookbook')],
            ),
            a(
              {
                href: '/architecture',
                class: (s: State) => (s.slug === 'architecture' ? 'nav-link active' : 'nav-link'),
                'aria-current': (s: State) => (s.slug === 'architecture' ? 'page' : undefined),
              },
              [text('Architecture')],
            ),
            a(
              {
                href: '/llm-guide',
                class: (s: State) => (s.slug === 'llm-guide' ? 'nav-link active' : 'nav-link'),
                'aria-current': (s: State) => (s.slug === 'llm-guide' ? 'page' : undefined),
              },
              [text('LLM Guide')],
            ),
            span({ class: 'nav-section' }, [text('Packages')]),
            a(
              {
                href: '/api/dom',
                class: (s: State) => (s.slug === 'api/dom' ? 'nav-link active' : 'nav-link'),
                'aria-current': (s: State) => (s.slug === 'api/dom' ? 'page' : undefined),
              },
              [text('dom')],
            ),
            a(
              {
                href: '/api/vite-plugin',
                class: (s: State) =>
                  s.slug === 'api/vite-plugin' ? 'nav-link active' : 'nav-link',
                'aria-current': (s: State) => (s.slug === 'api/vite-plugin' ? 'page' : undefined),
              },
              [text('vite-plugin')],
            ),
            a(
              {
                href: '/api/effects',
                class: (s: State) => (s.slug === 'api/effects' ? 'nav-link active' : 'nav-link'),
                'aria-current': (s: State) => (s.slug === 'api/effects' ? 'page' : undefined),
              },
              [text('effects')],
            ),
            a(
              {
                href: '/api/components',
                class: (s: State) => (s.slug === 'api/components' ? 'nav-link active' : 'nav-link'),
                'aria-current': (s: State) => (s.slug === 'api/components' ? 'page' : undefined),
              },
              [text('components')],
            ),
            a(
              {
                href: '/api/router',
                class: (s: State) => (s.slug === 'api/router' ? 'nav-link active' : 'nav-link'),
                'aria-current': (s: State) => (s.slug === 'api/router' ? 'page' : undefined),
              },
              [text('router')],
            ),
            a(
              {
                href: '/api/transitions',
                class: (s: State) =>
                  s.slug === 'api/transitions' ? 'nav-link active' : 'nav-link',
                'aria-current': (s: State) => (s.slug === 'api/transitions' ? 'page' : undefined),
              },
              [text('transitions')],
            ),
            a(
              {
                href: '/api/test',
                class: (s: State) => (s.slug === 'api/test' ? 'nav-link active' : 'nav-link'),
                'aria-current': (s: State) => (s.slug === 'api/test' ? 'page' : undefined),
              },
              [text('test')],
            ),
            a(
              {
                href: '/api/vike',
                class: (s: State) => (s.slug === 'api/vike' ? 'nav-link active' : 'nav-link'),
                'aria-current': (s: State) => (s.slug === 'api/vike' ? 'page' : undefined),
              },
              [text('vike')],
            ),
            a(
              {
                href: '/api/mcp',
                class: (s: State) => (s.slug === 'api/mcp' ? 'nav-link active' : 'nav-link'),
                'aria-current': (s: State) => (s.slug === 'api/mcp' ? 'page' : undefined),
              },
              [text('mcp')],
            ),
            a(
              {
                href: '/api/lint-idiomatic',
                class: (s: State) =>
                  s.slug === 'api/lint-idiomatic' ? 'nav-link active' : 'nav-link',
                'aria-current': (s: State) =>
                  s.slug === 'api/lint-idiomatic' ? 'page' : undefined,
              },
              [text('lint-idiomatic')],
            ),
          ],
        ),

        // Main content
        article({ class: 'site-content' }, [
          h1({ class: 'page-title' }, [text((s: State) => s.title)]),
          div({ class: 'prose', innerHTML: (s: State) => s.html }, []),
        ]),
      ]),

      // Footer
      div({ class: 'site-footer' }, [
        text('LLui \u2014 MIT License \u00b7 '),
        a({ href: 'https://github.com/fponticelli/llui', class: 'footer-link' }, [text('GitHub')]),
        text(' \u00b7 '),
        a({ href: '/llms.txt', class: 'footer-link' }, [text('llms.txt')]),
      ]),
    ]),
  ],
})
