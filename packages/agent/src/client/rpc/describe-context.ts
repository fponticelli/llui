import type { AgentContext } from '../../protocol.js'

export type DescribeContextHost = {
  getState(): unknown
  getAgentContext(): ((state: unknown) => AgentContext) | null
}
export type DescribeContextResult = { context: AgentContext }

const EMPTY: AgentContext = { summary: '', hints: [], cautions: [] }

export function handleDescribeContext(host: DescribeContextHost): DescribeContextResult {
  const fn = host.getAgentContext()
  if (!fn) return { context: EMPTY }
  return { context: fn(host.getState()) }
}
