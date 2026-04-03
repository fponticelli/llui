import { div, a, button, h1, p, span, img, text } from '@llui/dom'
import { peek } from '@llui/dom'
import type { Article, Msg } from '../types'
import type { Send } from '@llui/dom'

type ItemAccessor = <R>(selector: (t: Article) => R) => () => R

export function articlePreview(item: ItemAccessor, send: Send<Msg>): Node[] {
  return [
    div({ class: 'article-preview' }, [
      div({ class: 'article-meta' }, [
        a({ href: item((a) => `#/profile/${a.author.username}`) }, [
          img({
            alt: '',
            src: item(
              (a) =>
                a.author.image ||
                'https://api.realworld.io/images/smiley-cyrus.jpeg',
            ),
          }),
        ]),
        div({ class: 'info' }, [
          a(
            {
              class: 'author',
              href: item((a) => `#/profile/${a.author.username}`),
            },
            [text(item((a) => a.author.username))],
          ),
          span({ class: 'date' }, [
            text(item((a) => formatDate(a.createdAt))),
          ]),
        ]),
        button(
          {
            class: item((a) =>
              `btn btn-sm pull-xs-right${a.favorited ? ' btn-primary' : ' btn-outline-primary'}`,
            ),
            onClick: () => {
              send({
                type: 'toggleFavorite',
                slug: peek(item, (a) => a.slug),
                favorited: peek(item, (a) => a.favorited),
              })
            },
          },
          [text(item((a) => `♥ ${a.favoritesCount}`))],
        ),
      ]),
      a(
        {
          class: 'preview-link',
          href: item((a) => `#/article/${a.slug}`),
        },
        [
          h1({}, [text(item((a) => a.title))]),
          p({}, [text(item((a) => a.description))]),
          span({}, [text('Read more...')]),
        ],
      ),
    ]),
  ]
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
