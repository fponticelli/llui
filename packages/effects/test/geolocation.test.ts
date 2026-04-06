import { describe, it, expect, expectTypeOf } from 'vitest'
import { geolocation, type GeolocationEffect, type Effect } from '../src/index'

type Msg =
  | { type: 'position'; lat: number; lng: number; acc: number }
  | { type: 'geoError'; error: string }

describe('geolocation()', () => {
  const opts = {
    onSuccess: (pos: { latitude: number; longitude: number; accuracy: number }): Msg => ({
      type: 'position',
      lat: pos.latitude,
      lng: pos.longitude,
      acc: pos.accuracy,
    }),
    onError: (error: string): Msg => ({ type: 'geoError', error }),
  }

  it('returns correct effect shape', () => {
    const effect = geolocation(opts)

    expect(effect.type).toBe('geolocation')
    expect(typeof effect.onSuccess).toBe('function')
    expect(typeof effect.onError).toBe('function')
    expect(effect.enableHighAccuracy).toBeUndefined()
  })

  it('includes enableHighAccuracy option', () => {
    const effect = geolocation({ ...opts, enableHighAccuracy: true })

    expect(effect.enableHighAccuracy).toBe(true)
  })

  it('onSuccess callback returns correct message', () => {
    const effect = geolocation(opts)
    const msg = effect.onSuccess({ latitude: 51.5, longitude: -0.1, accuracy: 10 })

    expect(msg).toEqual({ type: 'position', lat: 51.5, lng: -0.1, acc: 10 })
  })

  it('onError callback returns correct message', () => {
    const effect = geolocation(opts)
    const msg = effect.onError('User denied Geolocation')

    expect(msg).toEqual({ type: 'geoError', error: 'User denied Geolocation' })
  })

  it('GeolocationEffect is part of the Effect union', () => {
    const effect = geolocation(opts)
    expectTypeOf(effect).toMatchTypeOf<Effect>()
    expectTypeOf<GeolocationEffect<Msg>>().toMatchTypeOf<Effect>()
  })
})
