import { component, h1, div, article } from '@llui/dom'
import type { DocData } from '../markdown'
import { siteLayout } from './site-layout'

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
    siteLayout<State, Msg>({
      slug: '',
      menuOpen: false,
      text,
      send,
      content: [
        article({ class: 'site-content' }, [
          h1({ class: 'page-title' }, [text((s: State) => s.title)]),
          div({ class: 'prose', innerHTML: (s: State) => s.html }, []),
        ]),
      ],
    }),
  ],
})
