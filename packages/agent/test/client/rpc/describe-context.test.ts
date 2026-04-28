import { describe, it, expect } from 'vitest'
import {
  handleDescribeContext,
  type DescribeContextHost,
} from '../../../src/client/rpc/describe-context.js'
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

  // ── Last-dispatch-outcome synthetic hint ─────────────────────────

  it('prepends a synthetic hint when the last dispatch was rejected', () => {
    // Apps used to wire `lastDispatchError` in their own state and
    // surface it through agentContext. The framework now owns it: a
    // rejected dispatch leaves an outcome that describe_context turns
    // into a "LAST DISPATCH REJECTED:" hint at the top of the list.
    const host: DescribeContextHost = {
      getState: () => ({}),
      getAgentContext: () => () => ({
        summary: 'app context',
        hints: ['user is signed in'],
        cautions: [],
      }),
      getLastDispatchOutcome: () => ({
        variant: 'Matrix/AddCriteria',
        status: 'rejected',
        errors: [{ message: 'criteria[0].title: required field is missing' }],
        at: 1234,
      }),
    }
    const result = handleDescribeContext(host)
    expect(result.context.hints?.[0]).toContain('LAST DISPATCH REJECTED')
    expect(result.context.hints?.[0]).toContain('Matrix/AddCriteria')
    expect(result.context.hints?.[0]).toContain('criteria[0].title')
    expect(result.context.hints).toContain('user is signed in')
  })

  it('prepends a hint for reducer-threw outcomes', () => {
    const host: DescribeContextHost = {
      getState: () => ({}),
      getAgentContext: () => () => ({ summary: '', hints: [], cautions: [] }),
      getLastDispatchOutcome: () => ({
        variant: 'Matrix/AddCriteria',
        status: 'reducer-threw',
        errors: [{ message: 'Error: unexpected ease value' }],
        at: 1234,
      }),
    }
    const result = handleDescribeContext(host)
    expect(result.context.hints?.[0]).toContain('LAST DISPATCH ERRORED MID-FLIGHT')
    expect(result.context.hints?.[0]).toContain('observe before retrying')
  })

  it('prepends a hint for dispatched-with-warnings outcomes', () => {
    const host: DescribeContextHost = {
      getState: () => ({}),
      getAgentContext: () => () => ({ summary: '', hints: [], cautions: [] }),
      getLastDispatchOutcome: () => ({
        variant: 'X',
        status: 'dispatched',
        warnings: [{ path: 'payload', message: 'untyped field, not validated' }],
        at: 1234,
      }),
    }
    const result = handleDescribeContext(host)
    expect(result.context.hints?.[0]).toContain('LAST DISPATCH (X) landed with caveats')
    expect(result.context.hints?.[0]).toContain('1 validation warning')
  })

  it('does NOT add a hint for clean dispatched outcomes', () => {
    // No errors, no warnings — no need to clutter the context.
    const host: DescribeContextHost = {
      getState: () => ({}),
      getAgentContext: () => () => ({
        summary: 'app',
        hints: ['existing hint'],
        cautions: [],
      }),
      getLastDispatchOutcome: () => ({
        variant: 'Increment',
        status: 'dispatched',
        at: 1234,
      }),
    }
    const result = handleDescribeContext(host)
    expect(result.context.hints).toEqual(['existing hint'])
  })

  it('does NOT alter context when no outcome accessor is wired', () => {
    // Backward-compat: hosts without `getLastDispatchOutcome` get the
    // exact same output as before.
    const host: DescribeContextHost = {
      getState: () => ({}),
      getAgentContext: () => () => ({ summary: 'A', hints: ['B'], cautions: ['C'] }),
    }
    const result = handleDescribeContext(host)
    expect(result.context).toEqual({ summary: 'A', hints: ['B'], cautions: ['C'] })
  })
})
