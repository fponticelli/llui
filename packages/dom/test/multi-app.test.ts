import { describe, it, expect, afterEach } from 'vitest'
import { component, mountApp } from '../src/index'
import { div } from '../src/elements'
import { _setHmrModule, _getHmrModule } from '../src/mount'
import { enableHmr } from '../src/hmr'
import { show } from '../src/primitives/show'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

describe('multiple mountApp instances', () => {
  type State = { visible: boolean }
  type Msg = { type: 'toggle' }

  function toggleDef(label: string): ComponentDef<State, Msg, never> {
    return {
      name: label,
      init: () => [{ visible: false }, []],
      update: (state) => [{ ...state, visible: !state.visible }, []],
      view: () => [
        ...show<State>({
          when: (s) => s.visible,
          render: (_send) => [text(label)],
        }),
      ],
      __compilerVersion: '__test__',
      __prefixes: [(s) => s.visible],
    }
  }

  it('structural blocks are isolated — toggling one app does not affect another', () => {
    let sendA: (msg: Msg) => void
    let sendB: (msg: Msg) => void

    const defA = toggleDef('A')
    const origViewA = defA.view
    defA.view = (h) => {
      sendA = h.send
      return origViewA(h)
    }

    const defB = toggleDef('B')
    const origViewB = defB.view
    defB.view = (h) => {
      sendB = h.send
      return origViewB(h)
    }

    const containerA = document.createElement('div')
    const containerB = document.createElement('div')
    const handleA = mountApp(containerA, defA)
    const handleB = mountApp(containerB, defB)

    // Both hidden initially
    expect(containerA.textContent).toBe('')
    expect(containerB.textContent).toBe('')

    // Toggle A only
    sendA!({ type: 'toggle' })
    handleA.flush()

    expect(containerA.textContent).toBe('A')
    expect(containerB.textContent).toBe('') // B must be unaffected

    // Toggle B only
    sendB!({ type: 'toggle' })
    handleB.flush()

    expect(containerA.textContent).toBe('A')
    expect(containerB.textContent).toBe('B')

    // Toggle A off
    sendA!({ type: 'toggle' })
    handleA.flush()

    expect(containerA.textContent).toBe('')
    expect(containerB.textContent).toBe('B') // B still unaffected
  })

  // Regression: with HMR enabled, mountApp's fast path used to call
  // replaceComponent(name) on every subsequent mount of the same named
  // component — even when the new container was a fresh node. That
  // re-rendered the already-mounted entry instead of mounting a second
  // instance, so loops like the docs-page chip hydrator only rendered
  // the first chip.
  describe('HMR enabled — same-named component across distinct containers', () => {
    const prior = _getHmrModule()
    afterEach(() => {
      _setHmrModule(prior)
    })

    it('each mountApp call into a distinct container produces a fresh mount', () => {
      enableHmr()

      type S = { label: string }
      const def: ComponentDef<S, never, never, string> = component<S, never, never, string>({
        name: 'ChipDup',
        init: (label) => [{ label }, []],
        update: (s) => [s, []],
        view: () => [div({ class: 'chip' }, [text((s: S) => s.label)])],
        __compilerVersion: '__test__',
        __prefixes: [(s) => s.label],
      })

      const containers: HTMLElement[] = []
      const handles = []
      for (const label of ['d20', '3d6+5', '4d6 drop 1']) {
        const c = document.createElement('span')
        containers.push(c)
        handles.push(mountApp(c, def, label))
      }

      try {
        expect(containers.map((c) => c.textContent)).toEqual(['d20', '3d6+5', '4d6 drop 1'])
        // Each handle reflects its own state slice
        expect(handles.map((h) => (h.getState() as S).label)).toEqual([
          'd20',
          '3d6+5',
          '4d6 drop 1',
        ])
      } finally {
        for (const h of handles) h.dispose()
      }
    })

    it('a second mountApp call into the SAME container still hot-swaps in place', () => {
      enableHmr()

      type S = { n: number }
      const v1: ComponentDef<S, never, never> = component<S, never, never>({
        name: 'SwapMe',
        init: () => [{ n: 7 }, []],
        update: (s) => [s, []],
        view: () => [div({ class: 'v1' }, [text((s: S) => `v1:${s.n}`)])],
        __compilerVersion: '__test__',
        __prefixes: [(s) => s.n],
      })
      const v2: ComponentDef<S, never, never> = component<S, never, never>({
        name: 'SwapMe',
        init: () => [{ n: 0 }, []],
        update: (s) => [s, []],
        view: () => [div({ class: 'v2' }, [text((s: S) => `v2:${s.n}`)])],
        __compilerVersion: '__test__',
        __prefixes: [(s) => s.n],
      })

      const container = document.createElement('div')
      mountApp(container, v1)
      expect(container.textContent).toBe('v1:7')
      // Second call targets the same container — fast path swaps
      // (preserves state, replaces view). No second instance.
      const swapped = mountApp(container, v2)
      expect(container.querySelector('.v1')).toBeNull()
      expect(container.querySelector('.v2')).not.toBeNull()
      expect(container.textContent).toBe('v2:7') // state preserved
      swapped.dispose()
    })
  })
})
