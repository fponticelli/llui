import { button, component, div, mountApp, onMount, show, text } from '@llui/dom'
import * as menu from '../../src/components/menu.js'
import { watchSubmenuPositioning } from '../../src/components/menu.js'

/**
 * Real per-level submenu positioning (#265 finding 7), proved in REAL
 * Chromium layout — not a mocked `getBoundingClientRect`. Two independent
 * menu instances: one whose trigger sits at the LEFT edge (its submenu has
 * room to open to the right, the un-flipped default), one at the RIGHT edge
 * (its submenu has nowhere to go but flip left). Both wire
 * `watchSubmenuPositioning` from `onMount`, exactly as a consumer would.
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
      ],
    },
  ]
}

function mountOneMenu(containerId: string, idPrefix: string): void {
  const def = component<OneMenuState, OneMenuMsg, never>({
    name: `SubmenuEdgeFlip-${idPrefix}`,
    init: () => [{ m: menu.init({ items: items(), open: true, skipAnimations: true }) }, []],
    update: (state, msg) => {
      const [next] = menu.update(state.m, msg.msg)
      return [{ m: next }, []]
    },
    view: ({ state, send }) => {
      const m = state.map((s) => s.m)
      const msend = (msg: menu.MenuMsg): void => send({ type: 'm', msg })
      const parts = menu.connect(m, msend, { id: idPrefix })
      const isSubOpen = m.map((s) => s.openPath.includes('sub'))
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
  mountApp(document.getElementById(containerId)!, def)
}

declare global {
  interface Window {
    __submenuEdgeFlipReady: boolean
    __openSub: (idPrefix: string) => void
  }
}

const leftHost = document.createElement('div')
leftHost.id = 'trigger-left'
document.getElementById('app')!.appendChild(leftHost)
const rightHost = document.createElement('div')
rightHost.id = 'trigger-right'
document.getElementById('app')!.appendChild(rightHost)

mountOneMenu('trigger-left', 'left')
mountOneMenu('trigger-right', 'right')

// Both menus start with only their top-level open; opening the submenu is
// driven from the test via a real click on the subTrigger (see the .test.ts),
// but expose a fallback direct-send path too for setup convenience.
window.__submenuEdgeFlipReady = true
