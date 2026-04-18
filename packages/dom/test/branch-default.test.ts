import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { branch } from '../src/primitives/branch'
import { component } from '../src/component'
import { div } from '../src/elements'

describe('branch() default case', () => {
  it('fires default when no case matches', () => {
    type S = { kind: string }
    const Def = component<S, never, never>({
      name: 'Br',
      init: () => [{ kind: 'unknown' }, []],
      update: (s) => [s, []],
      view: () => [
        ...branch<S, never>({
          on: (s) => s.kind,
          cases: {
            a: () => [div({ id: 'case-a' })],
            b: () => [div({ id: 'case-b' })],
          },
          default: () => [div({ id: 'fallback' })],
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(container.querySelector('#fallback')).not.toBeNull()
    expect(container.querySelector('#case-a')).toBeNull()
    handle.dispose()
  })

  it('does not fire default when a case matches', () => {
    type S = { kind: string }
    const Def = component<S, never, never>({
      name: 'Br',
      init: () => [{ kind: 'a' }, []],
      update: (s) => [s, []],
      view: () => [
        ...branch<S, never>({
          on: (s) => s.kind,
          cases: {
            a: () => [div({ id: 'case-a' })],
          },
          default: () => [div({ id: 'fallback' })],
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(container.querySelector('#case-a')).not.toBeNull()
    expect(container.querySelector('#fallback')).toBeNull()
    handle.dispose()
  })

  it('accepts optional cases — default only', () => {
    type S = { epoch: number }
    let buildCount = 0
    const Def = component<S, never, never>({
      name: 'Br',
      init: () => [{ epoch: 0 }, []],
      update: (s) => [s, []],
      view: () => [
        ...branch<S, never>({
          on: (s) => String(s.epoch),
          default: () => {
            buildCount++
            return [div({ id: 'rebuild' })]
          },
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(buildCount).toBe(1)
    expect(container.querySelector('#rebuild')).not.toBeNull()
    handle.dispose()
  })
})
