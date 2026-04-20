import { describe, it, expect } from 'vitest'
import type {
  LapDescribeResponse,
  LapStateRequest,
  LapStateResponse,
  LapActionsResponse,
  LapMessageRequest,
  LapMessageResponse,
  LapConfirmResultRequest,
  LapConfirmResultResponse,
  LapWaitRequest,
  LapWaitResponse,
  LapQueryDomRequest,
  LapQueryDomResponse,
  LapDescribeVisibleResponse,
  LapError,
} from '../src/protocol.js'

describe('LAP types — sample value conformance', () => {
  it('describe response', () => {
    const sample: LapDescribeResponse = {
      name: 'Counter',
      version: '0.0.0',
      stateSchema: { type: 'object' },
      messages: {
        inc: {
          payloadSchema: { type: 'object' },
          intent: 'Increment',
          alwaysAffordable: false,
          requiresConfirm: false,
          humanOnly: false,
        },
      },
      conventions: {
        dispatchModel: 'TEA',
        confirmationModel: 'runtime-mediated',
        readSurfaces: ['state', 'query_dom', 'describe_visible_content'],
      },
      schemaHash: 'abc123',
    }
    expect(sample.conventions.dispatchModel).toBe('TEA')
  })

  it('state request + response', () => {
    const req: LapStateRequest = { path: '/user/name' }
    const res: LapStateResponse = { state: { user: { name: 'Franco' } } }
    expect(req.path).toBe('/user/name')
    expect(res.state).toBeDefined()
  })

  it('actions response', () => {
    const sample: LapActionsResponse = {
      actions: [
        {
          variant: 'inc',
          intent: 'Increment',
          requiresConfirm: false,
          source: 'binding',
          selectorHint: 'button.inc',
          payloadHint: null,
        },
        {
          variant: 'nav',
          intent: 'Navigate',
          requiresConfirm: false,
          source: 'always-affordable',
          selectorHint: null,
          payloadHint: { to: 'reports' },
        },
      ],
    }
    expect(sample.actions).toHaveLength(2)
  })

  it('message request + discriminated response', () => {
    const req: LapMessageRequest = {
      msg: { type: 'delete', id: 'abc' },
      reason: 'user asked me to delete this',
      waitFor: 'idle',
      timeoutMs: 15000,
    }
    const dispatched: LapMessageResponse = { status: 'dispatched', stateAfter: {} }
    const pending: LapMessageResponse = { status: 'pending-confirmation', confirmId: 'c1' }
    const confirmed: LapMessageResponse = { status: 'confirmed', stateAfter: {} }
    const rejected: LapMessageResponse = { status: 'rejected', reason: 'humanOnly' }
    expect(req.msg.type).toBe('delete')
    expect(dispatched.status).toBe('dispatched')
    expect(pending.status).toBe('pending-confirmation')
    expect(confirmed.status).toBe('confirmed')
    expect(rejected.status).toBe('rejected')
  })

  it('confirm-result types', () => {
    const req: LapConfirmResultRequest = { confirmId: 'c1', timeoutMs: 5000 }
    const a: LapConfirmResultResponse = { status: 'confirmed', stateAfter: {} }
    const b: LapConfirmResultResponse = { status: 'rejected', reason: 'user-cancelled' }
    const c: LapConfirmResultResponse = { status: 'still-pending' }
    expect(req.confirmId).toBe('c1')
    expect([a.status, b.status, c.status]).toEqual(['confirmed', 'rejected', 'still-pending'])
  })

  it('wait types', () => {
    const req: LapWaitRequest = { path: '/count', timeoutMs: 10000 }
    const changed: LapWaitResponse = { status: 'changed', stateAfter: {} }
    const timeout: LapWaitResponse = { status: 'timeout', stateAfter: {} }
    expect(req.path).toBe('/count')
    expect([changed.status, timeout.status]).toEqual(['changed', 'timeout'])
  })

  it('query-dom types', () => {
    const req: LapQueryDomRequest = { name: 'email-list', multiple: true }
    const res: LapQueryDomResponse = {
      elements: [{ text: 'Hello', attrs: { class: 'a' }, path: [0, 1] }],
    }
    expect(req.name).toBe('email-list')
    expect(res.elements).toHaveLength(1)
  })

  it('describe-visible types', () => {
    const res: LapDescribeVisibleResponse = {
      outline: [
        { kind: 'heading', level: 1, text: 'Inbox' },
        { kind: 'button', text: 'Compose', disabled: false, actionVariant: 'compose' },
      ],
    }
    expect(res.outline).toHaveLength(2)
  })

  it('error envelope', () => {
    const err: LapError = {
      error: { code: 'revoked', detail: 'token revoked by user' },
    }
    expect(err.error.code).toBe('revoked')
  })
})
