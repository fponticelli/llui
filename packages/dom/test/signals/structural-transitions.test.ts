import { describe, it, expect, vi } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import {
  signalText,
  el,
  signalShow,
  signalBranch,
  signalEach,
  onMount,
  type RowCtx,
} from '../../src/signals/dom'
import type { TransitionOptions } from '../../src/types'

// Element-level structural-transition seam: `show`/`branch`/`each` accept the
// `TransitionOptions` bundle `@llui/transitions` produces (enter / leave /
// onTransition) and actually drive it. These tests use fake spies (no real CSS
// animation): `enter` fires post-mount on connected nodes; a `leave` returning a
// pending promise DEFERS detachment until it resolves; an interrupted leave
// (toggle back) supersedes cleanly with no double-teardown and no leaked nodes;
// `each` hands `onTransition` the right entering/leaving/parent; a row removed
// then re-added mid-leave resurrects the SAME node; and — critically — the
// no-transition path stays synchronous (byte-identical to today).

/** A controllable `leave` hook: records each call's nodes and hands back a
 * pending promise per call. `resolveAll()` settles every outstanding promise. */
function makeLeave() {
  const resolvers: Array<() => void> = []
  const calls: Node[][] = []
  const leave = (nodes: Node[]): Promise<void> => {
    calls.push(nodes)
    return new Promise<void>((r) => resolvers.push(r))
  }
  return {
    leave,
    calls,
    resolveAll: () => resolvers.splice(0).forEach((r) => r()),
  }
}

/** Flush the microtask/task queue so `.then` deferrals run. */
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0))

// ── show ────────────────────────────────────────────────────────────
interface ShowS {
  open: boolean
  name: string
}
type ShowM = { type: 'toggle' } | { type: 'rename'; v: string }

function showSetup(initial: ShowS, transition?: TransitionOptions, withCleanup?: () => void) {
  const container = document.createElement('div')
  const h = mountSignalComponent<ShowS, ShowM>(container, {
    init: () => initial,
    update: (s, m) => (m.type === 'toggle' ? { ...s, open: !s.open } : { ...s, name: m.v }),
    view: () => [
      el('div', {}, [
        signalShow(
          { produce: (s) => (s as ShowS).open, deps: ['open'] },
          () => [
            el('p', {}, [
              signalText((s) => (s as ShowS).name, ['name']),
              ...(withCleanup ? [onMount(() => () => withCleanup())] : []),
            ]),
          ],
          undefined,
          transition,
        ),
      ]),
    ],
  })
  return { h, root: container.querySelector('div')! }
}

describe('show — enter/leave transitions', () => {
  it('enter fires post-mount with the arm nodes already connected', () => {
    const enter = vi.fn()
    const { root } = showSetup({ open: true, name: 'ada' }, { enter })
    expect(enter).toHaveBeenCalledTimes(1)
    const nodes = enter.mock.calls[0]![0] as Node[]
    expect(nodes[0]).toBe(root.querySelector('p'))
    expect(root.contains(nodes[0] as Node)).toBe(true)
  })

  it('enter fires on a false→true toggle (not just initial mount)', () => {
    const enter = vi.fn()
    const { h, root } = showSetup({ open: false, name: 'ada' }, { enter })
    expect(enter).toHaveBeenCalledTimes(0)
    h.send({ type: 'toggle' })
    expect(enter).toHaveBeenCalledTimes(1)
    expect((enter.mock.calls[0]![0] as Node[])[0]).toBe(root.querySelector('p'))
  })

  it('leave defers detachment until its promise resolves', async () => {
    const { leave, calls, resolveAll } = makeLeave()
    const { h, root } = showSetup({ open: true, name: 'ada' }, { leave })
    const p = root.querySelector('p')!
    h.send({ type: 'toggle' }) // open → false
    expect(calls.length).toBe(1)
    expect(root.querySelector('p')).toBe(p) // STILL in the DOM — detach deferred
    resolveAll()
    await flush()
    expect(root.querySelector('p')).toBeNull() // now detached
  })

  it('an interrupted leave (toggle back) supersedes cleanly — no double-teardown, no leak', async () => {
    const { leave, resolveAll } = makeLeave()
    const cleanup = vi.fn()
    const { h, root } = showSetup({ open: true, name: 'ada' }, { leave }, cleanup)
    const p1 = root.querySelector('p')!
    h.send({ type: 'toggle' }) // → false: p1 starts leaving (pending)
    expect(root.querySelector('p')).toBe(p1)
    expect(cleanup).toHaveBeenCalledTimes(0) // teardown deferred

    h.send({ type: 'toggle' }) // → true BEFORE p1's leave resolves: supersede
    expect(root.querySelectorAll('p').length).toBe(1) // exactly one arm
    const p2 = root.querySelector('p')!
    expect(p2).not.toBe(p1) // fresh arm mounted
    expect(root.contains(p1)).toBe(false) // superseded p1 detached
    expect(cleanup).toHaveBeenCalledTimes(1) // p1 torn down exactly once

    // The stale p1 leave now resolves — must be a no-op (finalized guard).
    resolveAll()
    await flush()
    expect(root.querySelectorAll('p').length).toBe(1)
    expect(root.querySelector('p')).toBe(p2)
    expect(cleanup).toHaveBeenCalledTimes(1) // still once — no double-teardown
  })

  it('dispose finalizes an in-flight leave synchronously (no leak past unmount)', () => {
    const { leave } = makeLeave()
    const cleanup = vi.fn()
    const { h, root } = showSetup({ open: true, name: 'ada' }, { leave }, cleanup)
    const p = root.querySelector('p')!
    h.send({ type: 'toggle' }) // p leaving (pending)
    expect(root.contains(p)).toBe(true)
    h.dispose()
    expect(root.contains(p)).toBe(false) // detached on dispose despite unresolved leave
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('no-transition path stays synchronous (byte-identical control)', () => {
    const { h, root } = showSetup({ open: true, name: 'ada' })
    expect(root.querySelector('p')).not.toBeNull()
    h.send({ type: 'toggle' })
    expect(root.querySelector('p')).toBeNull() // removed immediately, no deferral
  })
})

// ── branch ──────────────────────────────────────────────────────────
interface BranchS {
  tab: 'a' | 'b'
}
type BranchM = { type: 'go'; tab: 'a' | 'b' }

function branchSetup(initial: BranchS, transition?: TransitionOptions) {
  const container = document.createElement('div')
  const h = mountSignalComponent<BranchS, BranchM>(container, {
    init: () => initial,
    update: (_s, m) => ({ tab: m.tab }),
    view: () => [
      el('div', {}, [
        signalBranch(
          { produce: (s) => (s as BranchS).tab, deps: ['tab'] },
          {
            a: () => [el('section', { class: 'a' }, [])],
            b: () => [el('section', { class: 'b' }, [])],
          },
          transition,
        ),
      ]),
    ],
  })
  return { h, root: container.querySelector('div')! }
}

describe('branch — enter/leave transitions', () => {
  it('enter fires on the swapped-in arm; leave defers the swapped-out arm', async () => {
    const enter = vi.fn()
    const { leave, calls, resolveAll } = makeLeave()
    const { h, root } = branchSetup({ tab: 'a' }, { enter, leave })
    expect(enter).toHaveBeenCalledTimes(1) // arm 'a' entered on mount
    const armA = root.querySelector('section.a')!

    h.send({ type: 'go', tab: 'b' })
    expect(enter).toHaveBeenCalledTimes(2) // arm 'b' entered
    expect(calls.length).toBe(1) // arm 'a' leaving
    expect(root.querySelector('section.a')).toBe(armA) // still present (deferred)
    expect(root.querySelector('section.b')).not.toBeNull()

    resolveAll()
    await flush()
    expect(root.querySelector('section.a')).toBeNull() // detached after resolve
    expect(root.querySelector('section.b')).not.toBeNull()
  })
})

// ── each ────────────────────────────────────────────────────────────
interface Todo {
  id: number
  title: string
}
interface EachS {
  todos: Todo[]
}
type EachM = { type: 'set'; todos: Todo[] }

function eachSetup(initial: Todo[], transition?: TransitionOptions) {
  const container = document.createElement('div')
  const h = mountSignalComponent<EachS, EachM>(container, {
    init: () => ({ todos: initial }),
    update: (_s, m) => ({ todos: m.todos }),
    view: () => [
      el('ul', {}, [
        signalEach<Todo>(
          { items: (s) => (s as EachS).todos, deps: ['todos'] },
          (t) => t.id,
          () => [
            el('li', {}, [
              signalText((ctx) => ((ctx as RowCtx<Todo>).item as Todo).title, ['item.title']),
            ]),
          ],
          undefined,
          transition,
        ),
      ]),
    ],
  })
  return { h, ul: container.querySelector('ul')! }
}

const lis = (ul: Element): HTMLLIElement[] => Array.from(ul.querySelectorAll('li'))

describe('each — enter/leave/onTransition transitions', () => {
  it('enter fires on freshly-created rows (post-insert, connected)', () => {
    const enter = vi.fn()
    const { h, ul } = eachSetup([{ id: 1, title: 'a' }], { enter })
    expect(enter).toHaveBeenCalledTimes(1) // one entering row on mount
    const first = enter.mock.calls[0]![0] as Node[]
    expect(first[0]).toBe(ul.querySelector('li'))
    expect(ul.contains(first[0] as Node)).toBe(true)

    h.send({
      type: 'set',
      todos: [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ],
    })
    expect(enter).toHaveBeenCalledTimes(2) // only the NEW row enters
    const second = enter.mock.calls[1]![0] as Node[]
    expect(second.length).toBe(1)
    expect(second[0]).toBe(lis(ul)[1])
  })

  it('leave defers a removed row until its promise resolves', async () => {
    const { leave, calls, resolveAll } = makeLeave()
    const { h, ul } = eachSetup(
      [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ],
      { leave },
    )
    const li2 = lis(ul)[1]!
    h.send({ type: 'set', todos: [{ id: 1, title: 'a' }] }) // remove id2
    expect(calls.length).toBe(1)
    expect(lis(ul).length).toBe(2) // li2 still present — deferred
    expect(li2.parentNode).toBe(ul)
    resolveAll()
    await flush()
    expect(lis(ul).length).toBe(1)
    expect(li2.parentNode).toBeNull()
  })

  it('onTransition receives the right entering / leaving / parent', () => {
    const onTransition = vi.fn()
    // leave returns void → detach immediately (the flip pattern), so onTransition
    // still gets the leaving nodes captured before removal.
    const { h, ul } = eachSetup(
      [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ],
      {
        onTransition,
        leave: () => {},
      },
    )
    // initial mount: both rows entering
    const mountCtx = onTransition.mock.calls[0]![0]
    expect(mountCtx.entering.length).toBe(2)
    expect(mountCtx.leaving.length).toBe(0)
    expect(mountCtx.parent).toBe(ul)

    // add a row → entering [li3], leaving []
    h.send({
      type: 'set',
      todos: [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
        { id: 3, title: 'c' },
      ],
    })
    const addCtx = onTransition.mock.calls.at(-1)![0]
    expect(addCtx.entering.length).toBe(1)
    expect(addCtx.leaving.length).toBe(0)
    expect(addCtx.parent).toBe(ul)

    // remove id2 → entering [], leaving [li2]
    h.send({
      type: 'set',
      todos: [
        { id: 1, title: 'a' },
        { id: 3, title: 'c' },
      ],
    })
    const remCtx = onTransition.mock.calls.at(-1)![0]
    expect(remCtx.entering.length).toBe(0)
    expect(remCtx.leaving.length).toBe(1)
    expect(remCtx.parent).toBe(ul)
  })

  it('a row removed then re-added mid-leave resurrects the SAME node', async () => {
    const { leave, resolveAll } = makeLeave()
    const { h, ul } = eachSetup(
      [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ],
      { leave },
    )
    const li2 = lis(ul)[1]!

    h.send({ type: 'set', todos: [{ id: 1, title: 'a' }] }) // remove id2 → leaving
    expect(lis(ul).length).toBe(2)
    expect(li2.parentNode).toBe(ul)

    h.send({
      type: 'set',
      todos: [
        { id: 1, title: 'a' },
        { id: 2, title: 'B2' },
      ],
    }) // re-add
    expect(lis(ul).length).toBe(2)
    expect(lis(ul)[1]).toBe(li2) // SAME node resurrected, not recreated
    expect(li2.textContent).toBe('B2') // and updated to the new item

    // the stale leave now resolves — must be a no-op (row was resurrected)
    resolveAll()
    await flush()
    expect(lis(ul).length).toBe(2)
    expect(lis(ul)[1]).toBe(li2) // still there — not detached by the stale leave
  })

  it('resurrection re-invokes enter to reverse the interrupted leave', () => {
    const { leave } = makeLeave()
    const enter = vi.fn()
    const { h, ul } = eachSetup(
      [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ],
      { enter, leave },
    )
    const li2 = lis(ul)[1]!
    expect(enter).toHaveBeenCalledTimes(1) // both rows entered together on mount
    h.send({ type: 'set', todos: [{ id: 1, title: 'a' }] }) // remove id2 → leaving
    const before = enter.mock.calls.length
    h.send({
      type: 'set',
      todos: [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ],
    }) // resurrect
    expect(enter.mock.calls.length).toBe(before + 1)
    expect((enter.mock.calls.at(-1)![0] as Node[])[0]).toBe(li2)
  })

  it('clearing to empty defers every row when a leave hook is set', async () => {
    const { leave, calls, resolveAll } = makeLeave()
    const { h, ul } = eachSetup(
      [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ],
      { leave },
    )
    h.send({ type: 'set', todos: [] }) // clear all
    expect(calls.length).toBe(2) // both rows leaving (no bulk range-delete)
    expect(lis(ul).length).toBe(2) // still present — deferred
    resolveAll()
    await flush()
    expect(lis(ul).length).toBe(0)
  })

  it('dispose finalizes in-flight leaving rows synchronously', () => {
    const { leave } = makeLeave()
    const { h, ul } = eachSetup(
      [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ],
      { leave },
    )
    const li2 = lis(ul)[1]!
    h.send({ type: 'set', todos: [{ id: 1, title: 'a' }] }) // leaving
    expect(li2.parentNode).toBe(ul)
    h.dispose()
    expect(li2.parentNode).toBeNull() // detached despite unresolved leave
  })

  it('no-transition path removes rows synchronously (byte-identical control)', () => {
    const { h, ul } = eachSetup([
      { id: 1, title: 'a' },
      { id: 2, title: 'b' },
    ])
    expect(lis(ul).length).toBe(2)
    h.send({ type: 'set', todos: [{ id: 1, title: 'a' }] })
    expect(lis(ul).length).toBe(1) // removed immediately — no deferral
  })
})
