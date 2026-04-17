import { describe, it, expect, afterEach } from 'vitest'
import { _setEffectInterceptor, _getEffectInterceptor } from '../src/index'

describe('effect interceptor hook', () => {
  afterEach(() => {
    _setEffectInterceptor(null)
  })

  it('starts null and can be cleared', () => {
    // Contract: baseline is null, and clearing is a no-op.
    expect(_getEffectInterceptor()).toBeNull()
    expect(() => _setEffectInterceptor(null)).not.toThrow()
    expect(_getEffectInterceptor()).toBeNull()
  })

  it('accepts a pass-through hook', () => {
    _setEffectInterceptor((_effect, _id) => ({ mocked: false }))
    const hook = _getEffectInterceptor()
    expect(hook).not.toBeNull()
    expect(hook!({ type: 'http' }, 'eff-1')).toEqual({ mocked: false })
  })

  it('accepts a matching hook that returns a mocked response', () => {
    _setEffectInterceptor((effect, _id) => {
      const eff = effect as { type?: string }
      return eff.type === 'http' ? { mocked: true, response: { data: 'ok' } } : { mocked: false }
    })
    const hook = _getEffectInterceptor()!
    expect(hook({ type: 'http', url: '/x' }, 'eff-1')).toEqual({
      mocked: true,
      response: { data: 'ok' },
    })
    expect(hook({ type: 'log', message: 'hi' }, 'eff-2')).toEqual({ mocked: false })
  })
})
