import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { button, component, div, mountApp, text } from '@llui/dom'
import { resolveDir } from '@llui/interactions'
import * as menu from '../../src/components/menu'
import type { MenuMsg, MenuState } from '../../src/components/menu'
import * as select from '../../src/components/select'
import type { SelectMsg, SelectState } from '../../src/components/select'

/**
 * #265 finding 6: ONE direction source for a portaled overlay. While a
 * component's direction is automatic (`dirSource: 'dom'`), a floating overlay
 * resolves it from its ANCHOR — the trigger, in the app's own container — not
 * from wherever the portal landed (`<body>`). The engine hands that direction
 * to `attachFloating` AND writes it as `dir` on the floating element, so the
 * whole portaled subtree agrees through the DOM: floating geometry, CSS
 * logical properties, key handlers (`resolveDir(e.currentTarget)`) and nested
 * submenus anchored on subtriggers inside it. `dir="rtl"` is set on an APP
 * CONTAINER here, never on `<html>`: an `<html dir>` reaches `<body>` too and
 * would hide the bug.
 */

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  } as DOMRect
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let currentApp: ReturnType<typeof mountApp> | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: 400,
  })
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    value: 300,
  })
})

afterEach(() => {
  currentApp?.dispose()
  currentApp = null
  document.body.innerHTML = ''
})

/** An app container with its own `dir`, appended to `<body>`. */
function container(dir: 'ltr' | 'rtl'): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('dir', dir)
  document.body.append(el)
  return el
}

function mountMenu(
  host: HTMLElement,
  initDir?: 'ltr' | 'rtl',
): { send: (m: MenuMsg) => void; state: () => MenuState } {
  let sendRef!: (m: MenuMsg) => void
  let latest!: MenuState
  const def = component<{ m: MenuState }, MenuMsg, never>({
    name: 'AnchorDirectionMenu',
    init: () => [
      {
        m: menu.init({
          items: [
            { value: 'a', kind: 'action' },
            { value: 'sub', kind: 'action', children: [{ value: 's1', kind: 'action' }] },
          ],
          open: true,
          skipAnimations: true,
          ...(initDir !== undefined ? { dir: initDir } : {}),
        }),
      },
      [],
    ],
    update: (state, msg) => {
      const [m] = menu.update(state.m, msg)
      latest = m
      return [{ m }, []]
    },
    view: ({ state, send }) => {
      sendRef = send
      const m = state.at('m')
      const parts = menu.connect(m, send, { id: 'dm' })
      return [
        button({ ...parts.trigger }, [text('Menu')]),
        menu.overlay({
          state: m,
          send,
          parts,
          content: () => [
            div({ ...parts.content }, [
              div({ ...parts.item('a').item }, [text('a')]),
              div({ ...parts.subTrigger('sub') }, [text('sub')]),
              menu.subOverlay({
                value: 'sub',
                state: m,
                parts,
                content: () => [
                  div({ ...parts.subContent('sub') }, [
                    div({ ...parts.item('s1').item }, [text('s1')]),
                  ]),
                ],
              }),
            ]),
          ],
        }),
      ]
    },
  })
  currentApp = mountApp(host, def)
  return { send: (m) => sendRef(m), state: () => latest }
}

const menuTrigger = (): HTMLElement => document.getElementById('dm:trigger') as HTMLElement
const menuContent = (): HTMLElement => document.getElementById('dm:content') as HTMLElement
const floatingOf = (content: HTMLElement): HTMLElement =>
  content.closest<HTMLElement>('[data-part="positioner"]') ?? content

/** Give the anchor and the floating content real boxes, then re-run placement. */
async function measure(content: HTMLElement): Promise<void> {
  menuTrigger().getBoundingClientRect = () => rect(100, 40, 60, 20)
  Object.defineProperty(content, 'offsetWidth', { configurable: true, value: 120 })
  Object.defineProperty(content, 'offsetHeight', { configurable: true, value: 60 })
  const floating = floatingOf(content)
  Object.defineProperty(floating, 'offsetWidth', { configurable: true, value: 120 })
  Object.defineProperty(floating, 'offsetHeight', { configurable: true, value: 60 })
  window.dispatchEvent(new Event('resize'))
  await flush()
}

const translateX = (el: HTMLElement): number => {
  const match = /translate\((-?[\d.]+)px/.exec(el.style.transform)
  if (!match) throw new Error(`no transform on ${el.outerHTML}`)
  return Number(match[1])
}

describe('a portaled overlay resolves direction from its anchor (#265 finding 6)', () => {
  it('writes the anchor container direction on the portaled floating element', async () => {
    mountMenu(container('rtl'))
    await flush()
    const content = menuContent()
    // Portaled OUT of the rtl container: without the engine's write, the
    // subtree would resolve to <body>'s ltr.
    expect(content.closest('[dir="rtl"]')).toBe(floatingOf(content))
    expect(floatingOf(content).getAttribute('dir')).toBe('rtl')
    expect(resolveDir(content)).toBe('rtl')
  })

  it('places the floating geometry by the anchor direction (bottom-start aligns to the inline-start edge)', async () => {
    mountMenu(container('rtl'))
    await flush()
    await measure(menuContent())
    // rtl bottom-start: content's RIGHT edge on the trigger's right edge
    // (160 - 120 = 40); ltr would be the trigger's left edge, 100.
    expect(translateX(floatingOf(menuContent()))).toBe(40)

    currentApp?.dispose()
    document.body.innerHTML = ''
    mountMenu(container('ltr'))
    await flush()
    await measure(menuContent())
    expect(translateX(floatingOf(menuContent()))).toBe(100)
  })

  it('reads keys in the anchor direction: ArrowLeft opens a submenu under an rtl container', async () => {
    const { send, state } = mountMenu(container('rtl'))
    await flush()
    send({ type: 'highlight', level: '', value: 'sub' })
    menuContent().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(state().openPath).toEqual([])
    menuContent().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(state().openPath).toEqual(['sub'])
  })

  it('opens a nested submenu to the inline-start side of an rtl container', async () => {
    const { send } = mountMenu(container('rtl'))
    await flush()
    send({ type: 'openSub', value: 'sub' })
    await flush()
    const subTrigger = document.getElementById('dm:sub:sub:trigger') as HTMLElement
    subTrigger.getBoundingClientRect = () => rect(200, 40, 60, 20)
    window.dispatchEvent(new Event('resize'))
    await flush()
    const subContent = document.getElementById('dm:sub:sub:content') as HTMLElement
    expect(resolveDir(subContent)).toBe('rtl')
    expect(subContent.getAttribute('data-side')).toBe('left')
  })

  it('an explicit direction wins over the anchor container', async () => {
    mountMenu(container('rtl'), 'ltr')
    await flush()
    expect(floatingOf(menuContent()).getAttribute('dir')).toBe('ltr')
    await measure(menuContent())
    expect(translateX(floatingOf(menuContent()))).toBe(100)
  })

  it('follows the anchor container when its direction changes while open', async () => {
    const host = container('rtl')
    mountMenu(host)
    await flush()
    expect(floatingOf(menuContent()).getAttribute('dir')).toBe('rtl')
    host.setAttribute('dir', 'ltr')
    await flush()
    expect(floatingOf(menuContent()).getAttribute('dir')).toBe('ltr')
    await measure(menuContent())
    expect(translateX(floatingOf(menuContent()))).toBe(100)
  })

  it('applies to overlays without a direction model of their own (select)', async () => {
    let sendRef!: (m: SelectMsg) => void
    const def = component<{ s: SelectState }, SelectMsg, never>({
      name: 'AnchorDirectionSelect',
      init: () => [{ s: select.init({ items: ['alpha', 'beta'] }) }, []],
      update: (state, msg) => [{ s: select.update(state.s, msg)[0] }, []],
      view: ({ state, send }) => {
        sendRef = send
        const parts = select.connect(state.at('s'), send, { id: 'ds' })
        return [
          button({ ...parts.trigger }, [text('Pick')]),
          select.overlay({
            state: state.at('s'),
            send,
            parts,
            content: () => [div({ ...parts.content }, [])],
          }),
        ]
      },
    })
    currentApp = mountApp(container('rtl'), def)
    sendRef({ type: 'open' })
    await flush()
    const content = document.getElementById('ds:content') as HTMLElement
    expect(floatingOf(content).getAttribute('dir')).toBe('rtl')
  })
})
