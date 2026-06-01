import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { component, div, text } from '../../src/signals/authoring'
import { subApp } from '../../src/signals/escape-hatch'
import type { SignalComponentHandle } from '../../src/signals/component'

// `subApp` mounts an ISOLATED component instance inside a parent's view: its own
// update loop + mask scope, own DOM region at an anchor. Parent state changes do
// NOT touch it; it is driven via its own handle (send/subscribe). Disposing the
// parent disposes the sub-app.

interface ChildState {
  count: number
}
type ChildMsg = { type: 'inc' }
const Child = component<ChildState, ChildMsg>({
  name: 'Child',
  init: () => ({ count: 0 }),
  update: (s, m) => (m.type === 'inc' ? { count: s.count + 1 } : s),
  view: ({ state }) => [div({ class: 'child' }, [text(state.at('count').map((c) => `c${c}`))])],
})

interface ParentState {
  label: string
}
type ParentMsg = { type: 'rename'; v: string }

describe('subApp', () => {
  it('mounts an isolated instance driven by its own handle, disposed with the parent', () => {
    const container = document.createElement('div')
    let childHandle: SignalComponentHandle<ChildState, ChildMsg> | null = null

    const Parent = component<ParentState, ParentMsg>({
      name: 'Parent',
      init: () => ({ label: 'p' }),
      update: (s, m) => (m.type === 'rename' ? { label: m.v } : s),
      view: ({ state }) => [
        div({ class: 'label' }, [text(state.at('label'))]),
        ...subApp<ChildState, ChildMsg>({
          reason: 'test: isolated child loop',
          def: Child,
          onHandle: (h) => {
            childHandle = h
          },
        }),
      ],
    })

    const parent = mountSignalComponent(container, Parent)

    // Child mounted and rendered its own initial state.
    expect(container.querySelector('.child')?.textContent).toBe('c0')
    expect(childHandle).not.toBeNull()

    // Child is driven by ITS OWN handle, independent of the parent.
    childHandle!.send({ type: 'inc' })
    expect(container.querySelector('.child')?.textContent).toBe('c1')

    // A parent update does not disturb the isolated child.
    parent.send({ type: 'rename', v: 'p2' })
    expect(container.querySelector('.label')?.textContent).toBe('p2')
    expect(container.querySelector('.child')?.textContent).toBe('c1')

    // Disposing the parent tears down the sub-app's DOM region.
    parent.dispose()
    expect(container.querySelector('.child')).toBeNull()
  })

  it('seeds the isolated instance via initialState', () => {
    const container = document.createElement('div')
    const Parent = component<ParentState, ParentMsg>({
      init: () => ({ label: 'p' }),
      update: (s) => s,
      view: () => [
        ...subApp<ChildState, ChildMsg>({
          reason: 'test: seeded child',
          def: Child,
          initialState: { count: 7 },
        }),
      ],
    })
    const parent = mountSignalComponent(container, Parent)
    expect(container.querySelector('.child')?.textContent).toBe('c7')
    parent.dispose()
  })
})
