import { div, h4, p, a, button, img, ul, li, text } from '@llui/dom'
import type { State, Msg } from '../types'
import type { Send } from '@llui/dom'
import { articlePreview } from './article-preview'

export function profilePage(s: State, send: Send<Msg>): HTMLElement[] {
  if (!s.profile) return [div({}, [text('Loading...')])]
  const profile = s.profile
  const route = s.route
  const tab = route.page === 'profile' ? route.tab : 'authored'
  const isOwn = s.user?.username === profile.username

  return [
    div({ class: 'profile-page' }, [
      div({ class: 'user-info' }, [
        div({ class: 'container' }, [
          div({ class: 'row' }, [
            div({ class: 'col-xs-12 col-md-10 offset-md-1' }, [
              img({ alt: '', class: 'user-img', src: profile.image || 'https://api.realworld.io/images/smiley-cyrus.jpeg' }),
              h4({}, [text(profile.username)]),
              p({}, [text(profile.bio || '')]),
              ...(isOwn
                ? [a({ class: 'btn btn-sm btn-outline-secondary action-btn', href: '#/settings' }, [
                    text('Edit Profile Settings'),
                  ])]
                : s.user
                  ? [button({
                      class: `btn btn-sm action-btn ${profile.following ? 'btn-secondary' : 'btn-outline-secondary'}`,
                      onClick: () => send({ type: 'toggleFollow', username: profile.username, following: profile.following }),
                    }, [text(`${profile.following ? 'Unfollow' : 'Follow'} ${profile.username}`)])]
                  : []),
            ]),
          ]),
        ]),
      ]),
      div({ class: 'container' }, [
        div({ class: 'row' }, [
          div({ class: 'col-xs-12 col-md-10 offset-md-1' }, [
            div({ class: 'articles-toggle' }, [
              ul({ class: 'nav nav-pills outline-active' }, [
                li({ class: 'nav-item' }, [
                  a({
                    class: `nav-link${tab === 'authored' ? ' active' : ''}`,
                    href: `#/profile/${profile.username}`,
                  }, [text('My Articles')]),
                ]),
                li({ class: 'nav-item' }, [
                  a({
                    class: `nav-link${tab === 'favorited' ? ' active' : ''}`,
                    href: `#/profile/${profile.username}/favorites`,
                  }, [text('Favorited Articles')]),
                ]),
              ]),
            ]),
            ...(s.loading
              ? [div({ class: 'article-preview' }, [text('Loading articles...')])]
              : s.profileArticles.length === 0
                ? [div({ class: 'article-preview' }, [text('No articles are here... yet.')])]
                : s.profileArticles.map((a) => articlePreview(a, s.user?.token, send))),
          ]),
        ]),
      ]),
    ]),
  ]
}
