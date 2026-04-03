import { div, a, button, h1, p, span, img, text } from '@llui/dom'
import type { Article, Msg } from '../types'
import type { Send } from '@llui/dom'

export function articlePreview(article: Article, token: string | undefined, send: Send<Msg>): HTMLElement {
  return div({ class: 'article-preview' }, [
    div({ class: 'article-meta' }, [
      a({ href: `#/profile/${article.author.username}` }, [
        img({ alt: '', src: article.author.image || 'https://api.realworld.io/images/smiley-cyrus.jpeg' }),
      ]),
      div({ class: 'info' }, [
        a({ class: 'author', href: `#/profile/${article.author.username}` }, [
          text(article.author.username),
        ]),
        span({ class: 'date' }, [text(formatDate(article.createdAt))]),
      ]),
      button({
        class: `btn btn-sm pull-xs-right${article.favorited ? ' btn-primary' : ' btn-outline-primary'}`,
        onClick: () => {
          if (token) send({ type: 'toggleFavorite', slug: article.slug, favorited: article.favorited })
        },
      }, [
        text(`♥ ${article.favoritesCount}`),
      ]),
    ]),
    a({ class: 'preview-link', href: `#/article/${article.slug}` }, [
      h1({}, [text(article.title)]),
      p({}, [text(article.description)]),
      span({}, [text('Read more...')]),
    ]),
  ])
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
