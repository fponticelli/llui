// Regression test for issue #5 follow-up (dungeonlogs report):
// when a structural reconcile or binding accessor throws in dev mode
// AND no `_onBindingError` hook is installed, the runtime must NOT
// silently degrade — it must panic on the next commit with the
// original error + accessor label, so the dev sees a hard throw
// instead of "the UI froze, text bindings keep updating, branch
// swaps stopped committing."

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { component, mountApp, div, button, text, show } from '../src/index'

describe('dev-mode reconcile/binding panic on next commit', () => {
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errSpy.mockRestore()
  })

  interface State {
    n: number
    showBroken: boolean
  }
  type Msg = { type: 'inc' } | { type: 'toggle' }

  function makeApp() {
    return component<State, Msg, never>({
      name: 'PanicApp',
      init: () => [{ n: 0, showBroken: false }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'inc':
            return [{ ...state, n: state.n + 1 }, []]
          case 'toggle':
            return [{ ...state, showBroken: !state.showBroken }, []]
        }
      },
      view: ({ send, text: txt }) => [
        button({ class: 'inc', onClick: () => send({ type: 'inc' }) }),
        button({ class: 'toggle', onClick: () => send({ type: 'toggle' }) }),
        div({ class: 'count' }, [txt((s: State) => String(s.n))]),
        ...show<State>({
          when: (s) => {
            if (s.showBroken) throw new Error('boom: when-accessor')
            return false
          },
          render: () => [div({}, [text('never visible')])],
        }),
      ],
      __compilerVersion: '__test__',
      __prefixes: [(s) => (s as State).n, (s) => (s as State).showBroken],
    })
  }

  it('logs an error with stack on the throwing commit', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, makeApp())
    ;(container.querySelector('.toggle') as HTMLElement).click()
    handle.flush()
    expect(errSpy).toHaveBeenCalled()
    const text0 = errSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n')
    expect(text0).toMatch(/\[llui\] structural reconcile threw/)
    expect(text0).toMatch(/boom: when-accessor/)
    // Stack included in dev console output (was hook-only before the fix).
    expect(text0).toMatch(/when-accessor|show\.when|\.ts:\d+/)
  })

  it('panics on the next commit so the dev sees a hard throw', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, makeApp())
    // First update: throws inside show.when. Logged, queued.
    ;(container.querySelector('.toggle') as HTMLElement).click()
    handle.flush()
    // Second update: pending panic re-thrown.
    expect(() => {
      ;(container.querySelector('.inc') as HTMLElement).click()
      handle.flush()
    }).toThrow(/view is in a degraded state/)
  })

  it('does NOT panic when `_onBindingError` hook is installed', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, makeApp())
    const captured: Array<{ message: string }> = []
    handle.setOnBindingError((info) => captured.push({ message: info.message }))
    ;(container.querySelector('.toggle') as HTMLElement).click()
    handle.flush()
    expect(captured.length).toBe(1)
    expect(captured[0]!.message).toMatch(/boom: when-accessor/)
    // The hook absorbs the error — no panic queued, next commit runs normally.
    ;(container.querySelector('.inc') as HTMLElement).click()
    handle.flush()
    expect(container.querySelector('.count')?.textContent).toBe('1')
  })
})
