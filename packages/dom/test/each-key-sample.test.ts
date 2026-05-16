/**
 * Originally a repro for: each() with `key` callback that reads sibling
 * state via `sample()` silently fails to render new rows on insert and
 * fails to re-key existing rows when the sibling state changes.
 *
 * After the fix: sample() (and any primitive that needs a render context)
 * called from inside any compiler-tracked accessor — each().key /
 * each().items / branch().on / show().when / child().props / foreign().props
 * / a binding accessor — now throws a targeted error at the first
 * invocation. That happens at initial mount, before the user has a chance
 * to ship the broken pattern.
 *
 * The contract being enforced:
 *   accessors are pure functions of their parameter; sample() is a
 *   construction-time tool only.
 */
import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { each } from '../src/primitives/each'
import { branch } from '../src/primitives/branch'
import { show } from '../src/primitives/show'
import { sample } from '../src/primitives/sample'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import type { ComponentDef } from '../src/types'

type Item = { id: string; label: string }

describe('sample() inside an accessor throws a targeted error', () => {
  it('each().key — fail-fast at mount when sample() is in the key callback', () => {
    type State = { items: Item[]; rev: number }
    const def: ComponentDef<State, never, never> = {
      name: 'List',
      init: () => [{ items: [{ id: '1', label: 'one' }], rev: 0 }, []],
      update: (s) => [s, []],
      view: () =>
        each<State, Item>({
          items: (s) => s.items,
          key: (it) => `${it.id}|${sample<State, number>((s) => s.rev)}`,
          render: ({ item }) => [div([text(item((t) => t.label))])],
        }),
    }
    const container = document.createElement('div')
    expect(() => mountApp(container, def)).toThrow(/inside each\(\)\.key/)
    expect(() => mountApp(container, def)).toThrow(/lift it into the accessor's parameter/)
  })

  it('each().items — sample() inside items accessor also throws at mount', () => {
    type State = { items: Item[]; ns: string }
    const def: ComponentDef<State, never, never> = {
      name: 'List',
      init: () => [{ items: [{ id: '1', label: 'one' }], ns: 'a' }, []],
      update: (s) => [s, []],
      view: () =>
        each<State, Item>({
          // pretending the user wants to read `ns` as a side channel
          items: (_s) => sample<State, Item[]>((s) => s.items),
          key: (it) => it.id,
          render: ({ item }) => [div([text(item((t) => t.label))])],
        }),
    }
    const container = document.createElement('div')
    expect(() => mountApp(container, def)).toThrow(/inside each\(\)\.items/)
  })

  it('branch().on — sample() inside on accessor throws at mount', () => {
    type State = { which: 'a' | 'b'; flag: boolean }
    const def: ComponentDef<State, never, never> = {
      name: 'Branch',
      init: () => [{ which: 'a', flag: false }, []],
      update: (s) => [s, []],
      view: () =>
        branch<State, never>({
          on: (_s) => sample<State, 'a' | 'b'>((s) => s.which),
          cases: { a: () => [div([text(() => 'A')])], b: () => [div([text(() => 'B')])] },
        }),
    }
    const container = document.createElement('div')
    expect(() => mountApp(container, def)).toThrow(/inside branch\(\)\.on/)
  })

  it('show().when — sample() inside when accessor throws at mount', () => {
    type State = { visible: boolean }
    const def: ComponentDef<State, never, never> = {
      name: 'Show',
      init: () => [{ visible: true }, []],
      update: (s) => [s, []],
      view: () =>
        show<State, never>({
          when: (_s) => sample<State, boolean>((s) => s.visible),
          render: () => [div([text(() => 'visible')])],
        }),
    }
    const container = document.createElement('div')
    expect(() => mountApp(container, def)).toThrow(/inside show\(\)\.when/)
  })

  it('binding accessor — sample() inside text(s => …) at update time goes through _onBindingError', async () => {
    type State = { count: number; other: number }
    type Msg = { type: 'tick' }
    const onError = vi.fn()
    const def: ComponentDef<State, Msg, never> = {
      name: 'Bind',
      init: () => [{ count: 0, other: 0 }, []],
      update: (s, m) => [m.type === 'tick' ? { ...s, count: s.count + 1 } : s, []],
      view: ({ text: t }) => [
        // Reads `count` directly (so the binding's mask covers count); the
        // sample() call is the trap. At initial render the parent context is
        // active, so sample() works once at mount; on the first state change
        // Phase 2 calls the accessor again with no render context AND the
        // accessor-stack flag set — the targeted error fires.
        div([t((s: State) => `${s.count}-${sample<State, number>((s2) => s2.other)}`)]),
      ],
      __dirty: (o, n) =>
        (Object.is(o.count, n.count) ? 0 : 1) | (Object.is(o.other, n.other) ? 0 : 2),
    }
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    handle.setOnBindingError(onError)

    sendFn({ type: 'tick' })
    handle.flush()

    expect(onError).toHaveBeenCalled()
    const info = onError.mock.calls[0]![0]
    expect(info.message).toMatch(/inside a binding accessor/)
  })

  it('thrown reconcile surfaces via _onBindingError instead of killing the update', async () => {
    // Defense-in-depth check: a structural primitive that throws during
    // reconcile (here: each().items returns null and the runtime hits the
    // resulting type error) must surface via the error channel rather than
    // dropping the update on the floor and leaving the next blocks unrun.
    type State = { trigger: boolean; items: Item[] }
    type Msg = { type: 'go' }
    const onError = vi.fn()
    const def: ComponentDef<State, Msg, never> = {
      name: 'Boom',
      init: () => [{ trigger: false, items: [{ id: '1', label: 'one' }] }, []],
      update: (s, m) => [m.type === 'go' ? { ...s, trigger: true, items: null as never } : s, []],
      view: () =>
        each<State, Item>({
          items: (s) => s.items,
          key: (it) => it.id,
          render: ({ item }) => [div([text(item((t) => t.label))])],
        }),
    }
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    handle.setOnBindingError(onError)

    sendFn({ type: 'go' })
    expect(() => handle.flush()).not.toThrow()
    expect(onError).toHaveBeenCalled()
    const info = onError.mock.calls[0]![0]
    expect(info.kind).toBe('reconcile')
  })
})
