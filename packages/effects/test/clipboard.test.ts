import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  clipboardRead,
  clipboardWrite,
  type ClipboardReadEffect,
  type ClipboardWriteEffect,
  type Effect,
} from '../src/index'

type Msg = { type: 'gotText'; text: string } | { type: 'clipError'; error: string }

describe('clipboardRead()', () => {
  const opts = {
    onSuccess: (text: string): Msg => ({ type: 'gotText', text }),
    onError: (error: string): Msg => ({ type: 'clipError', error }),
  }

  it('returns correct effect shape', () => {
    const effect = clipboardRead(opts)

    expect(effect.type).toBe('clipboard-read')
    expect(typeof effect.onSuccess).toBe('function')
    expect(typeof effect.onError).toBe('function')
  })

  it('onSuccess callback returns correct message', () => {
    const effect = clipboardRead(opts)
    const msg = effect.onSuccess('hello')

    expect(msg).toEqual({ type: 'gotText', text: 'hello' })
  })

  it('onError callback returns correct message', () => {
    const effect = clipboardRead(opts)
    const msg = effect.onError('Permission denied')

    expect(msg).toEqual({ type: 'clipError', error: 'Permission denied' })
  })

  it('ClipboardReadEffect is part of the Effect union', () => {
    const effect = clipboardRead(opts)
    expectTypeOf(effect).toMatchTypeOf<Effect>()
    expectTypeOf<ClipboardReadEffect<Msg>>().toMatchTypeOf<Effect>()
  })
})

describe('clipboardWrite()', () => {
  it('returns correct effect shape', () => {
    const effect = clipboardWrite('copy this')

    expect(effect.type).toBe('clipboard-write')
    expect(effect.text).toBe('copy this')
  })

  it('ClipboardWriteEffect is part of the Effect union', () => {
    const effect = clipboardWrite('text')
    expectTypeOf(effect).toMatchTypeOf<Effect>()
    expectTypeOf<ClipboardWriteEffect>().toMatchTypeOf<Effect>()
  })
})
