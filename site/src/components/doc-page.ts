import { component, div, h1, nav, a, article } from '@llui/dom'
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
            a({ href: '/', class: 'nav-link' }, [text('Home')]),
            a({ href: '/getting-started', class: 'nav-link' }, [text('Getting Started')]),
            a({ href: '/cookbook', class: 'nav-link' }, [text('Cookbook')]),
            a({ href: '/architecture', class: 'nav-link' }, [text('Architecture')]),
            a({ href: '/llm-guide', class: 'nav-link' }, [text('LLM Guide')]),
            a({ href: '/api/dom', class: 'nav-link' }, [text('dom')]),
            a({ href: '/api/vite-plugin', class: 'nav-link' }, [text('vite-plugin')]),
            a({ href: '/api/effects', class: 'nav-link' }, [text('effects')]),
            a({ href: '/api/test', class: 'nav-link' }, [text('test')]),
            a({ href: '/api/components', class: 'nav-link' }, [text('components')]),
            a({ href: '/api/router', class: 'nav-link' }, [text('router')]),
            a({ href: '/api/transitions', class: 'nav-link' }, [text('transitions')]),
            a({ href: '/api/vike', class: 'nav-link' }, [text('vike')]),
            a({ href: '/api/mcp', class: 'nav-link' }, [text('mcp')]),
            a({ href: '/api/lint-idiomatic', class: 'nav-link' }, [text('lint-idiomatic')]),
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
