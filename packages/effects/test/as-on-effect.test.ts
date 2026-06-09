import { describe, it, expect, vi } from 'vitest'
import { handleEffects, asOnEffect } from '../src/index'

// `asOnEffect` adapts an `@llui/effects` chain (`(ctx) => void`, taking
// {effect, send, signal}) to the signal-runtime `onEffect` shape
// (`(effect, {send}) => cleanup`). It owns a component-lifetime AbortController:
// the chain sees its `signal`, and the returned cleanup aborts it (so pending
// http/debounce/interval effects cancel on unmount).

type CustomEffect = { type: 'custom'; data: string } | { type: 'watch' }
type Msg = { type: string; data?: string }

describe('asOnEffect', () => {
  it('dispatches effects through the chain with send', () => {
    const chain = handleEffects<CustomEffect, Msg>().else(({ effect, send }) => {
      if (effect.type === 'custom') send({ type: 'got', data: effect.data })
    })
    const onEffect = asOnEffect(chain)
    const send = vi.fn()
    onEffect({ type: 'custom', data: 'hi' }, { send })
    expect(send).toHaveBeenCalledWith({ type: 'got', data: 'hi' })
  })

  it('returns a cleanup that aborts the chain signal', () => {
    let seen: AbortSignal | null = null
    const chain = handleEffects<CustomEffect, Msg>().else(({ effect, signal }) => {
      if (effect.type === 'watch') seen = signal
    })
    const onEffect = asOnEffect(chain)
    const cleanup = onEffect({ type: 'watch' }, { send: vi.fn() })
    expect(seen).not.toBeNull()
    expect(seen!.aborted).toBe(false)
    cleanup?.()
    expect(seen!.aborted).toBe(true)
  })

  it('shares one signal across dispatches within a single mount', () => {
    const seen: AbortSignal[] = []
    const chain = handleEffects<CustomEffect, Msg>().else(({ signal }) => {
      seen.push(signal)
    })
    const onEffect = asOnEffect(chain)
    onEffect({ type: 'watch' }, { send: vi.fn() })
    onEffect({ type: 'custom', data: 'x' }, { send: vi.fn() })
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1]) // same AbortController for the whole mount
    expect(seen[0]!.aborted).toBe(false)
  })

  // Regression: `asOnEffect(chain)` is evaluated ONCE at the component literal, so
  // the returned `onEffect` (and its AbortController) is a per-DEFINITION singleton
  // reused across every mount of that definition. A client-side re-mount (e.g.
  // @llui/vike disposing + re-mounting a page on SPA nav) must NOT inherit the
  // aborted signal from the prior unmount, or every async effect that guards on
  // `signal.aborted` silently drops its send-back. See the bug report on stale
  // controllers in def-scope closures.
  it('hands a fresh, non-aborted signal to a re-mount after cleanup', () => {
    const seen: AbortSignal[] = []
    const chain = handleEffects<CustomEffect, Msg>().else(({ signal }) => {
      seen.push(signal)
    })
    const onEffect = asOnEffect(chain) // the per-definition singleton

    // Mount 1: dispatch → run cleanup (simulate unmount / SPA nav away).
    const cleanup1 = onEffect({ type: 'watch' }, { send: vi.fn() })
    const firstSignal = seen[0]
    expect(firstSignal!.aborted).toBe(false)
    cleanup1?.()
    expect(firstSignal!.aborted).toBe(true)

    // Mount 2: dispatch on a fresh mount of the SAME definition.
    onEffect({ type: 'watch' }, { send: vi.fn() })
    const secondSignal = seen[1]
    expect(secondSignal).not.toBe(firstSignal) // a brand-new controller…
    expect(secondSignal!.aborted).toBe(false) // …not the dead one
  })

  it('delivers the async send-back on a re-mount (the user-visible symptom)', () => {
    // A chain that mimics an async effect guarding on `signal.aborted` before its
    // send — the shape that silently no-ops with a stale controller.
    const chain = handleEffects<CustomEffect, Msg>().else(({ effect, send, signal }) => {
      if (effect.type === 'watch') {
        if (signal.aborted) return // async guard
        send({ type: 'done' })
      }
    })
    const onEffect = asOnEffect(chain)

    onEffect({ type: 'watch' }, { send: vi.fn() })?.() // mount 1, then unmount

    const send = vi.fn()
    onEffect({ type: 'watch' }, { send }) // mount 2
    expect(send).toHaveBeenCalledWith({ type: 'done' })
  })

  it("a stale cleanup never aborts a later mount's live signal", () => {
    // The closure-capture trap: each returned cleanup must abort the controller
    // that was live at ITS dispatch, not whatever `controller` happens to point at
    // when the cleanup later runs. Otherwise a delayed unmount of mount 1 tears
    // down mount 2's in-flight effects.
    const seen: AbortSignal[] = []
    const chain = handleEffects<CustomEffect, Msg>().else(({ signal }) => {
      seen.push(signal)
    })
    const onEffect = asOnEffect(chain)

    const cleanup1 = onEffect({ type: 'watch' }, { send: vi.fn() }) // mount 1
    cleanup1?.() // unmount 1 → aborts mount 1's controller
    onEffect({ type: 'watch' }, { send: vi.fn() }) // mount 2 → fresh controller

    const mount1Signal = seen[0]
    const mount2Signal = seen[1]
    expect(mount2Signal).not.toBe(mount1Signal)
    expect(mount2Signal!.aborted).toBe(false)

    // Re-running mount 1's (already-spent) cleanup must NOT touch mount 2's signal.
    cleanup1?.()
    expect(mount2Signal!.aborted).toBe(false)
  })
})
