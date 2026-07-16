import { withLapGates, type LapGateDeps } from './gate.js'
import type { LapWaitRequest, LapWaitResponse } from '../../protocol.js'

/** @deprecated Use `LapGateDeps` from `./gate.js`. */
export type LapWaitDeps = LapGateDeps

export const handleLapWait = withLapGates({ touchOn: 'arrival' }, async (ctx) => {
  // Note: the sliding-TTL clock was refreshed at request ARRIVAL by the
  // gate (`touchOn: 'arrival'`) — `/wait` is a long poll that can block
  // past `slidingTtlMs`, so touching only after it resolves would let the
  // inactivity expiry kill an actively-polling agent.
  const body = (ctx.body ?? {}) as LapWaitRequest
  const timeoutMs = body.timeoutMs ?? 10_000
  const result = await ctx.deps.registry.waitForChange(ctx.tid, body.path, timeoutMs)
  const out: LapWaitResponse = result

  return ctx.finish(out, { detail: { path: '/lap/v1/wait', outcome: result.status } })
})
