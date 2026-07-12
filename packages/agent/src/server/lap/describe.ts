import { withLapGates, type LapGateDeps } from './gate.js'
import type { LapDescribeResponse, MessageSchemaEntry } from '../../protocol.js'

// `verifyAndReadTid` now lives in `./gate.ts` (its natural home — it is
// the first step of the shared gate). Re-exported here for the existing
// import sites (`server/mcp/server.ts`, tests) that reach for it via
// `./describe.js`.
export { verifyAndReadTid, type VerifyTidOptions } from './gate.js'

/** @deprecated Use `LapGateDeps` from `./gate.js`. */
export type LapDescribeDeps = LapGateDeps

export const handleLapDescribe = withLapGates({ touchOn: 'completion' }, async (ctx) => {
  const hello = ctx.deps.registry.getHello(ctx.tid)
  if (!hello) return ctx.paused()

  const messages: Record<string, MessageSchemaEntry> = hello.msgSchema as Record<
    string,
    MessageSchemaEntry
  >
  const out: LapDescribeResponse = {
    name: hello.appName,
    version: hello.appVersion,
    stateSchema: hello.stateSchema,
    messages,
    docs: hello.docs,
    conventions: {
      dispatchModel: 'TEA',
      confirmationModel: 'runtime-mediated',
      readSurfaces: ['state', 'query_dom', 'describe_visible_content', 'describe_context'],
    },
    schemaHash: hello.schemaHash,
  }

  // First-LAP-call activation + sliding-TTL refresh are folded into
  // `ctx.finish` (markActive → touch → audit). Centralised so the same
  // transition fires from every LAP endpoint, not just `/describe` — the
  // bridge typically connects via `/observe` and the old describe-only
  // path left the browser stuck on `awaiting-claude` indefinitely.
  return ctx.finish(out, { detail: { path: '/lap/v1/describe' } })
})
