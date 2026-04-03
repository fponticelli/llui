import { div, a, p, h1, text, ul, li, each, show, branch, peek } from '@llui/dom'
import type { State, Msg, Article } from '../types'
import type { Send } from '@llui/dom'
import { articlePreview } from './article-preview'
import { paginationStatic } from './pagination'

export function homePage(s: State, send: Send<Msg>): Node[] {
  return [
    div({ class: 'home-page' }, [
      div({ class: 'banner' }, [
        div({ class: 'container' }, [
          h1({ class: 'logo-font' }, [text('conduit')]),
          p({}, [text('A place to share your knowledge.')]),
        ]),
      ]),
      div({ class: 'container page' }, [
        div({ class: 'row' }, [
          div({ class: 'col-md-9' }, [
            ...feedToggle(send),
            ...articleList(),
            paginationStatic(s.page, s.articlesCount, 10, send),
          ]),
          div({ class: 'col-md-3' }, [...sidebar()]),
        ]),
      ]),
    ]),
  ]
}

function feedToggle(send: Send<Msg>): Node[] {
  return [
    div({ class: 'feed-toggle' }, [
      ul({ class: 'nav nav-pills outline-active' }, [
        ...show<State, Msg>({
          when: (s) => s.user !== null,
          render: (_s, send) => [
            li({ class: 'nav-item' }, [
              a(
                {
                  class: (s: State) =>
                    `nav-link${s.route.page === 'home' && s.route.tab === 'feed' ? ' active' : ''}`,
                  href: '',
                  onClick: (e: Event) => {
                    e.preventDefault()
                    send({
                      type: 'navigate',
                      route: { page: 'home', tab: 'feed' },
                    })
                  },
                },
                [text('Your Feed')],
              ),
            ]),
          ],
        }),
        li({ class: 'nav-item' }, [
          a(
            {
              class: (s: State) =>
                `nav-link${s.route.page === 'home' && s.route.tab === 'global' ? ' active' : ''}`,
              href: '',
              onClick: (e: Event) => {
                e.preventDefault()
                send({
                  type: 'navigate',
                  route: { page: 'home', tab: 'global' },
                })
              },
            },
            [text('Global Feed')],
          ),
        ]),
        ...show<State, Msg>({
          when: (s) =>
            s.route.page === 'home' &&
            s.route.tab === 'tag' &&
            s.route.tag !== undefined,
          render: (_s, _send) => [
            li({ class: 'nav-item' }, [
              a({ class: 'nav-link active', href: '' }, [
                text((s: State) =>
                  s.route.page === 'home' && s.route.tab === 'tag'
                    ? `# ${s.route.tag}`
                    : '',
                ),
              ]),
            ]),
          ],
        }),
      ]),
    ]),
  ]
}

function articleList(): Node[] {
  return [
    ...branch<State, Msg>({
      on: (s) => (s.loading ? 'loading' : s.articles.length === 0 ? 'empty' : 'ready'),
      cases: {
        loading: (_s, _send) => [
          div({ class: 'article-preview' }, [text('Loading articles...')]),
        ],
        empty: (_s, _send) => [
          div({ class: 'article-preview' }, [
            text('No articles are here... yet.'),
          ]),
        ],
        ready: (_s, send) => [
          ...each<State, Article, Msg>({
            items: (s) => s.articles,
            key: (a) => a.slug,
            render: ({ item, send }) => articlePreview(item, send),
          }),
        ],
      },
    }),
  ]
}

function sidebar(): Node[] {
  return [
    div({ class: 'sidebar' }, [
      p({}, [text('Popular Tags')]),
      div({ class: 'tag-list' }, [
        ...each<State, string, Msg>({
          items: (s) => s.tags,
          key: (tag) => tag,
          render: ({ item, send }) => [
            a(
              {
                class: 'tag-pill tag-default',
                href: '',
                onClick: (e: Event) => {
                  e.preventDefault()
                  send({
                    type: 'navigate',
                    route: {
                      page: 'home',
                      tab: 'tag',
                      tag: peek(item, (t) => t),
                    },
                  })
                },
              },
              [text(item((t) => t))],
            ),
          ],
        }),
      ]),
    ]),
  ]
}
