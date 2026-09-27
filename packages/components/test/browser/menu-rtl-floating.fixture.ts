import { button, component, div, mountApp, text } from '@llui/dom'
import * as menu from '../../src/components/menu.js'

/**
 * #265 A1 — proves, in REAL Chromium layout (`getComputedStyle`'s `direction`
 * is what `@floating-ui/dom`'s default platform reads, and jsdom does not
 * apply the `[dir]` UA rule that makes that meaningful), that a menu's
 * floating placement follows the PAGE's own `dir` with NO opt-in
 * `directionSync` part mounted and NO explicit `setDir` — the exact shape
 * #265 A1 is about. The overlay content is portaled to `document.body`, so
 * direction has to be set on `<html>` (read from `?dir=` before mount),
 * matching where a real page sets it — not on some inner ancestor a
 * portaled node would escape.
 */

type OneMenuState = { m: menu.MenuState }
type OneMenuMsg = { type: 'm'; msg: menu.MenuMsg }

const dir = new URLSearchParams(location.search).get('dir') === 'rtl' ? 'rtl' : 'ltr'
document.documentElement.setAttribute('dir', dir)

function mountOneMenu(): void {
  const def = component<OneMenuState, OneMenuMsg, never>({
    name: 'MenuRtlFloating',
    init: () => [
      {
        m: menu.init({
          items: [{ value: 'a', kind: 'action' }],
          open: true,
          skipAnimations: true,
        }),
      },
      [],
    ],
    update: (state, msg) => {
      const [next] = menu.update(state.m, msg.msg)
      return [{ m: next }, []]
    },
    view: ({ state, send }) => {
      const m = state.map((s) => s.m)
      const msend = (msg: menu.MenuMsg): void => send({ type: 'm', msg })
      // Deliberately no `directionSync` part placed, and no `setDir` ever
      // sent — `dirSource` stays `'dom'` for the whole fixture.
      const parts = menu.connect(m, msend, { id: 'menu' })
      return [
        button({ ...parts.trigger }, [text('Menu')]),
        menu.overlay({
          state: m,
          send: msend,
          parts,
          content: () => [
            div({ ...parts.content }, [div({ ...parts.item('a').item }, [text('a')])]),
          ],
        }),
      ]
    },
  })
  mountApp(document.getElementById('app')!, def)
}

declare global {
  interface Window {
    __menuRtlFloatingReady: boolean
  }
}

mountOneMenu()

window.__menuRtlFloatingReady = true
