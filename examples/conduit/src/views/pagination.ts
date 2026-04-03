import { nav as navEl, ul, li, a, text } from '@llui/dom'
import type { Msg } from '../types'
import type { Send } from '@llui/dom'

export function pagination(currentPage: number, totalCount: number, limit: number, send: Send<Msg>): HTMLElement {
  const totalPages = Math.ceil(totalCount / limit)
  if (totalPages <= 1) return navEl({}, [])

  const pages: HTMLElement[] = []
  for (let i = 0; i < totalPages; i++) {
    pages.push(
      li({ class: `page-item${i === currentPage ? ' active' : ''}` }, [
        a({
          class: 'page-link',
          href: '',
          onClick: (e: Event) => { e.preventDefault(); send({ type: 'setPage', page: i }) },
        }, [text(String(i + 1))]),
      ]),
    )
  }

  return navEl({}, [ul({ class: 'pagination' }, pages)])
}
