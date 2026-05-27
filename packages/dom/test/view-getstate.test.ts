// Tests for `h.getState()` on `View<S, M>` — the sanctioned escape
// hatch for "read current state in an event handler / async callback /
// other context where the render context is not live."
//
// Closes the gap that motivated the dicerun 2026-05-27 "latest-ref
// pattern" report. Pre-fix the View bag had no way to read current
// state imperatively; consumers wrote a class binding that captured
// state into a module-local ref each commit (side effects in an
// accessor — an anti-pattern). With `h.getState()` the same use case
// becomes a one-liner.
//
// Symmetric with `AppHandle.getState()` (same name, same contract,
// state-type-erased return). `sample()` stays the render-time reader;
// `getState()` is the event-time reader. The two cover different
// callsite contexts; both are escape hatches that should be reached
// for only when reactive accessors don't fit.

import { describe, it, expect } from 'vitest'
import { component, mountApp, createView, button, div, text } from '../src/index'
import type { View } from '../src/index'

describe('View<S, M> — h.getState()', () => {
  it('reads the current state when called from an event handler', () => {
    type S = { count: number }
    type M = { type: 'inc' } | { type: 'recordCount'; value: number }
    let recorded: number | null = null

    const App = component<S, M, never>({
      name: 'App',
      init: () => [{ count: 0 }, []],
      update: (s, msg) => {
        if (msg.type === 'inc') return [{ count: s.count + 1 }, []]
        if (msg.type === 'recordCount') {
          recorded = msg.value
          return [s, []]
        }
        return [s, []]
      },
      view: (h: View<S, M>) => [
        div({ class: 'app' }, [
          button(
            {
              class: 'inc',
              onClick: () => h.send({ type: 'inc' }),
            },
            [text('+')],
          ),
          button(
            {
              class: 'snapshot',
              // The pattern under test: read CURRENT state at click-time.
              // Pre-fix this required a module-local latest-ref written
              // from a class binding accessor.
              onClick: () => {
                const current = h.getState()
                h.send({ type: 'recordCount', value: current.count })
              },
            },
            [text('Snapshot')],
          ),
        ]),
      ],
      __compilerVersion: '__test__',
      __view: ($send) => createView<S, M>($send),
      __prefixes: [(s: S) => s.count],
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)

    // Increment three times.
    const inc = root.querySelector('.inc') as HTMLButtonElement
    const snap = root.querySelector('.snapshot') as HTMLButtonElement
    inc.click()
    inc.click()
    inc.click()
    handle.flush()
    expect((handle.getState() as S).count).toBe(3)

    // Now click snapshot — h.getState() inside the handler must read 3.
    snap.click()
    handle.flush()
    expect(recorded).toBe(3)

    handle.dispose()
    root.remove()
  })

  it('always reads the LATEST state, not a stale closure', () => {
    // The handler closure was registered at view-construction. Make
    // sure h.getState() doesn't capture the state-at-construction —
    // it must read live every call.
    type S = { value: string }
    type M = { type: 'set'; value: string } | { type: 'capture' }
    const captures: string[] = []

    const App = component<S, M, never>({
      name: 'App',
      init: () => [{ value: 'initial' }, []],
      update: (s, msg) => {
        if (msg.type === 'set') return [{ value: msg.value }, []]
        if (msg.type === 'capture') {
          captures.push(s.value)
          return [s, []]
        }
        return [s, []]
      },
      view: (h: View<S, M>) => [
        button(
          {
            class: 'cap',
            onClick: () => {
              // Mixed: read state via h.getState(), then dispatch capture.
              const cur = h.getState()
              captures.push(`event-time:${cur.value}`)
              h.send({ type: 'capture' })
            },
          },
          [text('Capture')],
        ),
      ],
      __compilerVersion: '__test__',
      __view: ($send) => createView<S, M>($send),
      __prefixes: [(s: S) => s.value],
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    const cap = root.querySelector('.cap') as HTMLButtonElement

    cap.click()
    handle.flush()
    expect(captures).toEqual(['event-time:initial', 'initial'])

    handle.send({ type: 'set', value: 'updated' })
    handle.flush()
    captures.length = 0

    cap.click()
    handle.flush()
    expect(captures).toEqual(['event-time:updated', 'updated'])

    handle.dispose()
    root.remove()
  })

  it('works from async callbacks (setTimeout, Promise) after view construction', async () => {
    // The latest-ref pattern was needed precisely because event/async
    // callbacks fire outside the render context. Verify h.getState()
    // works there too.
    type S = { count: number }
    type M = { type: 'inc' }
    let asyncRead: number | null = null

    const App = component<S, M, never>({
      name: 'App',
      init: () => [{ count: 0 }, []],
      update: (s) => [{ count: s.count + 1 }, []],
      view: (h: View<S, M>) => [
        button(
          {
            class: 'go',
            onClick: () => {
              // Schedule an async read AFTER the click handler returns.
              setTimeout(() => {
                asyncRead = h.getState().count
              }, 0)
            },
          },
          [text('Go')],
        ),
      ],
      __compilerVersion: '__test__',
      __view: ($send) => createView<S, M>($send),
      __prefixes: [(s: S) => s.count],
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    const go = root.querySelector('.go') as HTMLButtonElement

    handle.send({ type: 'inc' })
    handle.send({ type: 'inc' })
    handle.flush()
    expect((handle.getState() as S).count).toBe(2)

    go.click()
    // Wait for the async read to fire.
    await new Promise((r) => setTimeout(r, 5))
    expect(asyncRead).toBe(2)

    handle.dispose()
    root.remove()
  })
})
