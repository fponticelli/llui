import { describe, it, expect } from 'vitest'
import { handleDescribeContext, type DescribeContextHost } from '../../../src/client/rpc/describe-context.js'
import type { AgentContext } from '../../../src/protocol.js'

describe('handleDescribeContext', () => {
  it('missing fn returns EMPTY context', () => {
    const host: DescribeContextHost = {
      getState: () => ({ count: 0 }),
      getAgentContext: () => null,
    }
    const result = handleDescribeContext(host)
    expect(result).toEqual({ context: { summary: '', hints: [], cautions: [] } })
  })

  it('present fn returns its output', () => {
    const ctx: AgentContext = { summary: 'Shopping cart', hints: ['3 items'], cautions: [] }
    const host: DescribeContextHost = {
      getState: () => ({ items: 3 }),
      getAgentContext: () => () => ctx,
    }
    const result = handleDescribeContext(host)
    expect(result).toEqual({ context: ctx })
  })

  it('state is passed to the context function', () => {
    const captured: unknown[] = []
    const host: DescribeContextHost = {
      getState: () => ({ step: 'checkout' }),
      getAgentContext: () => (s) => {
        captured.push(s)
        return { summary: 'Checkout', hints: [], cautions: [] }
      },
    }
    handleDescribeContext(host)
    expect(captured).toEqual([{ step: 'checkout' }])
  })
})
