import { component, h1, article, text } from '@llui/dom'
import type { DocData } from '../markdown'
import { siteLayout, type LayoutMsg } from './site-layout'
import { rawHtml } from './raw-html'

type State = DocData & { menuOpen: boolean }
type Msg = LayoutMsg

export const DocPage = component<State, Msg, never>({
  name: 'DocPage',
  // Seeded from Vike's +data (DocData) plus menuOpen; see pages/*/+data.ts.
  init: () => [{ title: '', description: '', html: '', slug: '', menuOpen: false }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'toggleMenu':
        return [{ ...state, menuOpen: !state.menuOpen }, []]
    }
  },
  view: ({ state, send }) => [
    siteLayout({
      slug: state.at('slug'),
      menuOpen: state.at('menuOpen'),
      send,
      content: [
        article({ class: 'site-content' }, [
          h1({ class: 'page-title' }, [text(state.at('title'))]),
          rawHtml(state.at('html'), 'prose'),
        ]),
      ],
    }),
  ],
})
