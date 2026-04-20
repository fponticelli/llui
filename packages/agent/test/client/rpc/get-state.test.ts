import { describe, it, expect } from 'vitest'
import { handleGetState, type GetStateHost } from '../../../src/client/rpc/get-state.js'

function makeHost(state: unknown): GetStateHost {
  return { getState: () => state }
}

describe('handleGetState', () => {
  it('no path → full state', () => {
    const state = { count: 3, user: { name: 'Alice' } }
    const result = handleGetState(makeHost(state), {})
    expect(result).toEqual({ state })
  })

  it('/count → state.count', () => {
    const state = { count: 42, label: 'hello' }
    const result = handleGetState(makeHost(state), { path: '/count' })
    expect(result).toEqual({ state: 42 })
  })

  it('/user/name → nested value', () => {
    const state = { user: { name: 'Bob', age: 30 } }
    const result = handleGetState(makeHost(state), { path: '/user/name' })
    expect(result).toEqual({ state: 'Bob' })
  })

  it('empty string → full state', () => {
    const state = { x: 1 }
    const result = handleGetState(makeHost(state), { path: '' })
    expect(result).toEqual({ state })
  })

  it('missing key → undefined', () => {
    const state = { a: 1 }
    const result = handleGetState(makeHost(state), { path: '/missing' })
    expect(result).toEqual({ state: undefined })
  })

  it('array index /items/0', () => {
    const state = { items: ['first', 'second', 'third'] }
    const result = handleGetState(makeHost(state), { path: '/items/0' })
    expect(result).toEqual({ state: 'first' })
  })
})
