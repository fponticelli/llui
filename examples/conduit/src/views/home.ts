import { div, a, p, h1, text, ul, li, each, nav as navEl, span, img } from '@llui/dom'
import type { State, Msg, Article } from '../types'
import type { Send } from '@llui/dom'
import { articlePreview } from './article-preview'
import { pagination } from './pagination'

export function homePage(s: State, send: Send<Msg>): HTMLElement[] {
  const route = s.route
  const tab = route.page === 'home' ? route.tab : 'global'
  const tag = route.page === 'home' && route.tab === 'tag' ? route.tag : undefined

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
            feedToggle(tab, tag, !!s.user, send),
            ...articleList(s, send),
            pagination(s.page, s.articlesCount, 10, send),
          ]),
          div({ class: 'col-md-3' }, [
            sidebar(s.tags, send),
          ]),
        ]),
      ]),
    ]),
  ]
}

function feedToggle(tab: string, tag: string | undefined, loggedIn: boolean, send: Send<Msg>): HTMLElement {
  return div({ class: 'feed-toggle' }, [
    ul({ class: 'nav nav-pills outline-active' }, [
      ...(loggedIn
        ? [tabItem('Your Feed', tab === 'feed', () => send({ type: 'navigate', route: { page: 'home', tab: 'feed' } }))]
        : []),
      tabItem('Global Feed', tab === 'global', () => send({ type: 'navigate', route: { page: 'home', tab: 'global' } })),
      ...(tag
        ? [tabItem(`# ${tag}`, true, () => {})]
        : []),
    ]),
  ])
}

function tabItem(label: string, active: boolean, onClick: () => void): HTMLElement {
  return li({ class: 'nav-item' }, [
    a({
      class: `nav-link${active ? ' active' : ''}`,
      href: '',
      onClick: (e: Event) => { e.preventDefault(); onClick() },
    }, [text(label)]),
  ])
}

function articleList(s: State, send: Send<Msg>): HTMLElement[] {
  if (s.loading) {
    return [div({ class: 'article-preview' }, [text('Loading articles...')])]
  }
  if (s.articles.length === 0) {
    return [div({ class: 'article-preview' }, [text('No articles are here... yet.')])]
  }
  return s.articles.map((article) => articlePreview(article, s.user?.token, send))
}

function sidebar(tags: string[], send: Send<Msg>): HTMLElement {
  return div({ class: 'sidebar' }, [
    p({}, [text('Popular Tags')]),
    div({ class: 'tag-list' }, [
      ...tags.map((tag) =>
        a({
          class: 'tag-pill tag-default',
          href: '',
          onClick: (e: Event) => {
            e.preventDefault()
            send({ type: 'navigate', route: { page: 'home', tab: 'tag', tag } })
          },
        }, [text(tag)]),
      ),
    ]),
  ])
}
