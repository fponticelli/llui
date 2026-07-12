import { withLapGates, type LapGateDeps } from './gate.js'
import type {
  AgentContext,
  LapActionsResponse,
  LapDescribeResponse,
  LapObserveResponse,
  MessageSchemaEntry,
} from '../../protocol.js'

/** @deprecated Use `LapGateDeps` from `./gate.js`. */
export type LapObserveDeps = LapGateDeps

/**
 * Unified bootstrap endpoint. One call returns everything the LLM
 * needs to start acting on the app:
 *   - state            (dynamic, from browser)
 *   - actions          (dynamic, from browser)
 *   - description      (static, from cached hello frame)
 *   - context          (dynamic, from browser — agentContext(state))
 *
 * Replaces the get_state + list_actions + describe_app trio at the
 * MCP layer. Those LAP endpoints remain available for specialized
 * callers, but the common "what can I see, what can I do" question
 * is one call instead of three.
 */
export const handleLapObserve = withLapGates({ touchOn: 'completion' }, async (ctx) => {
  const hello = ctx.deps.registry.getHello(ctx.tid)
  if (!hello) return ctx.paused()

  let dynamic: {
    state: unknown
    actions: LapActionsResponse['actions']
    context: AgentContext | null
  }
  try {
    dynamic = (await ctx.deps.registry.rpc(ctx.tid, 'observe', {})) as typeof dynamic
  } catch (e: unknown) {
    const err = e as { code?: string; detail?: string }
    const code = err.code ?? 'internal'
    if (code === 'paused') return ctx.paused()
    const status = code === 'timeout' ? 504 : 500
    return ctx.json({ error: { code, detail: err.detail } }, status)
  }

  const description: LapDescribeResponse = {
    name: hello.appName,
    version: hello.appVersion,
    stateSchema: hello.stateSchema,
    messages: hello.msgSchema as Record<string, MessageSchemaEntry>,
    docs: hello.docs,
    conventions: {
      dispatchModel: 'TEA',
      confirmationModel: 'runtime-mediated',
      readSurfaces: ['state', 'query_dom', 'describe_visible_content', 'describe_context'],
    },
    schemaHash: hello.schemaHash,
  }

  const out: LapObserveResponse = {
    state: dynamic.state,
    actions: dynamic.actions,
    description,
    context: dynamic.context,
  }

  return ctx.finish(out, { detail: { tool: 'observe' } })
})
