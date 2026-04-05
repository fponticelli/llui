import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountApp, text } from '../src/index'
import type { ComponentDef } from '../src/types'

describe('dev-mode state serializability guard', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  function mount<S>(initial: S): ComponentDef<S, never, never> {
    return {
      name: 'Guard',
      init: () => [initial, []],
      update: (s) => [s, []],
      view: () => [text('ok')],
    }
  }

  function firstWarnMessage(): string {
    return String(warnSpy.mock.calls[0]![0])
  }

  it('does not warn on plain JSON state', () => {
    mountApp(
      document.createElement('div'),
      mount({ count: 0, items: [{ id: 'a' }, { id: 'b' }], meta: { x: 1 } }),
    )
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('warns on Date in state', () => {
    mountApp(document.createElement('div'), mount({ created: new Date() }))
    expect(warnSpy).toHaveBeenCalled()
    expect(firstWarnMessage()).toContain('state.created (Date)')
  })

  it('warns on Map in state', () => {
    mountApp(document.createElement('div'), mount({ lookup: new Map() }))
    expect(warnSpy).toHaveBeenCalled()
    expect(firstWarnMessage()).toContain('Map')
  })

  it('warns on Set in state', () => {
    mountApp(document.createElement('div'), mount({ tags: new Set() }))
    expect(warnSpy).toHaveBeenCalled()
    expect(firstWarnMessage()).toContain('Set')
  })

  it('warns on class instance in state', () => {
    class Counter {
      n = 0
    }
    mountApp(document.createElement('div'), mount({ c: new Counter() }))
    expect(warnSpy).toHaveBeenCalled()
    expect(firstWarnMessage()).toContain('Counter')
  })

  it('warns on function value in state', () => {
    mountApp(document.createElement('div'), mount({ onSelect: () => {} }))
    expect(warnSpy).toHaveBeenCalled()
    expect(firstWarnMessage()).toContain('state.onSelect')
  })

  it('finds the deepest first offender', () => {
    mountApp(document.createElement('div'), mount({ items: [{ id: 'a', when: new Date() }] }))
    expect(warnSpy).toHaveBeenCalled()
    expect(firstWarnMessage()).toContain('state.items[0].when (Date)')
  })

  it('allows nested arrays and plain objects', () => {
    mountApp(
      document.createElement('div'),
      mount({
        matrix: [
          [1, 2, 3],
          [4, 5, 6],
        ],
        users: [{ name: 'alice', tags: ['admin'] }],
      }),
    )
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
