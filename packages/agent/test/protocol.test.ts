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
          annotations: {
            intent: 'Increment',
            alwaysAffordable: false,
            requiresConfirm: false,
            humanOnly: false,
          },
        },
      },
      docs: null,
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

import type {
  AgentDocs,
  AgentContext,
  LapContextResponse,
} from '../src/protocol.js'

describe('Documentation types', () => {
  it('AgentDocs minimal', () => {
    const d: AgentDocs = { purpose: 'Kanban for a small team.' }
    expect(d.purpose).toContain('Kanban')
  })

  it('AgentDocs with overview + cautions', () => {
    const d: AgentDocs = {
      purpose: 'Kanban for a small team.',
      overview: 'Columns are To do / Doing / Done. Cards carry owner, due date, tags.',
      cautions: [
        'Do not delete a card with unfinished subtasks.',
        'Moving to Done locks edits.',
      ],
    }
    expect(d.cautions).toHaveLength(2)
  })

  it('AgentContext minimal', () => {
    const c: AgentContext = { summary: 'Viewing the board; no card focused.' }
    expect(c.summary).toBeDefined()
  })

  it('AgentContext with hints + cautions', () => {
    const c: AgentContext = {
      summary: "Viewing 'Q1 Design' filtered to owner='Ana'. 6 cards visible.",
      hints: ['Tab to list, arrow to select.', 'Enter on a focused card advances status.'],
      cautions: ['Card 42 is locked; reopen first before editing.'],
    }
    expect(c.hints).toHaveLength(2)
  })

  it('LapContextResponse envelope', () => {
    const r: LapContextResponse = {
      context: { summary: 'Empty dashboard.', hints: [], cautions: [] },
    }
    expect(r.context.summary).toBe('Empty dashboard.')
  })
})

describe('LapDescribeResponse — docs block + describe_context read surface', () => {
  it('docs populated', () => {
    const sample: import('../src/protocol.js').LapDescribeResponse = {
      name: 'x',
      version: '0',
      stateSchema: {},
      messages: {},
      docs: { purpose: 'demo' },
      conventions: {
        dispatchModel: 'TEA',
        confirmationModel: 'runtime-mediated',
        readSurfaces: ['state', 'query_dom', 'describe_visible_content', 'describe_context'],
      },
      schemaHash: 'h',
    }
    expect(sample.docs?.purpose).toBe('demo')
  })

  it('docs null is allowed', () => {
    const sample: import('../src/protocol.js').LapDescribeResponse = {
      name: 'x',
      version: '0',
      stateSchema: {},
      messages: {},
      docs: null,
      conventions: {
        dispatchModel: 'TEA',
        confirmationModel: 'runtime-mediated',
        readSurfaces: ['state', 'query_dom', 'describe_visible_content', 'describe_context'],
      },
      schemaHash: 'h',
    }
    expect(sample.docs).toBeNull()
  })
})

import type {
  ClientFrame,
  ServerFrame,
  HelloFrame,
  RpcReplyFrame,
  RpcErrorFrame,
  ConfirmResolvedFrame,
  StateUpdateFrame,
  LogAppendFrame,
  RpcFrame,
  RevokedFrame,
} from '../src/protocol.js'

describe('Relay WS frame types', () => {
  it('hello frame', () => {
    const f: HelloFrame = {
      t: 'hello',
      appName: 'App',
      appVersion: '1.0',
      msgSchema: { inc: { payload: {}, annotations: { intent: null, alwaysAffordable: false, requiresConfirm: false, humanOnly: false } } },
      stateSchema: { type: 'object' },
      affordancesSample: [{ type: 'inc' }],
      docs: null,
      schemaHash: 'h1',
    }
    expect(f.t).toBe('hello')
  })

  it('hello frame with populated docs', () => {
    const f: HelloFrame = {
      t: 'hello',
      appName: 'App',
      appVersion: '1.0',
      msgSchema: {},
      stateSchema: { type: 'object' },
      affordancesSample: [],
      docs: { purpose: 'Demo app', overview: 'Counter', cautions: ['Don\u2019t reset mid-flow'] },
      schemaHash: 'h2',
    }
    expect(f.docs?.purpose).toBe('Demo app')
  })

  it('rpc reply + error frames', () => {
    const ok: RpcReplyFrame = { t: 'rpc-reply', id: 'r1', result: { state: {} } }
    const err: RpcErrorFrame = { t: 'rpc-error', id: 'r1', code: 'invalid', detail: 'bad path' }
    expect(ok.t).toBe('rpc-reply')
    expect(err.t).toBe('rpc-error')
  })

  it('confirm-resolved frame', () => {
    const f: ConfirmResolvedFrame = {
      t: 'confirm-resolved',
      confirmId: 'c1',
      outcome: 'confirmed',
      stateAfter: {},
    }
    expect(f.outcome).toBe('confirmed')
  })

  it('state-update frame', () => {
    const f: StateUpdateFrame = { t: 'state-update', path: '/count', stateAfter: { count: 1 } }
    expect(f.t).toBe('state-update')
  })

  it('log-append frame', () => {
    const f: LogAppendFrame = {
      t: 'log-append',
      entry: { id: 'e1', at: 0, kind: 'dispatched', variant: 'inc', intent: 'Increment' },
    }
    expect(f.entry.kind).toBe('dispatched')
  })

  it('rpc (server→client) frame', () => {
    const f: RpcFrame = { t: 'rpc', id: 'r1', tool: 'get_state', args: { path: null } }
    expect(f.t).toBe('rpc')
  })

  it('revoked frame', () => {
    const f: RevokedFrame = { t: 'revoked' }
    expect(f.t).toBe('revoked')
  })

  it('ClientFrame union is inhabited by all expected variants', () => {
    const frames: ClientFrame[] = [
      { t: 'hello', appName: 'x', appVersion: '1', msgSchema: {}, stateSchema: {}, affordancesSample: [], docs: null, schemaHash: 'h' },
      { t: 'rpc-reply', id: 'r', result: null },
      { t: 'rpc-error', id: 'r', code: 'invalid' },
      { t: 'confirm-resolved', confirmId: 'c', outcome: 'user-cancelled' },
      { t: 'state-update', path: '/', stateAfter: null },
      { t: 'log-append', entry: { id: 'e', at: 0, kind: 'read' } },
    ]
    expect(frames).toHaveLength(6)
  })

  it('ServerFrame union is inhabited', () => {
    const frames: ServerFrame[] = [
      { t: 'rpc', id: 'r', tool: 'get_state', args: {} },
      { t: 'revoked' },
    ]
    expect(frames).toHaveLength(2)
  })
})
