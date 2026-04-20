export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number }

export interface RateLimiter {
  check(key: string, bucket: 'token' | 'identity'): Promise<RateLimitResult>
}

export type RateLimitConfig = {
  perBucket: string
}

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
}

function parseRate(spec: string): { count: number; windowMs: number } {
  const m = spec.match(/^(\d+)\/(second|minute|hour)$/)
  if (!m) throw new Error(`invalid rate spec: ${spec}`)
  const count = Number(m[1])
  const windowMs = UNIT_MS[m[2] as keyof typeof UNIT_MS]
  if (!windowMs) throw new Error(`invalid rate spec: ${spec}`)
  return { count, windowMs }
}

export function defaultRateLimiter(
  cfg: RateLimitConfig,
  now: () => number = () => Date.now(),
): RateLimiter {
  const { count, windowMs } = parseRate(cfg.perBucket)
  const refillPerMs = count / windowMs

  type BucketState = { tokens: number; lastCheck: number }
  const state = new Map<string, BucketState>()

  return {
    async check(key, bucket) {
      const k = `${bucket}:${key}`
      const nowMs = now()
      let b = state.get(k)
      if (!b) {
        b = { tokens: count, lastCheck: nowMs }
        state.set(k, b)
      } else {
        const delta = nowMs - b.lastCheck
        b.tokens = Math.min(count, b.tokens + delta * refillPerMs)
        b.lastCheck = nowMs
      }
      if (b.tokens >= 1) {
        b.tokens -= 1
        return { allowed: true }
      }
      const retryAfterMs = Math.ceil((1 - b.tokens) / refillPerMs)
      return { allowed: false, retryAfterMs }
    },
  }
}
