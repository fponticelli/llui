import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { button, component, div, mountApp, text } from '@llui/dom'
import { isInNestedLayer } from '@llui/interactions'
import { init, update, connect, overlay, subOverlay } from '../../src/components/menu'
import type { MenuState, MenuMsg } from '../../src/components/menu'

/**
 * Engine-owned per-level submenu overlays (#265 A4). Before this, the
 * machine's `subPositioner` part carried a HARDCODED style
 * (`position:absolute;top:0;left:0;`) and nothing ever attached real floating
 * geometry to it — a subcontent rendered at the top-left corner of its
 * nearest positioned ancestor regardless of where its subTrigger was, and
 * never flipped at a viewport edge. Each open level is now its own
 * `createOverlay` instance (`menu.subOverlay`), anchored to its own
 * subTrigger with `attachFloating` (flip/shift live), gated by `openPath`
 * membership — a level mounts only while open (the same synchronous-boolean
 * convention select/combobox/searchable-select already use), so opening
 * attaches and closing detaches (restoring every inline style) in the same
 * tick.
 *
 * Floating attaches directly to the resolved `content` element (the
 * `subContent` div) — `createOverlay`'s generic `resolveEls` only recognizes
 * an ancestor carrying `data-part="positioner"`, not this machine's
 * `"subpositioner"`, so `floating === content` here (harmless: `attachFloating`
 * fully owns whichever element it is given, and the outer subpositioner
 * wrapper stays a plain, statically-positioned box the CSS z-index hook still
 * targets).
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
 * gated the way a synchronous boolean submenu should be — mounted only while
 * its level is a member of `openPath`, via `menu.subOverlay`. */
function makeApp(
  initDir?: 'ltr' | 'rtl',
  subOverlayOpts: { flip?: boolean; shift?: boolean } = {},
): { send: (m: MenuMsg) => void } {
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
          dir: initDir,
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
      return [
        button({ ...parts.trigger }, [text('Menu')]),
        overlay({
          state: m,
          send,
          parts,
          content: () => [
            div({ ...parts.content }, [
              div({ ...parts.item('a').item }, [text('a')]),
              div({ ...parts.subTrigger('sub') }, [text('sub')]),
              subOverlay({
                value: 'sub',
                state: m,
                parts,
                flip: subOverlayOpts.flip,
                shift: subOverlayOpts.shift,
                content: () => [
                  div({ ...parts.subContent('sub') }, [
                    div({ ...parts.item('s1').item }, [text('s1')]),
                    div({ ...parts.item('s2').item }, [text('s2')]),
                  ]),
                ],
              }),
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

describe('menu submenu positioning (engine-owned subOverlay)', () => {
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
    expect(subContent.style.transform).toMatch(/translate\(/)
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
    Object.defineProperty(subContent, 'offsetWidth', { configurable: true, value: 120 })
    Object.defineProperty(subContent, 'offsetHeight', { configurable: true, value: 80 })
    // Re-trigger a position pass now that the floating element has a size.
    window.dispatchEvent(new Event('resize'))
    await flush()

    expect(subContent.getAttribute('data-side')).toBe('left')
  })

  it('keeps a level in view via SHIFT when flip cannot rescue it (flip: false isolates the two)', async () => {
    // `flip: false` removes flip's OWN cross-axis alignment-switch rescue
    // (see menu-submenu-edge-flip.browser.test.ts's note on why that alone
    // already keeps its 5-item fixture in view) — with flip off, the side
    // AND the 'start' cross-axis alignment are both fixed, so `shift` is the
    // ONLY mechanism left that can move the submenu back into the viewport.
    const shiftTranslateY = async (shift: boolean | undefined): Promise<number> => {
      currentApp?.dispose()
      document.body.innerHTML = ''
      const { send } = makeApp(undefined, { flip: false, shift })
      await flush()
      const trigger = document.getElementById('mn:sub:sub:trigger') as HTMLElement
      // Near the BOTTOM of the 300px-tall mocked viewport (see `beforeEach`):
      // 'start'-aligned at this top would put the submenu's bottom at 250 +
      // 100 (mocked height below) = 350, forty pixels past the 300px bound.
      trigger.getBoundingClientRect = () => rect(100, 250, 60, 20)

      send({ type: 'openSub', value: 'sub' })
      await flush()
      const subContent = document.getElementById('mn:sub:sub:content') as HTMLElement
      Object.defineProperty(subContent, 'offsetWidth', { configurable: true, value: 120 })
      Object.defineProperty(subContent, 'offsetHeight', { configurable: true, value: 100 })
      window.dispatchEvent(new Event('resize'))
      await flush()

      const match = /translate\(-?[\d.]+px, (-?[\d.]+)px\)/.exec(subContent.style.transform)
      if (!match) throw new Error(`no transform on ${subContent.outerHTML}`)
      return Number(match[1])
    }

    // Default (shift: true): clamped so the submenu's bottom stays within
    // the 300px viewport height (translateY + 100px content height <= 300
    // minus the shift middleware's own padding, i.e. translateY well below
    // the anchor's unclamped top of 250).
    const shifted = await shiftTranslateY(undefined)
    expect(shifted).toBeLessThanOrEqual(200)

    // shift: false: unclamped — the 'start'-aligned y stays at the anchor's
    // own top (250, matching the mocked rect), overflowing the viewport.
    const unshifted = await shiftTranslateY(false)
    expect(unshifted).toBeGreaterThan(200)
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
    const subContentBefore = document.querySelector(
      '[data-part="subcontent"]',
    ) as HTMLElement | null
    expect(subContentBefore).not.toBeNull()
    expect(subContentBefore!.style.position).toBe('absolute')

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
    // private implementation detail of the overlay.
    const { send } = makeApp()
    await flush()
    // Spy only AFTER the root menu's own (persistent, never-closed-in-this-test)
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
    expect(subContent.style.transform).toMatch(/translate\(/)
  })

  it('re-places (flips side) when the direction changes at runtime while the level stays open', async () => {
    const { send } = makeApp()
    await flush()
    const trigger = document.getElementById('mn:sub:sub:trigger') as HTMLElement
    trigger.getBoundingClientRect = () => rect(100, 40, 60, 20)

    send({ type: 'openSub', value: 'sub' })
    await flush()
    const subContent = document.getElementById('mn:sub:sub:content') as HTMLElement
    expect(subContent.getAttribute('data-side')).toBe('right')

    // Flip the WHOLE menu's direction while the submenu stays open (no
    // close/reopen). `attachFloating`'s own `autoUpdate` never re-polls the
    // physical side it was given, so this only re-places correctly if the
    // engine's `reattachKey` marker (dir:dirSource) drives a fresh attach.
    send({ type: 'setDir', dir: 'rtl' })
    await flush()

    expect(subContent.getAttribute('data-side')).toBe('left')
  })

  it('registers the open level as a nested layer owned by its OWN subTrigger (#171, per level)', async () => {
    const { send } = makeApp()
    await flush()
    const trigger = document.getElementById('mn:sub:sub:trigger') as HTMLElement
    trigger.getBoundingClientRect = () => rect(100, 40, 60, 20)

    send({ type: 'openSub', value: 'sub' })
    await flush()

    const subContent = document.getElementById('mn:sub:sub:content') as HTMLElement
    const rootContent = document.getElementById('mn:content') as HTMLElement
    // Nested INSIDE the root menu's own content boundary (its owner, the
    // subTrigger, is rendered inside the root content) — this is what keeps
    // a modal opened over the menu from leaving the submenu un-inert (#171):
    // `setAriaHiddenOutside`'s sweep and `pushFocusTrap`'s extra-container
    // list both consult this same registry via the 'hide'/'focus' aspects.
    expect(isInNestedLayer(subContent, 'hide', rootContent)).toBe(true)
    expect(isInNestedLayer(subContent, 'focus', rootContent)).toBe(true)
    // And 'outside': a click inside the submenu must not read as "outside"
    // the root content (subOverlay declares no `dismiss` of its own, so it
    // registers for 'outside' too — see subOverlay's doc comment).
    expect(isInNestedLayer(subContent, 'outside', rootContent)).toBe(true)
  })
})
