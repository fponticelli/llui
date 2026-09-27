import { afterEach, describe, expect, it } from 'vitest'
import { component, form, mountApp, text, type Mountable } from '@llui/dom'
import * as pagination from '@llui/components/pagination'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../llui/ui/pagination'

let app: ReturnType<typeof mountApp> | null = null

afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
})

function mount(dir: 'ltr' | 'rtl' = 'ltr', page = 1): HTMLElement {
  const host = document.createElement('div')
  host.dir = dir
  document.body.append(host)
  const definition = component<{ page: pagination.PaginationState }, pagination.PaginationMsg>({
    name: 'RegistryPaginationMachine',
    init: () => [{ page: pagination.init({ page, pageSize: 10, total: 30, dir }) }, []],
    update: (state, msg) => [{ page: pagination.update(state.page, msg)[0] }, []],
    view: ({ state, send }): readonly Mountable[] => {
      const parts = pagination.connect(state.at('page'), send, { id: 'registry-pagination' })
      return [
        form({ id: 'pagination-form' }, [
          Pagination({ ...parts.root }, [
            PaginationContent([
              PaginationItem([PaginationPrevious({ ...parts.prevTrigger }, [text('Prev')])]),
              ...[1, 2, 3].map((value) =>
                PaginationItem([PaginationLink({ ...parts.item(value) }, [text(String(value))])]),
              ),
              PaginationItem([PaginationNext({ ...parts.nextTrigger }, [text('Next')])]),
            ]),
          ]),
        ]),
      ]
    },
  })
  app = mountApp(host, definition)
  return host
}

const pageButton = (host: HTMLElement, value: number): HTMLButtonElement =>
  host.querySelector(`[data-part="item"][data-value="${value}"]`) as HTMLButtonElement

describe('registry pagination consumes the live machine contract', () => {
  it('renders real buttons with exactly one reactive current page and tab stop', () => {
    const host = mount('ltr', 1)
    const items = [...host.querySelectorAll<HTMLElement>('[data-part="item"]')]
    expect(items.every((item) => item instanceof HTMLButtonElement)).toBe(true)
    expect(items.filter((item) => item.getAttribute('aria-current') === 'page')).toEqual([
      pageButton(host, 1),
    ])
    expect(items.filter((item) => item.tabIndex === 0)).toEqual([pageButton(host, 1)])

    pageButton(host, 2).click()

    expect(items.filter((item) => item.getAttribute('aria-current') === 'page')).toEqual([
      pageButton(host, 2),
    ])
    expect(items.filter((item) => item.tabIndex === 0)).toEqual([pageButton(host, 2)])
  })

  it.each([
    ['ltr', 'ArrowRight', 2],
    ['rtl', 'ArrowLeft', 2],
  ] as const)('moves actual focus in %s with %s', (dir, key, expectedPage) => {
    const host = mount(dir, 1)
    pageButton(host, 1).focus()
    pageButton(host, 1).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(pageButton(host, expectedPage))
  })

  it('keeps disabled boundaries out of roving focus and never submits a form', () => {
    const host = mount('ltr', 1)
    const previous = host.querySelector('[data-part="prev-trigger"]') as HTMLButtonElement
    const next = host.querySelector('[data-part="next-trigger"]') as HTMLButtonElement
    const formElement = host.querySelector('form')!
    let submits = 0
    formElement.addEventListener('submit', (event) => {
      event.preventDefault()
      submits++
    })

    expect(previous.disabled).toBe(true)
    expect(previous.tabIndex).toBe(-1)
    expect(next.disabled).toBe(false)
    pageButton(host, 2).click()
    expect(submits).toBe(0)
    expect(pageButton(host, 2).getAttribute('href')).toBeNull()
  })

  it('disables only the logical boundary trigger on the last page', () => {
    const host = mount('ltr', 3)
    const previous = host.querySelector('[data-part="prev-trigger"]') as HTMLButtonElement
    const next = host.querySelector('[data-part="next-trigger"]') as HTMLButtonElement

    expect(previous.disabled).toBe(false)
    expect(next.disabled).toBe(true)
    expect(next.tabIndex).toBe(-1)
    expect(pageButton(host, 3).getAttribute('aria-current')).toBe('page')
  })
})
