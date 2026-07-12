import { describe, it, expect, afterEach } from 'vitest'
import { component, mountApp, provide, div, button, type Send } from '@llui/dom'
import { LocaleContext, en, type Locale } from '../../src/locale'
import * as sortable from '../../src/components/sortable'
import * as carousel from '../../src/components/carousel'
import * as pagination from '../../src/components/pagination'

/**
 * Finding 11 — every user-facing string must route through
 * `useContext(LocaleContext)`, so an app that provides a custom Locale
 * overrides ALL of them (previously carousel `slide`/`goToSlide`, pagination
 * `page`, and sortable `handle` read the hardcoded `en` bypassing the context).
 */

const custom: Locale = {
  ...en,
  carousel: {
    ...en.carousel,
    slide: (i) => `Diapositiva ${i + 1}`,
    goToSlide: (i) => `Ir a la diapositiva ${i + 1}`,
  },
  pagination: { ...en.pagination, page: (n) => `Página ${n}` },
  sortable: { handle: 'Asa de arrastre' },
}

type S = {
  sortable: sortable.SortableState
  carousel: carousel.CarouselState
  pagination: pagination.PaginationState
}

describe('locale context override (finding 11)', () => {
  let app: ReturnType<typeof mountApp> | null = null
  afterEach(() => {
    app?.dispose()
    app = null
    document.body.innerHTML = ''
  })

  it('provided Locale overrides carousel, pagination and sortable strings', () => {
    const def = component<S, never, never>({
      name: 'T',
      init: () => [
        {
          sortable: sortable.init(),
          carousel: carousel.init({ count: 2 }),
          pagination: pagination.init({ total: 30, pageSize: 10, page: 1 }),
        },
        [],
      ],
      update: (s) => [s, []],
      // The parts' handlers are never invoked in this test, so typed no-op
      // sends keep each connect's Send<Msg> happy without dispatching.
      view: ({ state }) => [
        provide(LocaleContext, custom, () => {
          const noop =
            <M>(): Send<M> =>
            () => {}
          const srt = sortable.connect(state.at('sortable'), noop<sortable.SortableMsg>(), {
            id: 'srt',
          })
          const car = carousel.connect(state.at('carousel'), noop<carousel.CarouselMsg>(), {
            id: 'car',
          })
          const pag = pagination.connect(state.at('pagination'), noop<pagination.PaginationMsg>())
          return [
            button({ ...srt.handle('x', 0) }, []),
            div({ ...car.slide(0).slide }, []),
            button({ ...car.slide(0).indicator }, []),
            button({ ...pag.item(2) }, []),
          ]
        }),
      ],
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    app = mountApp(host, def)

    const label = (sel: string): string | null =>
      host.querySelector(sel)?.getAttribute('aria-label') ?? null

    expect(label('[data-part="handle"]')).toBe('Asa de arrastre')
    expect(label('[data-part="slide"]')).toBe('Diapositiva 1')
    expect(label('[data-part="indicator"]')).toBe('Ir a la diapositiva 1')
    expect(label('[data-part="item"]')).toBe('Página 2')
  })
})
