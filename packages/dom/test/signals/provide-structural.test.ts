import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import {
  signalText,
  staticText,
  el,
  createContext,
  provide,
  useContext,
  signalShow,
  signalBranch,
  signalEach,
} from '../../src/signals/dom'

// Regression: `provide()` above a lazily-built structural primitive
// (show/branch/each) must remain visible inside its arms/rows. The arm/row builds
// AFTER provide's synchronous render() returned, so a mutate-and-restore contexts
// map lost the value and useContext saw only the default.
describe('provide → structural arms/rows', () => {
  const Theme = createContext<string>('light')

  it('show arm mounted under provide sees the provided value', () => {
    const container = document.createElement('div')
    mountSignalComponent<{ open: boolean }, { type: 'x' }>(container, {
      init: () => ({ open: true }),
      update: (s) => s,
      view: () => [
        provide(Theme, 'dark', () => [
          signalShow({ produce: (s) => (s as { open: boolean }).open, deps: ['open'] }, () => [
            el('span', { id: 'arm' }, [staticText(useContext(Theme))]),
          ]),
        ]),
      ],
    })
    expect(container.querySelector('#arm')?.textContent).toBe('dark')
  })

  it('branch arm mounted under provide sees the provided value', () => {
    const container = document.createElement('div')
    mountSignalComponent<{ tab: string }, { type: 'x' }>(container, {
      init: () => ({ tab: 'a' }),
      update: (s) => s,
      view: () => [
        provide(Theme, 'dark', () => [
          signalBranch(
            { produce: (s) => (s as { tab: string }).tab, deps: ['tab'] },
            {
              a: () => [el('span', { id: 'arm' }, [staticText(useContext(Theme))])],
            },
          ),
        ]),
      ],
    })
    expect(container.querySelector('#arm')?.textContent).toBe('dark')
  })

  it('each row mounted under provide sees the provided value (incl. rows added on a later reconcile)', () => {
    interface S {
      rows: { id: string }[]
    }
    const container = document.createElement('div')
    const h = mountSignalComponent<S, { type: 'add' }>(container, {
      init: () => ({ rows: [{ id: 'r1' }] }),
      update: (s, m) => (m.type === 'add' ? { rows: [...s.rows, { id: 'r2' }] } : s),
      view: () => [
        provide(Theme, 'dark', () => [
          signalEach<{ id: string }>(
            { items: (s) => (s as S).rows, deps: ['rows'] },
            (t) => t.id,
            () => [el('span', { class: 'row' }, [staticText(useContext(Theme))])],
          ),
        ]),
      ],
    })
    const themesOf = () => Array.from(container.querySelectorAll('.row')).map((n) => n.textContent)
    expect(themesOf()).toEqual(['dark'])
    // A row created on a later reconcile — long after provide's render() returned —
    // must still resolve the provided value.
    h.send({ type: 'add' })
    expect(themesOf()).toEqual(['dark', 'dark'])
  })

  it('a reactive text binding in an arm still reads component state (provide does not disturb state rooting)', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<
      { open: boolean; label: string },
      { type: 'set'; label: string }
    >(container, {
      init: () => ({ open: true, label: 'hi' }),
      update: (s, m) => (m.type === 'set' ? { ...s, label: m.label } : s),
      view: () => [
        provide(Theme, 'dark', () => [
          signalShow({ produce: (s) => (s as { open: boolean }).open, deps: ['open'] }, () => [
            el('span', { id: 'arm' }, [
              staticText(useContext(Theme)),
              staticText(':'),
              signalText((s) => (s as { label: string }).label, ['label']),
            ]),
          ]),
        ]),
      ],
    })
    expect(container.querySelector('#arm')?.textContent).toBe('dark:hi')
    h.send({ type: 'set', label: 'bye' })
    expect(container.querySelector('#arm')?.textContent).toBe('dark:bye')
  })
})
