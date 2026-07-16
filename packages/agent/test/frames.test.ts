import { describe, it, expect } from 'vitest'
import { parseClientFrame, parseServerFrame } from '../src/frames.js'

describe('parseClientFrame', () => {
  it('accepts a well-formed rpc-reply', () => {
    const frame = parseClientFrame({ t: 'rpc-reply', id: 'x', result: { a: 1 } })
    expect(frame).toEqual({ t: 'rpc-reply', id: 'x', result: { a: 1 } })
  })

  it('accepts a confirm-resolved with a valid outcome', () => {
    const frame = parseClientFrame({ t: 'confirm-resolved', confirmId: 'c', outcome: 'confirmed' })
    expect(frame?.t).toBe('confirm-resolved')
  })

  it('rejects an rpc-reply missing its id (wrong-typed correlation field)', () => {
    expect(parseClientFrame({ t: 'rpc-reply', result: 1 })).toBeNull()
    expect(parseClientFrame({ t: 'rpc-reply', id: 42, result: 1 })).toBeNull()
  })

  it('rejects a confirm-resolved with an out-of-set outcome', () => {
    expect(parseClientFrame({ t: 'confirm-resolved', confirmId: 'c', outcome: 'maybe' })).toBeNull()
  })

  it('rejects an unknown frame type', () => {
    expect(parseClientFrame({ t: 'totally-made-up' })).toBeNull()
    expect(parseClientFrame(null)).toBeNull()
    expect(parseClientFrame('nope')).toBeNull()
  })
})

describe('parseServerFrame', () => {
  it('accepts a well-formed rpc request', () => {
    const frame = parseServerFrame({ t: 'rpc', id: 'r1', tool: 'get_state', args: {} })
    expect(frame?.t).toBe('rpc')
  })

  it('accepts a hello-ack', () => {
    const frame = parseServerFrame({ t: 'hello-ack', lapVersion: 2, minClientVersion: 2 })
    expect(frame).toEqual({ t: 'hello-ack', lapVersion: 2, minClientVersion: 2 })
  })

  it('rejects an rpc request missing tool/id', () => {
    expect(parseServerFrame({ t: 'rpc', id: 'r1' })).toBeNull()
    expect(parseServerFrame({ t: 'rpc', tool: 'get_state', args: {} })).toBeNull()
  })

  it('rejects a hello-ack with non-numeric versions', () => {
    expect(parseServerFrame({ t: 'hello-ack', lapVersion: '2', minClientVersion: 2 })).toBeNull()
  })

  it('rejects an unknown frame type', () => {
    expect(parseServerFrame({ t: 'nope' })).toBeNull()
  })
})
