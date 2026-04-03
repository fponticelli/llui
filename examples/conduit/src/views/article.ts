import { div, h1, h2, p, a, button, span, img, form, textarea, text, hr } from '@llui/dom'
import type { State, Msg, Article, Comment } from '../types'
import type { Send } from '@llui/dom'

export function articlePage(s: State, send: Send<Msg>): HTMLElement[] {
  if (!s.article) {
    return [div({ class: 'article-page' }, [text('Loading...')])]
  }
  const article = s.article
  const isOwner = s.user?.username === article.author.username

  return [
    div({ class: 'article-page' }, [
      articleBanner(article, isOwner, s, send),
      div({ class: 'container page' }, [
        div({ class: 'row article-content' }, [
          div({ class: 'col-md-12' }, [
            p({}, [text(article.body)]),
          ]),
        ]),
        hr({}),
        div({ class: 'article-actions' }, [
          articleMeta(article, isOwner, s, send),
        ]),
        div({ class: 'row' }, [
          div({ class: 'col-xs-12 col-md-8 offset-md-2' }, [
            ...(s.user
              ? [commentForm(send)]
              : [p({}, [
                  a({ href: '#/login' }, [text('Sign in')]),
                  text(' or '),
                  a({ href: '#/register' }, [text('sign up')]),
                  text(' to add comments on this article.'),
                ])]),
            ...s.comments.map((c) => commentCard(c, s.user?.username, send)),
          ]),
        ]),
      ]),
    ]),
  ]
}

function articleBanner(article: Article, isOwner: boolean, s: State, send: Send<Msg>): HTMLElement {
  return div({ class: 'banner' }, [
    div({ class: 'container' }, [
      h1({}, [text(article.title)]),
      articleMeta(article, isOwner, s, send),
    ]),
  ])
}

function articleMeta(article: Article, isOwner: boolean, s: State, send: Send<Msg>): HTMLElement {
  return div({ class: 'article-meta' }, [
    a({ href: `#/profile/${article.author.username}` }, [
      img({ alt: '', src: article.author.image || 'https://api.realworld.io/images/smiley-cyrus.jpeg' }),
    ]),
    div({ class: 'info' }, [
      a({ class: 'author', href: `#/profile/${article.author.username}` }, [
        text(article.author.username),
      ]),
      span({ class: 'date' }, [text(new Date(article.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))]),
    ]),
    ...(isOwner
      ? [
          a({ class: 'btn btn-outline-secondary btn-sm', href: `#/editor/${article.slug}` }, [
            text('Edit Article'),
          ]),
          button({
            class: 'btn btn-outline-danger btn-sm',
            onClick: () => send({ type: 'deleteArticle', slug: article.slug }),
          }, [text('Delete Article')]),
        ]
      : [
          ...(s.user
            ? [
                button({
                  class: `btn btn-sm ${article.author.following ? 'btn-secondary' : 'btn-outline-secondary'}`,
                  onClick: () => send({ type: 'toggleFollow', username: article.author.username, following: article.author.following }),
                }, [text(`${article.author.following ? 'Unfollow' : 'Follow'} ${article.author.username}`)]),
                button({
                  class: `btn btn-sm ${article.favorited ? 'btn-primary' : 'btn-outline-primary'}`,
                  onClick: () => send({ type: 'toggleFavorite', slug: article.slug, favorited: article.favorited }),
                }, [text(`♥ Favorite (${article.favoritesCount})`)]),
              ]
            : []),
        ]),
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

function commentCard(comment: Comment, currentUser: string | undefined, send: Send<Msg>): HTMLElement {
  return div({ class: 'card' }, [
    div({ class: 'card-block' }, [
      p({ class: 'card-text' }, [text(comment.body)]),
    ]),
    div({ class: 'card-footer' }, [
      a({ class: 'comment-author', href: `#/profile/${comment.author.username}` }, [
        img({ alt: '', class: 'comment-author-img', src: comment.author.image || 'https://api.realworld.io/images/smiley-cyrus.jpeg' }),
      ]),
      a({ class: 'comment-author', href: `#/profile/${comment.author.username}` }, [
        text(comment.author.username),
      ]),
      span({ class: 'date-posted' }, [
        text(new Date(comment.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })),
      ]),
      ...(currentUser === comment.author.username
        ? [span({ class: 'mod-options' }, [
            button({
              class: 'btn btn-sm',
              onClick: () => send({ type: 'deleteComment', id: comment.id }),
            }, [text('🗑')]),
          ])]
        : []),
    ]),
  ])
}
