import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { button, component, div, mountApp, onMount, show, text } from '@llui/dom'
import { init, update, connect, overlay, watchSubmenuPositioning } from '../../src/components/menu'
import type { MenuState, MenuMsg } from '../../src/components/menu'

/**
 * Real per-level submenu positioning (#265 finding #7). Before this, the
 * machine's `subPositioner` part carried a HARDCODED style
 * (`position:absolute;top:0;left:0;`) and nothing ever attached real floating
 * geometry to it — a subcontent rendered at the top-left corner of its
 * nearest positioned ancestor regardless of where its subTrigger was, and
 * never flipped at a viewport edge. `watchSubmenuPositioning` anchors each
 * open level's subcontent to its own subTrigger with `attachFloating`
 * (flip/shift live), keyed by DOM presence — a level mounts its
 * subPositioner/subContent only while open (the same synchronous-boolean
 * convention select/combobox/searchable-select already use), so this watcher
 * attaches on mount and detaches (restoring every inline style) the instant a
 * level's node leaves the DOM.
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

type Ctx = { m: MenuState }

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
  document.documentElement.removeAttribute('dir')
})

/** Renders a real item tree: a leaf item, and a submenu with two leaf items,
 * gated the way a synchronous boolean submenu should be — mounted (via
 * `show`) only while its level is a member of `openPath`. */
function makeApp(): { send: (m: MenuMsg) => void } {
  let sendRef!: (m: MenuMsg) => void
  const def = component<Ctx, MenuMsg, never>({
    name: 'SubPositioning',
    init: () => [
      {
        m: init({
          items: [
            { value: 'a', kind: 'action' },
            {
              value: 'sub',
              kind: 'action',
              children: [
                { value: 's1', kind: 'action' },
                { value: 's2', kind: 'action' },
              ],
            },
          ],
          open: true,
          skipAnimations: true,
        }),
      },
      [],
    ],
    update: (state, msg) => {
      const [next] = update(state.m, msg)
      return [{ m: next }, []]
    },
    view: ({ state, send }) => {
      sendRef = send
      const m = state.map((s) => s.m)
      const parts = connect(m, send, { id: 'mn' })
      const isSubOpen = m.map((s) => s.openPath.includes('sub'))
      return [
        button({ ...parts.trigger }, [text('Menu')]),
        overlay({
          state: m,
          send,
          parts,
          content: () => [
            div({ ...parts.content }, [
              onMount((root) => watchSubmenuPositioning(root as HTMLElement)),
              div({ ...parts.item('a').item }, [text('a')]),
              div({ ...parts.subTrigger('sub') }, [text('sub')]),
              show(isSubOpen, () => [
                div({ ...parts.subPositioner('sub') }, [
                  div({ ...parts.subContent('sub') }, [
                    div({ ...parts.item('s1').item }, [text('s1')]),
                    div({ ...parts.item('s2').item }, [text('s2')]),
                  ]),
                ]),
              ]),
            ]),
          ],
        }),
      ]
    },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  currentApp = mountApp(container, def)
  return { send: (m) => sendRef(m) }
}

describe('menu submenu positioning', () => {
  it('anchors an open submenu to its own subTrigger, not the top-left corner', async () => {
    const { send } = makeApp()
    await flush()
    const trigger = document.getElementById('mn:sub:sub:trigger') as HTMLElement
    trigger.getBoundingClientRect = () => rect(100, 40, 60, 20)

    send({ type: 'openSub', value: 'sub' })
    await flush()

    const subContent = document.getElementById('mn:sub:sub:content') as HTMLElement
    expect(subContent).not.toBeNull()
    // computePosition writes a translate() reflecting the anchor's rect —
    // the fixed-corner stub never wrote anything but position/top:0/left:0.
    const positioner = subContent.closest('[data-part="subpositioner"]') as HTMLElement
    expect(positioner.style.transform).toMatch(/translate\(/)
    expect(subContent.getAttribute('data-side')).toBe('right')
  })

  it('flips to the opposite side when there is no room on the preferred side', async () => {
    const { send } = makeApp()
    await flush()
    const trigger = document.getElementById('mn:sub:sub:trigger') as HTMLElement
    // Anchor near the RIGHT edge of a 400px-wide viewport: a 'right-start'
    // submenu of realistic width has nowhere to go but flip left.
    trigger.getBoundingClientRect = () => rect(360, 40, 30, 20)

    send({ type: 'openSub', value: 'sub' })
    await flush()

    const subContent = document.getElementById('mn:sub:sub:content') as HTMLElement
    const positioner = subContent.closest('[data-part="subpositioner"]') as HTMLElement
    Object.defineProperty(positioner, 'offsetWidth', { configurable: true, value: 120 })
    Object.defineProperty(positioner, 'offsetHeight', { configurable: true, value: 80 })
    // Re-trigger a position pass now that the floating element has a size.
    window.dispatchEvent(new Event('resize'))
    await flush()

    expect(subContent.getAttribute('data-side')).toBe('left')
  })

  it('opens to the left under rtl (resolved from the subTrigger, via the shared resolveDir)', async () => {
    document.documentElement.setAttribute('dir', 'rtl')
    const { send } = makeApp()
    await flush()
    const trigger = document.getElementById('mn:sub:sub:trigger') as HTMLElement
    trigger.getBoundingClientRect = () => rect(200, 40, 60, 20)

    send({ type: 'openSub', value: 'sub' })
    await flush()

    const subContent = document.getElementById('mn:sub:sub:content') as HTMLElement
    expect(subContent.getAttribute('data-side')).toBe('left')
  })

  it('detaches and restores inline styles when the level closes (exit cleanup)', async () => {
    const { send } = makeApp()
    await flush()
    const trigger = document.getElementById('mn:sub:sub:trigger') as HTMLElement
    trigger.getBoundingClientRect = () => rect(100, 40, 60, 20)

    send({ type: 'openSub', value: 'sub' })
    await flush()
    const positionerBefore = document.querySelector(
      '[data-part="subpositioner"]',
    ) as HTMLElement | null
    expect(positionerBefore).not.toBeNull()
    expect(positionerBefore!.style.position).toBe('absolute')

    send({ type: 'closeSub' })
    await flush()

    // The synchronous boolean level unmounts entirely; nothing is left attached.
    expect(document.querySelector('[data-part="subpositioner"]')).toBeNull()
    expect(document.querySelector('[data-part="subcontent"]')).toBeNull()
  })

  it('leaves no live listeners behind after several open/close cycles (no leaked autoUpdate)', async () => {
    // A no-op `detach` (never calling attachFloating's disposer) is invisible
    // to a DOM-presence assertion alone, since the level fully unmounts either
    // way — the observable defect is `autoUpdate`'s scroll/resize listeners
    // never being torn down. Count them directly rather than asserting on a
    // private implementation detail of the watcher.
    const { send } = makeApp()
    await flush()
    // Spy only AFTER the root menu's own (one-time, never-closed-in-this-test)
    // `attachFloating` has already registered its listeners — this test is
    // about the SUBMENU level's balance, not the root's.
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    for (let i = 0; i < 3; i++) {
      const trigger = document.getElementById('mn:sub:sub:trigger') as HTMLElement
      trigger.getBoundingClientRect = () => rect(100, 40, 60, 20)
      send({ type: 'openSub', value: 'sub' })
      await flush()
      send({ type: 'closeSub' })
      await flush()
    }

    const added = addSpy.mock.calls.filter((c) => c[0] === 'resize' || c[0] === 'scroll').length
    const removed = removeSpy.mock.calls.filter(
      (c) => c[0] === 'resize' || c[0] === 'scroll',
    ).length
    expect(removed).toBe(added)
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('positions a re-opened level again after it was closed and reopened', async () => {
    const { send } = makeApp()
    await flush()
    let trigger = document.getElementById('mn:sub:sub:trigger') as HTMLElement
    trigger.getBoundingClientRect = () => rect(100, 40, 60, 20)

    send({ type: 'openSub', value: 'sub' })
    await flush()
    send({ type: 'closeSub' })
    await flush()
    send({ type: 'openSub', value: 'sub' })
    await flush()

    trigger = document.getElementById('mn:sub:sub:trigger') as HTMLElement
    trigger.getBoundingClientRect = () => rect(100, 40, 60, 20)
    const subContent = document.getElementById('mn:sub:sub:content') as HTMLElement
    const positioner = subContent.closest('[data-part="subpositioner"]') as HTMLElement
    expect(positioner.style.transform).toMatch(/translate\(/)
  })
})
