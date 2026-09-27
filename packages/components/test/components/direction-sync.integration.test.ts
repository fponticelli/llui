import { afterEach, describe, expect, it, vi } from 'vitest'
import { button, component, div, mountApp, text, type Mountable } from '@llui/dom'
import * as carousel from '../../src/components/carousel'
import * as pagination from '../../src/components/pagination'
import * as tabs from '../../src/components/tabs'

interface State {
  carousel: carousel.CarouselState
  tabs: tabs.TabsState
  pagination: pagination.PaginationState
}

type Msg =
  | { type: 'carousel'; msg: carousel.CarouselMsg }
  | { type: 'tabs'; msg: tabs.TabsMsg }
  | { type: 'pagination'; msg: pagination.PaginationMsg }

interface Directions {
  readonly carousel?: 'ltr' | 'rtl'
  readonly tabs?: 'ltr' | 'rtl'
  readonly pagination?: 'ltr' | 'rtl'
}

let app: ReturnType<typeof mountApp<State, Msg>> | null = null

afterEach(() => {
  app?.dispose()
  app = null
  document.body.replaceChildren()
})

function mount(
  ancestors: Required<Directions>,
  configured: Directions = {},
  placeDirectionSync = true,
): {
  host: HTMLElement
  send: (msg: Msg) => void
  state: () => State
} {
  const host = document.createElement('div')
  document.body.append(host)
  let sendRef!: (msg: Msg) => void
  const withDir = (dir: 'ltr' | 'rtl' | undefined): { dir?: 'ltr' | 'rtl' } =>
    dir === undefined ? {} : { dir }
  const definition = component<State, Msg>({
    name: 'MountedDirectionSyncContract',
    init: () => [
      {
        carousel: carousel.init({ count: 3, current: 1, ...withDir(configured.carousel) }),
        tabs: tabs.init({
          items: ['a', 'b', 'c'],
          value: 'b',
          ...withDir(configured.tabs),
        }),
        pagination: pagination.init({
          page: 2,
          pageSize: 10,
          total: 30,
          ...withDir(configured.pagination),
        }),
      },
      [],
    ],
    update: (state, msg) => {
      if (msg.type === 'carousel') {
        return [{ ...state, carousel: carousel.update(state.carousel, msg.msg)[0] }, []]
      }
      if (msg.type === 'tabs') {
        return [{ ...state, tabs: tabs.update(state.tabs, msg.msg)[0] }, []]
      }
      return [{ ...state, pagination: pagination.update(state.pagination, msg.msg)[0] }, []]
    },
    view: ({ state, send }): readonly Mountable[] => {
      sendRef = send
      const car = carousel.connect(state.at('carousel'), (msg) => send({ type: 'carousel', msg }), {
        id: 'direction-carousel',
      })
      const tab = tabs.connect(state.at('tabs'), (msg) => send({ type: 'tabs', msg }), {
        id: 'direction-tabs',
      })
      const page = pagination.connect(
        state.at('pagination'),
        (msg) => send({ type: 'pagination', msg }),
        { id: 'direction-pagination' },
      )
      return [
        div({ id: 'carousel-ancestor', dir: ancestors.carousel }, [
          div({ ...car.root }, [
            ...(placeDirectionSync ? [car.directionSync] : []),
            div(
              { ...car.indicatorGroup },
              [0, 1, 2].map((index) => button({ ...car.slide(index).indicator })),
            ),
          ]),
        ]),
        div({ id: 'tabs-ancestor', dir: ancestors.tabs }, [
          div({ ...tab.root }, [
            ...(placeDirectionSync ? [tab.directionSync] : []),
            div(
              { ...tab.list },
              ['a', 'b', 'c'].map((value) => button({ ...tab.item(value).trigger }, [text(value)])),
            ),
          ]),
        ]),
        div({ id: 'pagination-ancestor', dir: ancestors.pagination }, [
          div({ ...page.root }, [
            ...(placeDirectionSync ? [page.directionSync] : []),
            button({ ...page.prevTrigger }, [text('Previous')]),
            ...[1, 2, 3].map((value) => button({ ...page.item(value) }, [text(String(value))])),
            button({ ...page.nextTrigger }, [text('Next')]),
          ]),
        ]),
      ]
    },
  })
  app = mountApp(host, definition)
  return { host, send: (msg) => sendRef(msg), state: () => app!.getState() }
}

function control(
  host: HTMLElement,
  rootId: string,
  part: string,
  value: string,
): HTMLButtonElement {
  return host.querySelector(
    `#${rootId} [data-part="${part}"][data-${part === 'indicator' ? 'index' : 'value'}="${value}"]`,
  ) as HTMLButtonElement
}

function press(target: HTMLButtonElement, key: string): void {
  target.focus()
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

async function expectDirections(expected: Required<Directions>): Promise<void> {
  await vi.waitFor(() => {
    expect(app!.getState().carousel.dir).toBe(expected.carousel)
    expect(app!.getState().tabs.dir).toBe(expected.tabs)
    expect(app!.getState().pagination.dir).toBe(expected.pagination)
  })
}

describe('shared mounted direction synchronization', () => {
  it('follows each initial ancestor independently and drives actual keyboard behavior', async () => {
    const mounted = mount({ carousel: 'rtl', tabs: 'ltr', pagination: 'rtl' })
    await expectDirections({ carousel: 'rtl', tabs: 'ltr', pagination: 'rtl' })

    press(control(mounted.host, 'direction-carousel', 'indicator', '1'), 'ArrowRight')
    expect(document.activeElement).toBe(
      control(mounted.host, 'direction-carousel', 'indicator', '0'),
    )
    press(control(mounted.host, 'direction-tabs', 'trigger', 'b'), 'ArrowRight')
    expect(document.activeElement).toBe(control(mounted.host, 'direction-tabs', 'trigger', 'c'))
    press(control(mounted.host, 'direction-pagination', 'item', '2'), 'ArrowRight')
    expect(document.activeElement).toBe(control(mounted.host, 'direction-pagination', 'item', '1'))
  })

  it('tracks live changes and relocation without roots crossing signals', async () => {
    const mounted = mount({ carousel: 'ltr', tabs: 'ltr', pagination: 'ltr' })
    await expectDirections({ carousel: 'ltr', tabs: 'ltr', pagination: 'ltr' })
    mounted.host.querySelector('#carousel-ancestor')!.setAttribute('dir', 'rtl')
    mounted.host.querySelector('#pagination-ancestor')!.setAttribute('dir', 'rtl')
    await expectDirections({ carousel: 'rtl', tabs: 'ltr', pagination: 'rtl' })

    const tabsRoot = mounted.host.querySelector('#direction-tabs')!
    mounted.host.querySelector('#carousel-ancestor')!.append(tabsRoot)
    await expectDirections({ carousel: 'rtl', tabs: 'rtl', pagination: 'rtl' })
  })

  it('keeps explicit init and public setDir authoritative', async () => {
    const mounted = mount(
      { carousel: 'rtl', tabs: 'rtl', pagination: 'rtl' },
      { carousel: 'ltr', tabs: 'ltr', pagination: 'ltr' },
    )
    await expectDirections({ carousel: 'ltr', tabs: 'ltr', pagination: 'ltr' })
    mounted.send({ type: 'carousel', msg: { type: 'setDir', dir: 'rtl' } })
    mounted.send({ type: 'tabs', msg: { type: 'setDir', dir: 'rtl' } })
    mounted.send({ type: 'pagination', msg: { type: 'setDir', dir: 'rtl' } })
    mounted.host.querySelectorAll('[dir]').forEach((element) => element.setAttribute('dir', 'ltr'))
    await expectDirections({ carousel: 'rtl', tabs: 'rtl', pagination: 'rtl' })
  })

  it('resolves same-tick keyboard direction even when lifecycle Mountables are omitted', () => {
    const mounted = mount({ carousel: 'ltr', tabs: 'ltr', pagination: 'ltr' }, {}, false)
    mounted.host.querySelector('#carousel-ancestor')!.setAttribute('dir', 'rtl')
    mounted.host.querySelector('#tabs-ancestor')!.setAttribute('dir', 'rtl')
    mounted.host.querySelector('#pagination-ancestor')!.setAttribute('dir', 'rtl')

    press(control(mounted.host, 'direction-carousel', 'indicator', '1'), 'ArrowRight')
    expect(document.activeElement).toBe(
      control(mounted.host, 'direction-carousel', 'indicator', '0'),
    )
    press(control(mounted.host, 'direction-tabs', 'trigger', 'b'), 'ArrowRight')
    expect(document.activeElement).toBe(control(mounted.host, 'direction-tabs', 'trigger', 'a'))
    press(control(mounted.host, 'direction-pagination', 'item', '2'), 'ArrowRight')
    expect(document.activeElement).toBe(control(mounted.host, 'direction-pagination', 'item', '1'))
  })

  it('disconnects every root observer on unmount', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    mount({ carousel: 'ltr', tabs: 'ltr', pagination: 'ltr' })
    app!.dispose()
    app = null
    expect(disconnect).toHaveBeenCalledTimes(3)
    disconnect.mockRestore()
  })
})
