/**
 * Sibling repro for `each-rekey-inside-show-loses-dom.test.ts`. The same
 * "Pattern 4 stale-Node[] capture" failure shape also affects
 * `branch()` directly when its Node[] is captured by user code and the
 * branch's wrapper element is later re-built by another ancestor
 * structural primitive's arm swap.
 *
 * Topology: outer `branch()` (gate) wraps a helper that places an inner
 * `branch()`'s Node[] inside its arm wrapper. When the outer gate
 * toggles false → true the wrapper is re-built from the inner branch's
 * stale captured Node[]; only the inner branch's anchor moves into the
 * new wrapper. The inner branch's current arm content stays orphaned
 * unless the runtime's `rebindParent` pass re-attaches it.
 */
import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { branch } from '../src/primitives/branch'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

type State = { gateOpen: boolean; arm: 'A' | 'B' | 'C' }
type Msg = { type: 'set-gate'; open: boolean } | { type: 'set-arm'; arm: 'A' | 'B' | 'C' }

function makeDef(): ComponentDef<State, Msg, never> {
  return {
    name: 'BranchPattern4',
    init: () => [{ gateOpen: false, arm: 'A' }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'set-gate':
          return [{ ...state, gateOpen: msg.open }, []]
        case 'set-arm':
          return [{ ...state, arm: msg.arm }, []]
      }
    },
    view: (h) => {
      // Inner branch constructed at outer-view site (Pattern 4).
      const innerBranchNodes = branch<State, Msg, 'A' | 'B' | 'C'>({
        on: (s) => s.arm,
        cases: {
          A: () => [div({ class: 'arm', 'data-arm': 'A' }, [text(() => 'arm-A')])],
          B: () => [div({ class: 'arm', 'data-arm': 'B' }, [text(() => 'arm-B')])],
          C: () => [div({ class: 'arm', 'data-arm': 'C' }, [text(() => 'arm-C')])],
        },
      })
      return [
        ...h.show({
          when: (s: State) => s.gateOpen,
          render: () => [div({ class: 'wrapper' }, innerBranchNodes)],
        }),
      ]
    },
    __compilerVersion: '__test__',
    __prefixes: [(s) => s.gateOpen, (s) => s.arm],
  }
}

function getArm(container: HTMLElement): string | null {
  const el = container.querySelector('.arm')
  return el ? el.getAttribute('data-arm') : null
}

describe('branch() — Pattern 4 stale Node[] capture', () => {
  it('renders the initial arm when the outer gate opens', () => {
    const def = makeDef()
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)

    sendFn({ type: 'set-gate', open: true })
    handle.flush()

    expect(getArm(container)).toBe('A')
  })

  it('reconciles arm changes while gate is open', () => {
    const def = makeDef()
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)

    sendFn({ type: 'set-gate', open: true })
    handle.flush()
    expect(getArm(container)).toBe('A')

    sendFn({ type: 'set-arm', arm: 'B' })
    handle.flush()
    expect(getArm(container)).toBe('B')
  })

  it('does not lose arm content after gate close/reopen with arm change', () => {
    const def = makeDef()
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)

    sendFn({ type: 'set-gate', open: true })
    handle.flush()
    sendFn({ type: 'set-arm', arm: 'B' })
    handle.flush()
    expect(getArm(container)).toBe('B')

    sendFn({ type: 'set-gate', open: false })
    handle.flush()
    sendFn({ type: 'set-arm', arm: 'C' }) // change arm while gate is closed
    handle.flush()
    sendFn({ type: 'set-gate', open: true })
    handle.flush()

    // After reopening, the current arm 'C' should be visible.
    expect(getArm(container)).toBe('C')
  })

  it('no binding errors during gate / arm churn', () => {
    const def = makeDef()
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const errorSpy = vi.fn()
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    handle.setOnBindingError(errorSpy)

    sendFn({ type: 'set-gate', open: true })
    handle.flush()
    for (const arm of ['B', 'C', 'A', 'B'] as const) {
      sendFn({ type: 'set-gate', open: false })
      handle.flush()
      sendFn({ type: 'set-arm', arm })
      handle.flush()
      sendFn({ type: 'set-gate', open: true })
      handle.flush()
      expect(getArm(container)).toBe(arm)
    }
    const errors = errorSpy.mock.calls.map((c) => (c[0] as { message: string }).message)
    expect(errors, `errors observed: ${JSON.stringify(errors)}`).toHaveLength(0)
  })
})
