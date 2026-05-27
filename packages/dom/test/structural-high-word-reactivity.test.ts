// Regression test for an under-fire bug in structural primitives:
// when a `show` / `branch` / `each` block has `mask: FULL_MASK` (the
// runtime fallback when the compiler emitted no `__mask`) and its
// driver field lives in the high word of the dirty bitmap
// (prefix index ≥ 31), the Phase 1 gate
// `(mask & dirty) | (maskHi & dirtyHi)` evaluates to
// `(-1 & 0) | (0 & dirtyHi)` = 0 — the block never reconciles.
//
// Same gate-asymmetry shape as the `__bindUncertain` bug fixed in
// 0.4.8 (53512ad), but for STRUCTURAL blocks instead of bindings. Fix:
// when no `__mask` was emitted at compile time, the runtime defaults
// BOTH `mask` AND `maskHi` to FULL_MASK. When `__mask` IS emitted but
// `__maskHi` isn't, the runtime defaults `maskHi: 0` (the compiler's
// declaration that only low-word fields are read).
//
// Originally reported as a happy-dom-specific regression by an
// external consumer; investigation showed it reproduces under jsdom
// too — env was a red herring. We keep the happy-dom env on this test
// because that's the path the report came in on and exercising an
// alternate DOM impl has incidental value.
//
// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { component, mountApp, createView, div } from '../src/index'
import type { View } from '../src/index'

describe('h.show reactivity when driver lives in the high word of the dirty bitmap', () => {
  it('1. simple: 3 prefixes, show at low-word index → reconciles (baseline)', async () => {
    type S = { a: number; b: number; cursorPickerOpen: boolean }
    type M = { type: 'open' }
    const App = component<S, M, never>({
      name: 'App',
      init: () => [{ a: 0, b: 0, cursorPickerOpen: false }, []],
      update: (s) => [{ ...s, cursorPickerOpen: true }, []],
      view: (h: View<S, M>) => [
        div({ class: 'app' }, [
          ...h.show({
            when: (s) => s.cursorPickerOpen,
            render: () => [div({ role: 'dialog' }, [])],
          }),
        ]),
      ],
      __compilerVersion: '__test__',
      __view: ($send) => createView<S, M>($send),
      __prefixes: [(s: S) => s.a, (s: S) => s.b, (s: S) => s.cursorPickerOpen],
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    await new Promise<void>(queueMicrotask)
    handle.send({ type: 'open' })
    handle.flush()
    expect((root as Element).querySelectorAll('[role="dialog"]').length).toBe(1)
    handle.dispose()
    root.remove()
  })

  it('2. wide: 38 prefixes, show driven by LOW-word field → reconciles', async () => {
    // Two-word `computeDirtyFromPrefixes` path engaged (>31 prefixes).
    type S = { cursorPickerOpen: boolean; pad: number[] }
    type M = { type: 'open' }
    const initS: S = { cursorPickerOpen: false, pad: [] }
    const prefixes: Array<(s: S) => unknown> = [
      (s: S) => s.cursorPickerOpen, // low-word index 0
    ]
    for (let i = 0; i < 37; i++) prefixes.push((s: S) => (s.pad ?? [])[i])
    expect(prefixes.length).toBe(38)

    const App = component<S, M, never>({
      name: 'App',
      init: () => [initS, []],
      update: (s) => [{ ...s, cursorPickerOpen: true }, []],
      view: (h: View<S, M>) => [
        div({ class: 'app' }, [
          ...h.show({
            when: (s) => s.cursorPickerOpen,
            render: () => [div({ role: 'dialog' }, [])],
          }),
        ]),
      ],
      __compilerVersion: '__test__',
      __view: ($send) => createView<S, M>($send),
      __prefixes: prefixes,
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    await new Promise<void>(queueMicrotask)
    handle.send({ type: 'open' })
    handle.flush()
    expect((root as Element).querySelectorAll('[role="dialog"]').length).toBe(1)
    handle.dispose()
    root.remove()
  })

  it('3. wide: 38 prefixes, show driven by HIGH-word field (index 33) → reconciles', async () => {
    // This is the bug. `cursorPickerOpen` lives at prefix index 33 →
    // high-word bit 2. Before the runtime/compiler fixes, the show
    // block's `mask: FULL_MASK, maskHi: 0` produced a Phase 1 gate of
    // `(-1 & 0) | (0 & 4)` = 0 — block never reconciled, dialog never
    // appeared, even though state updated and ticks ran.
    type S = { cursorPickerOpen: boolean; pad: number[] }
    type M = { type: 'open' }
    const initS: S = { cursorPickerOpen: false, pad: [] }
    const prefixes: Array<(s: S) => unknown> = []
    for (let i = 0; i < 33; i++) prefixes.push((s: S) => (s.pad ?? [])[i])
    prefixes.push((s: S) => s.cursorPickerOpen) // index 33 — high-word bit 2
    for (let i = 33; i < 37; i++) prefixes.push((s: S) => (s.pad ?? [])[i])
    expect(prefixes.length).toBe(38)

    const App = component<S, M, never>({
      name: 'App',
      init: () => [initS, []],
      update: (s) => [{ ...s, cursorPickerOpen: true }, []],
      view: (h: View<S, M>) => [
        div({ class: 'app' }, [
          ...h.show({
            when: (s) => s.cursorPickerOpen,
            render: () => [div({ role: 'dialog' }, [])],
          }),
        ]),
      ],
      __compilerVersion: '__test__',
      __view: ($send) => createView<S, M>($send),
      __prefixes: prefixes,
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    await new Promise<void>(queueMicrotask)
    handle.send({ type: 'open' })
    handle.flush()
    expect((handle.getState() as S).cursorPickerOpen).toBe(true)
    expect((root as Element).querySelectorAll('[role="dialog"]').length).toBe(1)
    handle.dispose()
    root.remove()
  })

  it('4. uncompiled element binding reactivity for HIGH-word fields', async () => {
    // The uncompiled fallback in `elements.ts` / svg-elements.ts / etc.
    // creates a binding with `mask: FULL_MASK` and no maskHi. Same
    // gate-asymmetry bug at the binding level — verify the fix at
    // `createBinding`'s default propagates.
    type S = { label: string; pad: number[] }
    type M = { type: 'rename' }
    const initS: S = { label: 'old', pad: [] }
    const prefixes: Array<(s: S) => unknown> = []
    for (let i = 0; i < 33; i++) prefixes.push((s: S) => (s.pad ?? [])[i])
    prefixes.push((s: S) => s.label) // index 33 — high-word bit 2
    expect(prefixes.length).toBe(34)

    const App = component<S, M, never>({
      name: 'App',
      init: () => [initS, []],
      update: (s) => [{ ...s, label: 'new' }, []],
      view: (h: View<S, M>) => [
        // Use `h.text(...)` without a precise mask — the runtime
        // creates a binding with `mask: FULL_MASK`. Pre-fix, the
        // derived maskHi was 0 and high-word `label` changes never
        // updated the text node.
        div({ class: 'lbl' }, [h.text((s) => s.label)]),
      ],
      __compilerVersion: '__test__',
      __view: ($send) => createView<S, M>($send),
      __prefixes: prefixes,
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    await new Promise<void>(queueMicrotask)
    expect(((root as Element).querySelector('.lbl') as Element).textContent).toBe('old')
    handle.send({ type: 'rename' })
    handle.flush()
    expect(((root as Element).querySelector('.lbl') as Element).textContent).toBe('new')
    handle.dispose()
    root.remove()
  })

  it('5. branch driven by HIGH-word field also reconciles (the bug is not show-specific)', async () => {
    // branch is the underlying primitive show wraps; the same default
    // applies. Exercise it directly to lock the broader fix.
    type S = { kind: 'a' | 'b'; pad: number[] }
    type M = { type: 'flip' }
    const initS: S = { kind: 'a', pad: [] }
    const prefixes: Array<(s: S) => unknown> = []
    for (let i = 0; i < 33; i++) prefixes.push((s: S) => (s.pad ?? [])[i])
    prefixes.push((s: S) => s.kind) // index 33 — high-word bit 2
    expect(prefixes.length).toBe(34)

    const App = component<S, M, never>({
      name: 'App',
      init: () => [initS, []],
      update: (s) => [{ ...s, kind: s.kind === 'a' ? 'b' : 'a' }, []],
      view: (h: View<S, M>) => [
        div({ class: 'app' }, [
          ...h.branch<'a' | 'b'>({
            on: (s) => s.kind,
            cases: {
              a: () => [div({ class: 'arm-a' }, [])],
              b: () => [div({ class: 'arm-b' }, [])],
            },
          }),
        ]),
      ],
      __compilerVersion: '__test__',
      __view: ($send) => createView<S, M>($send),
      __prefixes: prefixes,
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    await new Promise<void>(queueMicrotask)
    expect((root as Element).querySelectorAll('.arm-a').length).toBe(1)
    handle.send({ type: 'flip' })
    handle.flush()
    expect((root as Element).querySelectorAll('.arm-a').length).toBe(0)
    expect((root as Element).querySelectorAll('.arm-b').length).toBe(1)
    handle.dispose()
    root.remove()
  })

  it('6. scope driven by HIGH-word field also reconciles', async () => {
    // scope() is sugar over branch() with `cases: {}, default: render`.
    // scope.ts forwards __mask and __maskHi to branch. This locks the
    // forwarding — if a refactor drops the __maskHi pass-through, the
    // branch-only test (variant 5) wouldn't catch it.
    type S = { epoch: number; pad: number[] }
    type M = { type: 'tick' }
    const initS: S = { epoch: 0, pad: [] }
    const prefixes: Array<(s: S) => unknown> = []
    for (let i = 0; i < 33; i++) prefixes.push((s: S) => (s.pad ?? [])[i])
    prefixes.push((s: S) => s.epoch) // index 33 — high-word bit 2
    expect(prefixes.length).toBe(34)

    let renderCalls = 0
    const App = component<S, M, never>({
      name: 'App',
      init: () => [initS, []],
      update: (s) => [{ ...s, epoch: s.epoch + 1 }, []],
      view: (h: View<S, M>) => [
        div({ class: 'app' }, [
          ...h.scope({
            on: (s) => String(s.epoch),
            render: () => {
              renderCalls++
              return [div({ class: 'inner' }, [])]
            },
          }),
        ]),
      ],
      __compilerVersion: '__test__',
      __view: ($send) => createView<S, M>($send),
      __prefixes: prefixes,
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    await new Promise<void>(queueMicrotask)
    expect(renderCalls).toBe(1)
    handle.send({ type: 'tick' })
    handle.flush()
    // scope rebuilds when `on(state)` changes — high-word `epoch` flip
    // must reach the Phase 1 gate so the rebuild fires.
    expect(renderCalls).toBe(2)
    handle.dispose()
    root.remove()
  })
})
