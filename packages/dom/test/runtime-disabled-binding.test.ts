import { describe, it, expect } from 'vitest'
import { mountApp, component, div, button, text } from '../src/index'

// Runtime sanity probe for the bug reported in the issue tracker:
// "disabled attribute binding never re-evaluates when accessor is a
// named-function reference (or memo() result)".
//
// These tests exercise the *uncompiled* runtime path (no @llui/vite-plugin
// transform). If they pass, the bug is purely in the compiler — the
// runtime element helpers correctly classify any function-typed value
// as a reactive binding.

describe('runtime disabled binding — function-shaped values', () => {
  type State = { gated: boolean }
  type Msg = { type: 'toggle' }

  function makeApp(disabledAccessor: (s: State) => boolean) {
    return component<State, Msg, never>({
      name: 'App',
      init: () => [{ gated: true }, []],
      update: (state, msg) => {
        if (msg.type === 'toggle') return [{ gated: !state.gated }, []]
        return [state, []]
      },
      view: () => [div([button({ id: 'btn', disabled: disabledAccessor }, [text('btn')])])],
    })
  }

  it('inline arrow at call site — toggles disabled in lockstep', () => {
    const container = document.createElement('div')
    const handle = mountApp(
      container,
      makeApp((s) => s.gated),
    )
    const btn = container.querySelector('#btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    handle.send({ type: 'toggle' })
    handle.flush()
    expect(btn.disabled).toBe(false)
    handle.send({ type: 'toggle' })
    handle.flush()
    expect(btn.disabled).toBe(true)
  })

  it('module-scope const-bound arrow — toggles disabled in lockstep', () => {
    const isGated = (s: State): boolean => s.gated
    const container = document.createElement('div')
    const handle = mountApp(container, makeApp(isGated))
    const btn = container.querySelector('#btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    handle.send({ type: 'toggle' })
    handle.flush()
    expect(btn.disabled).toBe(false)
  })

  it('function declaration — toggles disabled in lockstep', () => {
    function isGated(s: State): boolean {
      return s.gated
    }
    const container = document.createElement('div')
    const handle = mountApp(container, makeApp(isGated))
    const btn = container.querySelector('#btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    handle.send({ type: 'toggle' })
    handle.flush()
    expect(btn.disabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Same bug class — survey of other primitives that may classify accessors
// statically. The runtime must remain correct for function-typed accessors
// regardless of the syntactic shape (inline arrow vs named ref vs memo()).

import { each, show, branch } from '../src/index'

describe('runtime — structural primitives accept function-shaped values', () => {
  type State = { count: number; xs: number[]; mode: 'a' | 'b' }
  type Msg = { type: 'incr' } | { type: 'flip' } | { type: 'push' }

  function makeApp(opts: {
    showWhen: (s: State) => boolean
    branchOn: (s: State) => 'a' | 'b'
    eachItems: (s: State) => number[]
  }) {
    return component<State, Msg, never>({
      name: 'App',
      init: () => [{ count: 0, xs: [10], mode: 'a' }, []],
      update: (s, m) => {
        if (m.type === 'incr') return [{ ...s, count: s.count + 1 }, []]
        if (m.type === 'flip') return [{ ...s, mode: s.mode === 'a' ? 'b' : 'a' }, []]
        if (m.type === 'push') return [{ ...s, xs: [...s.xs, s.count] }, []]
        return [s, []]
      },
      view: () => [
        div([
          show({
            when: opts.showWhen,
            render: () => [div({ id: 'shown' }, [text('shown')])],
          }),
          branch({
            on: opts.branchOn,
            cases: {
              a: () => [div({ id: 'branch-a' }, [text('A')])],
              b: () => [div({ id: 'branch-b' }, [text('B')])],
            },
          }),
          each({
            items: opts.eachItems,
            key: (x) => String(x),
            render: () => [div({ class: 'item' }, [text('item')])],
          }),
        ]),
      ],
    })
  }

  it('show() / branch() / each() with function-decl-shaped accessors all update reactively', () => {
    function whenPos(s: State): boolean {
      return s.count >= 0
    }
    function pickMode(s: State): 'a' | 'b' {
      return s.mode
    }
    function getXs(s: State): number[] {
      return s.xs
    }

    const container = document.createElement('div')
    const handle = mountApp(
      container,
      makeApp({ showWhen: whenPos, branchOn: pickMode, eachItems: getXs }),
    )

    expect(container.querySelector('#shown')).not.toBeNull()
    expect(container.querySelector('#branch-a')).not.toBeNull()
    expect(container.querySelector('#branch-b')).toBeNull()
    expect(container.querySelectorAll('.item').length).toBe(1)

    handle.send({ type: 'flip' })
    handle.flush()
    expect(container.querySelector('#branch-a')).toBeNull()
    expect(container.querySelector('#branch-b')).not.toBeNull()

    handle.send({ type: 'push' })
    handle.flush()
    expect(container.querySelectorAll('.item').length).toBe(2)
  })
})
