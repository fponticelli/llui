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
})
