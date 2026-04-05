import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { branch } from '../src/primitives/branch'
import { show } from '../src/primitives/show'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import type { ComponentDef } from '../src/types'

describe('branch transitions', () => {
  type State = { phase: 'a' | 'b' }
  type Msg = { type: 'switch' }
  let sendFn: (msg: Msg) => void

  function phaseDef(opts: {
    enter?: (nodes: Node[]) => void
    leave?: (nodes: Node[]) => void | Promise<void>
  }): ComponentDef<State, Msg, never> {
    return {
      name: 'Phase',
      init: () => [{ phase: 'a' }, []],
      update: (state) => [{ ...state, phase: state.phase === 'a' ? 'b' : 'a' }, []],
      view: ({ send }) => {
        sendFn = send
        return branch<State>({
          on: (s) => s.phase,
          cases: {
            a: (_send) => [div({ class: 'arm-a' }, [text('A')])],
            b: (_send) => [div({ class: 'arm-b' }, [text('B')])],
          },
          enter: opts.enter,
          leave: opts.leave,
        })
      },
      __dirty: (o, n) => (Object.is(o.phase, n.phase) ? 0 : 1),
    }
  }

  it('calls enter callback after new nodes are inserted', () => {
    const entered: string[] = []
    const container = document.createElement('div')
    const handle = mountApp(
      container,
      phaseDef({
        enter: (nodes) => {
          entered.push(
            nodes
              .filter((n) => n instanceof Element)
              .map((n) => (n as Element).className)
              .join(','),
          )
        },
      }),
    )

    // Initial mount — enter fires for arm-a
    expect(entered).toEqual(['arm-a'])

    sendFn({ type: 'switch' })
    handle.flush()

    // After switch — enter fires for arm-b
    expect(entered).toEqual(['arm-a', 'arm-b'])
  })

  it('calls leave callback before nodes are removed', () => {
    const left: string[] = []
    const container = document.createElement('div')
    const handle = mountApp(
      container,
      phaseDef({
        leave: (nodes) => {
          left.push(
            nodes
              .filter((n) => n instanceof Element)
              .map((n) => (n as Element).className)
              .join(','),
          )
        },
      }),
    )

    sendFn({ type: 'switch' })
    handle.flush()

    expect(left).toEqual(['arm-a'])
  })

  it('defers node removal until leave Promise resolves', async () => {
    let resolveLeave: () => void
    const container = document.createElement('div')
    const handle = mountApp(
      container,
      phaseDef({
        leave: () =>
          new Promise<void>((r) => {
            resolveLeave = r
          }),
      }),
    )

    expect(container.querySelector('.arm-a')).not.toBeNull()

    sendFn({ type: 'switch' })
    handle.flush()

    // Old nodes still present (leave Promise not resolved)
    expect(container.querySelector('.arm-a')).not.toBeNull()
    // New nodes also present
    expect(container.querySelector('.arm-b')).not.toBeNull()

    resolveLeave!()
    await Promise.resolve()
    await Promise.resolve()

    // Now old nodes removed
    expect(container.querySelector('.arm-a')).toBeNull()
    expect(container.querySelector('.arm-b')).not.toBeNull()
  })
})

describe('show transitions', () => {
  it('calls enter when content appears and leave when it disappears', () => {
    const log: string[] = []
    type State = { visible: boolean }
    type Msg = { type: 'toggle' }
    let sendFn: (msg: Msg) => void

    const def: ComponentDef<State, Msg, never> = {
      name: 'Show',
      init: () => [{ visible: false }, []],
      update: (state) => [{ ...state, visible: !state.visible }, []],
      view: ({ send }) => {
        sendFn = send
        return show<State>({
          when: (s) => s.visible,
          render: (_send) => [div({ class: 'content' }, [text('hi')])],
          enter: () => {
            log.push('enter')
          },
          leave: () => {
            log.push('leave')
          },
        })
      },
      __dirty: (o, n) => (Object.is(o.visible, n.visible) ? 0 : 1),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    // Initially hidden — no enter
    expect(log).toEqual([])

    sendFn!({ type: 'toggle' })
    handle.flush()
    expect(log).toEqual(['enter'])

    sendFn!({ type: 'toggle' })
    handle.flush()
    expect(log).toEqual(['enter', 'leave'])
  })
})
