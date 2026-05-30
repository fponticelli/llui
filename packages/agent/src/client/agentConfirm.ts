import type { AgentEffect } from './effects.js'

export type ConfirmEntry = {
  id: string
  variant: string
  payload: unknown
  intent: string
  reason: string | null
  proposedAt: number
  status: 'pending' | 'approved' | 'rejected'
}

export type AgentConfirmState = { pending: ConfirmEntry[] }

export type AgentConfirmMsg =
  /**
   * @humanOnly — internal: dispatched by `handleSendMessage` on the
   * @llui/dom side when an agent message is gated by @requiresConfirm.
   * Adds a pending entry to state; the user (not the agent) decides
   * with Approve / Reject.
   */
  | { type: 'Propose'; entry: ConfirmEntry }
  /** @intent("Approve a pending agent action") */
  | { type: 'Approve'; id: string }
  /** @intent("Reject a pending agent action") */
  | { type: 'Reject'; id: string }
  /**
   * @humanOnly — internal: the host app dispatches this on a timer to
   * garbage-collect entries that have been pending past `maxAgeMs`.
   * Agents have no business poking at the timer wheel directly.
   */
  | { type: 'ExpireStale'; now: number; maxAgeMs: number }

export function init(): [AgentConfirmState, AgentEffect[]] {
  return [{ pending: [] }, []]
}

export function update(
  state: AgentConfirmState,
  msg: AgentConfirmMsg,
): [AgentConfirmState, AgentEffect[]] {
  switch (msg.type) {
    case 'Propose':
      return [{ pending: [...state.pending, msg.entry] }, []]
    case 'Approve': {
      const entry = state.pending.find((e) => e.id === msg.id)
      if (!entry || entry.status !== 'pending') return [state, []]
      return [
        { pending: state.pending.map((e) => (e.id === msg.id ? { ...e, status: 'approved' } : e)) },
        [
          {
            type: 'AgentForwardMsg',
            payload: { type: entry.variant, ...(entry.payload as object) },
          },
        ],
      ]
    }
    case 'Reject':
      return [
        { pending: state.pending.map((e) => (e.id === msg.id ? { ...e, status: 'rejected' } : e)) },
        [],
      ]
    case 'ExpireStale':
      return [
        {
          pending: state.pending.filter(
            (e) => msg.now - e.proposedAt <= msg.maxAgeMs || e.status !== 'pending',
          ),
        },
        [],
      ]
  }
}

// Connect bag:
import { tagSend, type Send, type Signal } from '@llui/dom'

/**
 * Static prop bag with reactive (Signal-handle) values. See
 * agentConnect.ts for the rationale; spread directly into element
 * helpers and the LLui runtime re-evaluates handle-valued props on
 * dirty bits.
 *
 * Per-entry props are exposed as a function `entry(id)` that returns
 * a sub-bag whose values are themselves reactive Signal handles —
 * caller passes the id once, gets back a bag they can spread.
 */
export type ConnectBag = {
  root: { 'data-scope': 'agent-confirm' }
  /**
   * Resolves a per-entry sub-bag. The returned bag's handles look up
   * the entry by `id` lazily, so the bag stays valid even after
   * approve/reject mutates the entry's status.
   */
  entry: (id: string) => {
    card: {
      'data-part': 'entry'
      'data-status': Signal<'pending' | 'approved' | 'rejected' | 'missing'>
      'data-id': string
    }
    approveButton: { onClick: () => void; disabled: Signal<boolean> }
    rejectButton: { onClick: () => void; disabled: Signal<boolean> }
    intentText: Signal<string>
    reasonText: Signal<string | null>
    payloadText: Signal<string>
  }
  empty: { 'data-part': 'empty'; 'data-visible': Signal<boolean> }
}

export function connect(state: Signal<AgentConfirmState>, send: Send<AgentConfirmMsg>): ConnectBag {
  const findEntry = (s: AgentConfirmState, id: string): ConfirmEntry | undefined =>
    s.pending.find((e) => e.id === id)

  return {
    root: { 'data-scope': 'agent-confirm' },
    entry: (id) => ({
      card: {
        'data-part': 'entry',
        'data-status': state.map((s) => findEntry(s, id)?.status ?? 'missing'),
        'data-id': id,
      },
      approveButton: {
        onClick: tagSend(send, ['Approve'], () => send({ type: 'Approve', id })),
        disabled: state.map((s) => findEntry(s, id)?.status !== 'pending'),
      },
      rejectButton: {
        onClick: tagSend(send, ['Reject'], () => send({ type: 'Reject', id })),
        disabled: state.map((s) => findEntry(s, id)?.status !== 'pending'),
      },
      intentText: state.map((s) => findEntry(s, id)?.intent ?? ''),
      reasonText: state.map((s) => findEntry(s, id)?.reason ?? null),
      payloadText: state.map((s) => {
        const e = findEntry(s, id)
        return e ? JSON.stringify(e.payload, null, 2) : ''
      }),
    }),
    empty: {
      'data-part': 'empty',
      'data-visible': state.map((s) => s.pending.length === 0),
    },
  }
}
