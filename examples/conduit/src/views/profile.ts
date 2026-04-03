import { div, h4, p, a, button, img, ul, li, text, show, each, branch } from '@llui/dom'
import type { State, Msg, Article } from '../types'
import type { Send } from '@llui/dom'
import { articlePreview } from './article-preview'

export function profilePage(_s: State, send: Send<Msg>): HTMLElement[] {
  return [
    div({ class: 'profile-page' }, [
      div({ class: 'user-info' }, [
        div({ class: 'container' }, [
          div({ class: 'row' }, [
            div({ class: 'col-xs-12 col-md-10 offset-md-1' }, [
              img({
                alt: '',
                class: 'user-img',
                src: (s: State) => s.profile?.image || 'https://api.realworld.io/images/smiley-cyrus.jpeg',
              }),
              h4({}, [text((s: State) => s.profile?.username ?? '')]),
              p({}, [text((s: State) => s.profile?.bio ?? '')]),
              // Edit settings (own profile)
              ...show<State, Msg>({
                when: (s) => s.user !== null && s.profile !== null && s.user.username === s.profile.username,
                render: (_s, send) => [
                  a({
                    class: 'btn btn-sm btn-outline-secondary action-btn',
                    href: '#/settings',
                    onClick: (e: Event) => {
                      e.preventDefault()
                      send({ type: 'navigate', route: { page: 'settings' } })
                    },
                  }, [text('Edit Profile Settings')]),
                ],
              }),
              // Follow button (other's profile)
              ...show<State, Msg>({
                when: (s) => s.user !== null && s.profile !== null && s.user.username !== s.profile.username,
                render: (s, send) => [
                  button({
                    class: (s: State) => `btn btn-sm action-btn ${s.profile?.following ? 'btn-secondary' : 'btn-outline-secondary'}`,
                    onClick: () => {
                      if (s.profile) send({ type: 'toggleFollow', username: s.profile.username, following: s.profile.following })
                    },
                  }, [text((s: State) => `${s.profile?.following ? 'Unfollow' : 'Follow'} ${s.profile?.username ?? ''}`)]),
                ],
              }),
            ]),
          ]),
        ]),
      ]),
      // Articles
      div({ class: 'container' }, [
        div({ class: 'row' }, [
          div({ class: 'col-xs-12 col-md-10 offset-md-1' }, [
            div({ class: 'articles-toggle' }, [
              ul({ class: 'nav nav-pills outline-active' }, [
                li({ class: 'nav-item' }, [
                  a({
                    class: (s: State) => `nav-link${s.route.page === 'profile' && s.route.tab === 'authored' ? ' active' : ''}`,
                    href: (s: State) => `#/profile/${s.profile?.username ?? ''}`,
                  }, [text('My Articles')]),
                ]),
                li({ class: 'nav-item' }, [
                  a({
                    class: (s: State) => `nav-link${s.route.page === 'profile' && s.route.tab === 'favorited' ? ' active' : ''}`,
                    href: (s: State) => `#/profile/${s.profile?.username ?? ''}/favorites`,
                  }, [text('Favorited Articles')]),
                ]),
              ]),
            ]),
            // Article list
            ...branch<State, Msg>({
              on: (s) => s.loading ? 'loading' : s.profileArticles.length === 0 ? 'empty' : 'ready',
              cases: {
                loading: () => [div({ class: 'article-preview' }, [text('Loading articles...')])],
                empty: () => [div({ class: 'article-preview' }, [text('No articles are here... yet.')])],
                ready: (_s, send) => [
                  ...each<State, Article, Msg>({
                    items: (s) => s.profileArticles,
                    key: (a) => a.slug,
                    render: ({ item, send }) => articlePreview(item, send),
                  }),
                ],
              },
            }),
          ]),
        ]),
      ]),
    ]),
  ]
}
