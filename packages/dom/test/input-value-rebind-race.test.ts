// [characterization] reactive `value` binding on an <input> overwrites
// user-typed text when state loads AFTER typing. This is the bug
// shape the dungeonlogs 2026-05-27 follow-up report described.
//
// Their three minimal repros DIDN'T reproduce because they fired the
// state-load Msg BEFORE the type action — so `binding.lastValue` was
// already in sync with the loaded value when typing started. The
// failure shape is "type-then-load," not "load-then-type."
//
// Sequence under test (mirrors the real failure):
//   1. Mount with state where the value accessor returns "" (entity
//      not yet loaded). `lastValue = ""`, `el.value = ""`.
//   2. Simulate user typing "OldName-edited" via direct DOM mutation
//      + 'input' event (mirrors Playwright fill()'s effect).
//      `el.value = "OldName-edited"`, `lastValue` stays "".
//   3. Send a Msg that loads the entity. Commit fires; accessor now
//      returns "OldName". `"OldName" !== ""` → framework writes
//      `el.value = "OldName"`. TYPED TEXT GONE.
//
// THIS IS CONTROLLED-INPUT SEMANTICS, not a framework bug. Same
// behavior as React's `<input value={x} />`, Vue's `v-model` without
// manual sync, and Solid's `value={signal()}`. The framework writes
// whatever the accessor returns; the contract is that the app keeps
// state in sync via the input event handler.
//
// What's "controlled":
//   `binding.lastValue` tracks WHAT THE BINDING WROTE, not what the
//   DOM currently shows. If the user mutates el.value via the browser,
//   the binding doesn't know. On the next commit, if the accessor
//   returns a value !== lastValue, it writes — overwriting the user's
//   typing. The equality check exists, but it compares against the
//   last bound write, not the current DOM state.
//
// The "fix" is app-level: bind to the in-progress edit buffer when
// the field is dirty, fall back to the persisted value otherwise.
// Documented in the test below.

import { describe, it, expect } from 'vitest'
import { component, mountApp, createView, input } from '../src/index'
import type { View } from '../src/index'

type State = {
  // Mirrors `s.entities[id]?.facts[pred]?.versions[last]?.value` —
  // the persisted value path. Starts undefined ("not yet loaded"),
  // populates after the LOAD msg.
  entity: { name?: string } | undefined
}
type Msg = { type: 'load'; name: string }

const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ entity: undefined }, []],
  update: (s, msg) => {
    if (msg.type === 'load') return [{ entity: { name: msg.name } }, []]
    return [s, []]
  },
  view: (_h: View<State, Msg>) => [
    input({
      class: 'name',
      // Same shape as the consumer's accessor: walks an optional chain,
      // returns "" when anything is missing.
      value: (s) => {
        const v = s.entity?.name
        return v === undefined || v === null ? '' : String(v)
      },
    }),
  ],
  __compilerVersion: '__test__',
  __view: ($send) => createView<State, Msg>($send),
  __prefixes: [(s: State) => s.entity],
})

describe('input value binding under load-after-type race', () => {
  it('overwrites user-typed text when state loads after typing (current behavior)', async () => {
    // Step 1 — mount before the entity has loaded.
    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    await new Promise<void>(queueMicrotask)
    const el = root.querySelector('input.name') as HTMLInputElement
    expect(el).not.toBeNull()
    // Confirm the initial state: the binding wrote "" because the
    // entity wasn't loaded.
    expect(el.value).toBe('')

    // Step 2 — user types. Mirror Playwright fill(): direct el.value
    // mutation + a synthetic 'input' event (jsdom doesn't actually
    // dispatch the browser-side input chain).
    el.value = 'OldName-edited'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    expect(el.value).toBe('OldName-edited')

    // Step 3 — entity load Msg arrives (mimics WS ACK / replica
    // rebuild). Accessor now returns "OldName".
    handle.send({ type: 'load', name: 'OldName' })
    handle.flush()

    // The dungeonlogs failure mode: el.value got reverted to
    // "OldName" — the typed text was destroyed.
    //
    // EXPECTED if the framework is doing what their repros suggest:
    //   el.value === 'OldName-edited'   (binding skipped the write)
    // ACTUAL if the failure is real:
    //   el.value === 'OldName'          (binding wrote, destroyed input)
    //
    // We assert the FAILURE shape and document it. If this turns out
    // to be wrong, this test will FAIL and the symptom is something
    // else — that's the signal we need.
    expect(el.value).toBe('OldName')

    handle.dispose()
    root.remove()
  })

  it('does NOT overwrite when state changes to the same value (sanity counter-test)', async () => {
    // If the framework re-renders WITHOUT changing the underlying
    // value (e.g., entities-rebuild Msg produces new identity but same
    // strings), the equality check should short-circuit and preserve
    // the typed text. This is dungeonlogs's repro #3 ("double arrival")
    // restated; it should NOT fail.
    type S2 = { entity: { name: string } }
    type M2 = { type: 'rebuild' }
    const App2 = component<S2, M2, never>({
      name: 'App2',
      init: () => [{ entity: { name: 'OldName' } }, []],
      update: (s, msg) => {
        if (msg.type === 'rebuild') return [{ entity: { name: s.entity.name } }, []]
        return [s, []]
      },
      view: (_h: View<S2, M2>) => [
        input({
          class: 'name',
          value: (s) => s.entity.name,
        }),
      ],
      __compilerVersion: '__test__',
      __view: ($send) => createView<S2, M2>($send),
      __prefixes: [(s: S2) => s.entity],
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App2)
    await new Promise<void>(queueMicrotask)
    const el = root.querySelector('input.name') as HTMLInputElement
    expect(el.value).toBe('OldName')

    // User types.
    el.value = 'OldName-edited'
    el.dispatchEvent(new Event('input', { bubbles: true }))

    // Rebuild Msg fires; entity identity changes but the name string
    // stays the same. Equality check on the returned string should
    // skip the write.
    handle.send({ type: 'rebuild' })
    handle.flush()

    expect(el.value).toBe('OldName-edited') // typed text preserved
    handle.dispose()
    root.remove()
  })
})
