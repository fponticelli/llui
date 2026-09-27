import { button, component, div, mountApp, text } from '@llui/dom'
import * as menu from '../../src/components/menu.js'

/**
 * Real per-level submenu positioning (#265 A4), proved in REAL Chromium
 * layout — not a mocked `getBoundingClientRect`. Four independent menu
 * instances, each proving one geometry case for the engine-owned
 * `menu.subOverlay`:
 *
 *   - `left`: trigger at the LEFT edge — submenu has room, opens to the
 *     right (un-flipped default).
 *   - `right`: trigger at the RIGHT edge — submenu has nowhere to go on the
 *     preferred side, FLIPS left.
 *   - `rtl`: same right-edge geometry under `<html dir="rtl">` (via an
 *     explicit `init({ dir: 'rtl' })`, mirroring the reducer's own
 *     'explicit wins' contract) — the un-flipped default is LEFT under rtl,
 *     so a trigger with room on the left stays there while a genuinely
 *     cramped one flips right. This proves the RTL mirror of the `right`
 *     case in a real browser, not only in jsdom.
 *   - `bottom`: trigger near the BOTTOM edge — a submenu taller than the
 *     remaining viewport height cannot flip (there is no room on the other
 *     SIDE either, only cross-axis room) and must be kept in view by SHIFT
 *     alone.
 */

type OneMenuState = { m: menu.MenuState }
type OneMenuMsg = { type: 'm'; msg: menu.MenuMsg }

function items(): menu.MenuItem[] {
  return [
    { value: 'a', kind: 'action' },
    {
      value: 'sub',
      kind: 'action',
      children: [
        { value: 's1', kind: 'action' },
        { value: 's2', kind: 'action' },
        { value: 's3', kind: 'action' },
        { value: 's4', kind: 'action' },
        { value: 's5', kind: 'action' },
      ],
    },
  ]
}

function mountOneMenu(containerId: string, idPrefix: string, dir?: 'ltr' | 'rtl'): void {
  const def = component<OneMenuState, OneMenuMsg, never>({
    name: `SubmenuEdgeFlip-${idPrefix}`,
    init: () => [{ m: menu.init({ items: items(), open: true, skipAnimations: true, dir }) }, []],
    update: (state, msg) => {
      const [next] = menu.update(state.m, msg.msg)
      return [{ m: next }, []]
    },
    view: ({ state, send }) => {
      const m = state.map((s) => s.m)
      const msend = (msg: menu.MenuMsg): void => send({ type: 'm', msg })
      const parts = menu.connect(m, msend, { id: idPrefix })
      // `parts.trigger.id` etc are what `menu.overlay`'s own relationship
      // wiring (nested-layer owner, placement anchor) resolves by — spreading
      // an id AFTER them (as an earlier cut of this fixture did) silently
      // overrides the very id the overlay looks up, which stops the overlay
      // from wiring at all. Never override an id a connect() part bag sets.
      return [
        button({ ...parts.trigger }, [text('Menu')]),
        menu.overlay({
          state: m,
          send: msend,
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
                    div({ ...parts.item('s2').item }, [text('s2')]),
                    div({ ...parts.item('s3').item }, [text('s3')]),
                    div({ ...parts.item('s4').item }, [text('s4')]),
                    div({ ...parts.item('s5').item }, [text('s5')]),
                  ]),
                ],
              }),
            ]),
          ],
        }),
      ]
    },
  })
  mountApp(document.getElementById(containerId)!, def)
}

declare global {
  interface Window {
    __submenuEdgeFlipReady: boolean
  }
}

for (const id of ['trigger-left', 'trigger-right', 'trigger-rtl', 'trigger-bottom']) {
  const host = document.createElement('div')
  host.id = id
  document.getElementById('app')!.appendChild(host)
}

mountOneMenu('trigger-left', 'left')
mountOneMenu('trigger-right', 'right')
mountOneMenu('trigger-rtl', 'rtl', 'rtl')
mountOneMenu('trigger-bottom', 'bottom')

window.__submenuEdgeFlipReady = true
