import { div, h1, h2, p, a, button, span, img, form, textarea, text, hr, show, each } from '@llui/dom'
import type { State, Msg, Comment } from '../types'
import type { Send } from '@llui/dom'

export function articlePage(_s: State, send: Send<Msg>): HTMLElement[] {
  return [
    div({ class: 'article-page' }, [
      // Banner
      div({ class: 'banner' }, [
        div({ class: 'container' }, [
          h1({}, [text((s: State) => s.article?.title ?? '')]),
          articleMeta(send),
        ]),
      ]),
      // Body
      div({ class: 'container page' }, [
        div({ class: 'row article-content' }, [
          div({ class: 'col-md-12' }, [
            p({}, [text((s: State) => s.article?.body ?? '')]),
          ]),
        ]),
        hr({}),
        div({ class: 'article-actions' }, [
          articleMeta(send),
        ]),
        // Comments section
        div({ class: 'row' }, [
          div({ class: 'col-xs-12 col-md-8 offset-md-2' }, [
            // Comment form (logged in only)
            ...show<State, Msg>({
              when: (s) => s.user !== null,
              render: (_s, send) => [commentForm(send)],
            }),
            // Comment list
            ...each<State, Comment, Msg>({
              items: (s) => s.comments,
              key: (c) => c.id,
              render: ({ item, send }) => [commentCard(item, send)],
            }),
          ]),
        ]),
      ]),
    ]),
  ]
}

function articleMeta(send: Send<Msg>): HTMLElement {
  return div({ class: 'article-meta' }, [
    a({ href: (s: State) => `#/profile/${s.article?.author?.username ?? ''}` }, [
      img({ alt: '', src: (s: State) => s.article?.author?.image || 'https://api.realworld.io/images/smiley-cyrus.jpeg' }),
    ]),
    div({ class: 'info' }, [
      a({
        class: 'author',
        href: (s: State) => `#/profile/${s.article?.author?.username ?? ''}`,
      }, [
        text((s: State) => s.article?.author?.username ?? ''),
      ]),
      span({ class: 'date' }, [
        text((s: State) => s.article ? new Date(s.article.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''),
      ]),
    ]),
    // Owner actions
    ...show<State, Msg>({
      when: (s) => s.user !== null && s.article !== null && s.user.username === s.article.author.username,
      render: (s, send) => [
        a({
          class: 'btn btn-outline-secondary btn-sm',
          href: (s: State) => `#/editor/${s.article?.slug ?? ''}`,
        }, [text('Edit Article')]),
        button({
          class: 'btn btn-outline-danger btn-sm',
          onClick: () => {
            if (s.article) send({ type: 'deleteArticle', slug: s.article.slug })
          },
        }, [text('Delete Article')]),
      ],
    }),
    // Non-owner actions (follow + favorite)
    ...show<State, Msg>({
      when: (s) => s.user !== null && s.article !== null && s.user.username !== s.article.author.username,
      render: (_s, send) => [
        button({
          class: (s: State) => `btn btn-sm ${s.article?.author?.following ? 'btn-secondary' : 'btn-outline-secondary'}`,
          onClick: () => {
            const a = _s.article
            if (a) send({ type: 'toggleFollow', username: a.author.username, following: a.author.following })
          },
        }, [text((s: State) => `${s.article?.author?.following ? 'Unfollow' : 'Follow'} ${s.article?.author?.username ?? ''}`)]),
        button({
          class: (s: State) => `btn btn-sm ${s.article?.favorited ? 'btn-primary' : 'btn-outline-primary'}`,
          onClick: () => {
            const a = _s.article
            if (a) send({ type: 'toggleFavorite', slug: a.slug, favorited: a.favorited })
          },
        }, [text((s: State) => `♥ Favorite (${s.article?.favoritesCount ?? 0})`)]),
      ],
    }),
  ])
}

function commentForm(send: Send<Msg>): HTMLElement {
  let bodyValue = ''
  return form({
    class: 'card comment-form',
    onSubmit: (e: Event) => {
      e.preventDefault()
      if (bodyValue.trim()) {
        send({ type: 'submitComment', body: bodyValue })
        bodyValue = ''
      }
    },
  }, [
    div({ class: 'card-block' }, [
      textarea({
        class: 'form-control',
        placeholder: 'Write a comment...',
        onInput: (e: Event) => { bodyValue = (e.target as HTMLTextAreaElement).value },
      }),
    ]),
    div({ class: 'card-footer' }, [
      button({ class: 'btn btn-sm btn-primary', type: 'submit' }, [text('Post Comment')]),
    ]),
  ])
}

function commentCard(
  item: <R>(sel: (c: Comment) => R) => () => R,
  send: Send<Msg>,
): HTMLElement {
  const id = item((c) => c.id)()
  return div({ class: 'card' }, [
    div({ class: 'card-block' }, [
      p({ class: 'card-text' }, [text(item((c) => c.body))]),
    ]),
    div({ class: 'card-footer' }, [
      a({ class: 'comment-author', href: '' }, [
        img({ alt: '', class: 'comment-author-img', src: item((c) => c.author.image || 'https://api.realworld.io/images/smiley-cyrus.jpeg')() }),
      ]),
      a({ class: 'comment-author', href: '' }, [
        text(item((c) => c.author.username)),
      ]),
      span({ class: 'date-posted' }, [
        text(item((c) => new Date(c.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))),
      ]),
      button({
        class: 'btn btn-sm',
        onClick: () => send({ type: 'deleteComment', id }),
      }, [text('🗑')]),
    ]),
  ])
}
