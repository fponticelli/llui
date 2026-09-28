import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { div, span, text, show, branch } from '../../src/signals/authoring'
import { isFrameworkError } from '../../src/signals/framework-error'
import type { MappedSignal, Signal } from '../../src/signals/types'

// A `.map()`/`derived()` signal has no state path, so `.at()` on it is
// unsupported: a type error (`MappedSignal.at: never`) and a runtime throw. A
// `show`/`branch` narrowed param IS its condition handle, so a narrowed param
// over a MAPPED condition is a mapped signal too. The component-gallery shell
// (#267) hit this: its error arm's `v.map((s) => s.message)` was rejected by the
// compiler's `prefer-at-over-map`, and the `.at('message')` it demanded threw.
//
// These pin the runtime half of that contract: the idiomatic `.map` read works
// and stays reactive, and the `.at()` read fails with a branded, actionable error.

type Frame = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string }
interface S {
  frames: Record<string, Frame>
}
type M = { type: 'set'; frame: Frame }

const init = (): S => ({ frames: { a: { status: 'loading' } } })
const update = (s: S, m: M): S => ({ ...s, frames: { ...s.frames, a: m.frame } })

describe('.at() on a mapped signal', () => {
  it('throws a branded LluiFrameworkError naming the path and the .map() read', () => {
    let caught: unknown
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init,
      update,
      view: ({ state }) => {
        const frame = state.at('frames').map((frames) => frames['a']!)
        try {
          // A view helper typed `Signal<T>` can receive a mapped signal (a
          // `MappedSignal<T>` IS a `Signal<T>`), so the call is reachable from
          // well-typed code; reproduce it through that widening.
          const widened: Signal<Frame> = frame
          widened.at('status')
        } catch (err) {
          caught = err
        }
        return [text('ok')]
      },
    })
    expect(isFrameworkError(caught)).toBe(true)
    const message = (caught as Error).message
    expect(message).toContain(".at('status')")
    expect(message).toContain('.map((v) => v.status)')
    expect(message).toContain('BEFORE')
    h.dispose()
  })

  it("throws the same error from a show() arm's narrowed param over a mapped condition", () => {
    const container = document.createElement('div')
    const mount = (): void => {
      mountSignalComponent<S, M>(container, {
        init: () => ({ frames: { a: { status: 'error', message: 'boom' } } }),
        update,
        view: ({ state }) => [
          show(
            state.at('frames').map((frames) => {
              const f = frames['a']!
              return f.status === 'error' ? f : null
            }),
            (failed) => {
              // `failed` is the mapped condition handle; the type says so (see the
              // type test in signal-types.test.ts), widened here to reach the throw.
              const widened: Signal<{ status: 'error'; message: string }> = failed
              return [text(widened.at('message'))]
            },
          ),
        ],
      })
    }
    let caught: unknown
    try {
      mount()
    } catch (err) {
      caught = err
    }
    expect(isFrameworkError(caught)).toBe(true)
    expect((caught as Error).message).toContain('.map((v) => v.message)')
  })
})

describe('the idiomatic read on a narrowed param over a mapped condition', () => {
  it('branch: v.map((e) => e.message) renders, stays reactive, and swaps arms', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init,
      update,
      view: ({ state }) => {
        const frame: MappedSignal<Frame> = state.at('frames').map((frames) => frames['a']!)
        return [
          div([
            branch(frame, (f) => f.status, {
              loading: () => [span({ class: 'loading' }, [text('loading')])],
              ready: () => [span({ class: 'ready' }, [text('ready')])],
              error: (failed) => [span({ class: 'err' }, [text(failed.map((e) => e.message))])],
            }),
          ]),
        ]
      },
    })
    expect(container.querySelector('.loading')).not.toBeNull()

    h.send({ type: 'set', frame: { status: 'error', message: 'first' } })
    expect(container.querySelector('.err')!.textContent).toBe('first')

    // Same arm, new message: the arm's read must re-run (deps are the mapped
    // source's, so the frames change reaches it).
    const errEl = container.querySelector('.err')
    h.send({ type: 'set', frame: { status: 'error', message: 'second' } })
    expect(container.querySelector('.err')).toBe(errEl)
    expect(errEl!.textContent).toBe('second')

    h.send({ type: 'set', frame: { status: 'ready' } })
    expect(container.querySelector('.err')).toBeNull()
    expect(container.querySelector('.ready')).not.toBeNull()
    h.dispose()
  })

  it('show: failed.map((e) => e.message) renders and stays reactive', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init,
      update,
      view: ({ state }) => [
        show(
          state.at('frames').map((frames) => {
            const f = frames['a']!
            return f.status === 'error' ? f : null
          }),
          (failed) => [span({ class: 'err' }, [text(failed.map((e) => e.message))])],
        ),
      ],
    })
    expect(container.querySelector('.err')).toBeNull()
    h.send({ type: 'set', frame: { status: 'error', message: 'one' } })
    expect(container.querySelector('.err')!.textContent).toBe('one')
    h.send({ type: 'set', frame: { status: 'error', message: 'two' } })
    expect(container.querySelector('.err')!.textContent).toBe('two')
    h.dispose()
  })
})
