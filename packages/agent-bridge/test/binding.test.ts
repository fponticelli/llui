import { describe, it, expect, beforeEach } from 'vitest'
import { BindingMap } from '../src/binding.js'
import type { LapDescribeResponse } from '@llui/agent/protocol'

const makeDescribe = (): LapDescribeResponse => ({
  name: 'TestApp',
  version: '1.0.0',
  stateSchema: {},
  messages: {},
  docs: null,
  conventions: {
    dispatchModel: 'TEA',
    confirmationModel: 'runtime-mediated',
    readSurfaces: ['state', 'query_dom'],
  },
  schemaHash: 'abc123',
})

describe('BindingMap', () => {
  let map: BindingMap

  beforeEach(() => {
    map = new BindingMap()
  })

  it('set + get round-trip returns correct binding', () => {
    map.set('s1', 'https://app/lap/v1', 'tok-abc')
    const b = map.get('s1')
    expect(b).not.toBeNull()
    expect(b?.url).toBe('https://app/lap/v1')
    expect(b?.token).toBe('tok-abc')
    expect(b?.describe).toBeNull()
  })

  it('get on missing session returns null', () => {
    expect(map.get('no-such-session')).toBeNull()
  })

  it('setDescribe updates the cached describe response', () => {
    map.set('s2', 'https://app/lap/v1', 'tok-xyz')
    const desc = makeDescribe()
    map.setDescribe('s2', desc)
    const b = map.get('s2')
    expect(b?.describe).toEqual(desc)
    // url and token are preserved
    expect(b?.url).toBe('https://app/lap/v1')
    expect(b?.token).toBe('tok-xyz')
  })

  it('setDescribe on missing session is a no-op', () => {
    // Should not throw
    map.setDescribe('no-session', makeDescribe())
    expect(map.get('no-session')).toBeNull()
  })

  it('clear removes the entry', () => {
    map.set('s3', 'https://app/lap/v1', 'tok')
    expect(map.has('s3')).toBe(true)
    map.clear('s3')
    expect(map.has('s3')).toBe(false)
    expect(map.get('s3')).toBeNull()
  })

  it('has reflects presence correctly', () => {
    expect(map.has('s4')).toBe(false)
    map.set('s4', 'https://app/lap/v1', 'tok')
    expect(map.has('s4')).toBe(true)
    map.clear('s4')
    expect(map.has('s4')).toBe(false)
  })
})
