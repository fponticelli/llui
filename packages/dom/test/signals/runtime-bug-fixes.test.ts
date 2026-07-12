import { describe, it, expect, beforeEach } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalShow, el, onMount } from '../../src/signals/dom'
import type { TransitionOptions } from '../../src/types'
import { each, div, text, virtualEach } from '../../src/signals/authoring'
import type { Signal } from '../../src/signals/types'
import * as domRoot from '../../src/index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any
beforeEach(() => {
  delete g.__lluiComponents
  delete g.__lluiDebug
})

// ── Finding 1: devtools setState commits under the reentrancy guard ──
describe('finding 1 — devtools setState commit is reentrancy-guarded', () => {
  it('a reentrant send during a setState commit enqueues + drains after (correct order, no throw)', () => {
    interface S {
      open: boolean
      n: number
    }
    type M = { type: 'bump' }
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ open: true, n: 0 }),
      update: (s, m) => (m.type === 'bump' ? { ...s, n: s.n + 1 } : s),
      // The arm's onMount cleanup dispatches a STATE-CHANGING send. When the devtools
      // setState pokes `open: false`, the arm tears down mid-commit and that cleanup
      // re-enters `send` — which must ENQUEUE and drain AFTER the setState commit
      // (the guard), not start a nested drain in the middle of the reconcile. Without
      // the guard the reentrant bump commits + notifies subscribers BEFORE the outer
      // setState commit does, reversing the state-update frames (n:1 before n:0).
      view: ({ send }) => [
        signalShow({ produce: (s) => (s as S).open, deps: ['open'] }, () => [
          el('div', { class: 'arm' }, [onMount(() => () => send({ type: 'bump' }))]),
        ]),
      ],
    })
    expect(container.querySelector('.arm')).not.toBeNull()

    const seen: S[] = []
    h.subscribe((s) => seen.push({ ...s }))

    const api = (globalThis as { __lluiDebug?: { restoreState(s: unknown): void } }).__lluiDebug
    expect(api).toBeDefined()

    // Poke `open: false` (n unchanged) — the reentrant bump fires during the commit.
    expect(() => api!.restoreState({ open: false, n: 0 })).not.toThrow()

    // Subscribers see the setState commit FIRST (open:false, n:0), THEN the drained
    // reentrant bump (n:1) — never the reversed order a nested drain would produce.
    expect(seen).toEqual([
      { open: false, n: 0 },
      { open: false, n: 1 },
    ])
    // Arm gone, and the reentrant bump was applied exactly once.
    expect(container.querySelector('.arm')).toBeNull()
    expect(h.getState()).toEqual({ open: false, n: 1 })
    h.dispose()
  })
})

// ── Finding 2: a leaving show arm is frozen (no updates against deleted state) ──
describe('finding 2 — a leaving arm stops re-evaluating against deleted state', () => {
  it('state going undefined during a leave transition does not throw or mutate the leaving DOM', () => {
    interface S {
      user: { name: string } | null
      tick: number
    }
    type M = { type: 'clear' } | { type: 'tick' }
    // A never-resolving `leave` keeps the arm in its deferred-leave state so we can
    // observe updates that arrive WHILE it is animating out.
    const transition: TransitionOptions = { leave: () => new Promise<void>(() => {}) }
    // The arm holds a text binding that dereferences `user.name` UNGUARDED — if the
    // arm ever re-runs against user=null it throws (`null.name`). The freeze must
    // keep the leaving arm from re-evaluating.
    const container2 = document.createElement('div')
    const h2 = mountSignalComponent<S, M>(container2, {
      init: () => ({ user: { name: 'Alice' }, tick: 0 }),
      update: (s, m) => (m.type === 'clear' ? { ...s, user: null } : { ...s, tick: s.tick + 1 }),
      view: () => [
        signalShow(
          { produce: (s) => (s as S).user, deps: ['user'] },
          () => [
            el('p', { class: 'card' }, [
              // deref user.name — throws if re-run against user=null
              domRoot.signalText((s) => (s as S).user!.name, ['user']),
            ]),
          ],
          undefined,
          transition,
        ),
      ],
    })
    const card = container2.querySelector('.card')!
    expect(card.textContent).toBe('Alice')

    // Toggle user → null: the arm starts leaving (deferred, promise never resolves).
    // Without the freeze the still-registered arm re-runs its `user.name` binding
    // against null and throws out of send(); with the freeze it does not.
    expect(() => h2.send({ type: 'clear' })).not.toThrow()
    // The leaving DOM is untouched (still the old value, not crashed/mutated).
    expect(container2.querySelector('.card')!.textContent).toBe('Alice')

    // A further, unrelated state change must also not reach the frozen arm.
    expect(() => h2.send({ type: 'tick' })).not.toThrow()
    expect(container2.querySelector('.card')!.textContent).toBe('Alice')
    h2.dispose()
  })
})

// ── Finding 3: virtualEach nested in an each row resolves its row-local items ──
describe('finding 3 — a virtualEach items source that is row-local reads the row, not component state', () => {
  interface Child {
    id: number
    label: string
  }
  interface Group {
    id: number
    children: Child[]
  }
  interface S {
    groups: Group[]
  }
  type M = { type: 'relabel'; gid: number; cid: number; label: string }

  function mount() {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({
        groups: [
          {
            id: 1,
            children: [
              { id: 10, label: 'a' },
              { id: 11, label: 'b' },
            ],
          },
          { id: 2, children: [{ id: 20, label: 'c' }] },
        ],
      }),
      update: (s, m) => ({
        groups: s.groups.map((gr) =>
          gr.id === m.gid
            ? {
                ...gr,
                children: gr.children.map((c) => (c.id === m.cid ? { ...c, label: m.label } : c)),
              }
            : gr,
        ),
      }),
      view: ({ state }: { state: Signal<S> }) => [
        each(
          state.map((s) => s.groups),
          {
            key: (gr) => gr.id,
            render: (group) => [
              div({ class: 'group' }, [
                virtualEach<Child>({
                  items: group.at('children'), // ROW-LOCAL items source
                  key: (c) => c.id,
                  itemHeight: 10,
                  containerHeight: 100, // all children fit the window
                  render: (child) => [div({ class: 'child' }, [text(child.map((c) => c.label))])],
                }),
              ]),
            ],
          },
        ),
      ],
    })
    const groups = (): HTMLElement[] => [...container.querySelectorAll('.group')] as HTMLElement[]
    const childrenOf = (i: number): string[] =>
      [...groups()[i]!.querySelectorAll('.child')].map((c) => c.textContent ?? '')
    return { container, h, groups, childrenOf }
  }

  it('renders each row-local child list (not component state)', () => {
    const { groups, childrenOf } = mount()
    expect(groups().length).toBe(2)
    expect(childrenOf(0)).toEqual(['a', 'b'])
    expect(childrenOf(1)).toEqual(['c'])
  })

  it('stays reactive to a row-local child change', () => {
    const { h, childrenOf } = mount()
    h.send({ type: 'relabel', gid: 1, cid: 11, label: 'B!' })
    expect(childrenOf(0)).toEqual(['a', 'B!'])
    expect(childrenOf(1)).toEqual(['c'])
    h.dispose()
  })
})

// ── Finding 4: root barrel does not re-export the installSignalDebug VALUE ──
describe('finding 4 — root barrel hides the devtools value exports', () => {
  it('does not re-export installSignalDebug / startRelay as values', () => {
    expect((domRoot as Record<string, unknown>).installSignalDebug).toBeUndefined()
    expect((domRoot as Record<string, unknown>).startRelay).toBeUndefined()
  })
})

// ── Finding 5: container-mount dispose detaches its nodes ──
describe('finding 5 — disposing a container mount empties the container', () => {
  it('removes the mounted tree, not just teardowns', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<{ x: number }, never>(container, {
      init: () => ({ x: 1 }),
      update: (s) => s,
      view: () => [el('div', { class: 'a' }, []), el('span', { class: 'b' }, [])],
    })
    expect(container.childNodes.length).toBeGreaterThan(0)
    h.dispose()
    expect(container.childNodes.length).toBe(0)
    expect(container.querySelector('.a')).toBeNull()
    expect(container.querySelector('.b')).toBeNull()
  })
})
