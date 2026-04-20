import { describe, it, expect, beforeEach } from 'vitest'
import { defaultRateLimiter } from '../../src/server/rate-limit.js'

let clock = 0
const now = () => clock
beforeEach(() => {
  clock = 0
})

describe('defaultRateLimiter — token bucket', () => {
  it('allows under-limit calls', async () => {
    const rl = defaultRateLimiter({ perBucket: '5/second' }, now)
    for (let i = 0; i < 5; i++) {
      const res = await rl.check('t1', 'token')
      expect(res.allowed).toBe(true)
    }
  })

  it('blocks and returns retryAfterMs when over limit', async () => {
    const rl = defaultRateLimiter({ perBucket: '2/second' }, now)
    await rl.check('t1', 'token')
    await rl.check('t1', 'token')
    const over = await rl.check('t1', 'token')
    expect(over.allowed).toBe(false)
    if (!over.allowed) expect(over.retryAfterMs).toBeGreaterThan(0)
  })

  it('refills as time passes', async () => {
    const rl = defaultRateLimiter({ perBucket: '2/second' }, now)
    await rl.check('t1', 'token')
    await rl.check('t1', 'token')
    expect((await rl.check('t1', 'token')).allowed).toBe(false)
    clock = 1000
    expect((await rl.check('t1', 'token')).allowed).toBe(true)
  })

  it('token and identity buckets are independent', async () => {
    const rl = defaultRateLimiter({ perBucket: '1/second' }, now)
    expect((await rl.check('t1', 'token')).allowed).toBe(true)
    expect((await rl.check('t1', 'token')).allowed).toBe(false)
    expect((await rl.check('u1', 'identity')).allowed).toBe(true)
  })
})
