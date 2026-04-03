import { nav as navEl, ul, li, a, text } from '@llui/dom'
import type { State, Msg } from '../types'
import type { Send } from '@llui/dom'

export function pagination(send: Send<Msg>): HTMLElement {
  // This is static structure — we create max page buttons and hide/show with reactive class
  // Actually, pagination count changes dynamically. We need a different approach.
  // Use a text node that re-renders via a reactive accessor won't work for structural changes.
  // The simplest approach: return a container and use onMount or a binding to update it.
  // But the LLui way: this should be inside a branch() or each() that reacts to page/count changes.
  // For now, use a simple approach — the pagination re-renders when the branch case re-activates.
  return navEl({}, [])
}

/**
 * Build pagination statically from current state.
 * Called inside branch() case which re-runs on route change.
 */
export function paginationStatic(
  currentPage: number,
  totalCount: number,
  limit: number,
  send: Send<Msg>,
): HTMLElement {
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
