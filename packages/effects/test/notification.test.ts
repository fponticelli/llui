import { describe, it, expect, expectTypeOf } from 'vitest'
import { notification, type NotificationEffect, type Effect } from '../src/index'

type Msg = { type: 'clicked' } | { type: 'closed' } | { type: 'notifError' }

describe('notification()', () => {
  it('returns correct effect shape with title only', () => {
    const effect = notification('Hello')

    expect(effect.type).toBe('notification')
    expect(effect.title).toBe('Hello')
    expect(effect.body).toBeUndefined()
    expect(effect.icon).toBeUndefined()
    expect(effect.tag).toBeUndefined()
    expect(effect.onClick).toBeUndefined()
    expect(effect.onClose).toBeUndefined()
    expect(effect.onError).toBeUndefined()
  })

  it('includes optional fields', () => {
    const effect = notification<Msg>('Title', {
      body: 'Body text',
      icon: '/icon.png',
      tag: 'update',
      onClick: (): Msg => ({ type: 'clicked' }),
      onClose: (): Msg => ({ type: 'closed' }),
      onError: (): Msg => ({ type: 'notifError' }),
    })

    expect(effect.title).toBe('Title')
    expect(effect.body).toBe('Body text')
    expect(effect.icon).toBe('/icon.png')
    expect(effect.tag).toBe('update')
    expect(typeof effect.onClick).toBe('function')
    expect(typeof effect.onClose).toBe('function')
    expect(typeof effect.onError).toBe('function')
  })

  it('onClick callback returns correct message', () => {
    const effect = notification<Msg>('Hi', {
      onClick: (): Msg => ({ type: 'clicked' }),
    })

    expect(effect.onClick!()).toEqual({ type: 'clicked' })
  })

  it('onClose callback returns correct message', () => {
    const effect = notification<Msg>('Hi', {
      onClose: (): Msg => ({ type: 'closed' }),
    })

    expect(effect.onClose!()).toEqual({ type: 'closed' })
  })

  it('onError callback returns correct message', () => {
    const effect = notification<Msg>('Hi', {
      onError: (): Msg => ({ type: 'notifError' }),
    })

    expect(effect.onError!()).toEqual({ type: 'notifError' })
  })

  it('NotificationEffect is part of the Effect union', () => {
    const effect = notification('Test')
    expectTypeOf(effect).toMatchTypeOf<Effect>()
    expectTypeOf<NotificationEffect<Msg>>().toMatchTypeOf<Effect>()
  })
})
