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
  | { type: 'Propose'; entry: ConfirmEntry }
  | { type: 'Approve'; id: string }
  | { type: 'Reject'; id: string }
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
import { type Send } from '@llui/dom'

/**
 * Static prop bag with reactive accessors. See agentConnect.ts for
 * the rationale; spread directly into element helpers and the LLui
 * runtime re-evaluates function-valued props on dirty bits.
 *
 * Per-entry props are exposed as a function `entry(id)` that returns
 * a sub-bag whose values are themselves reactive — caller passes the
 * id once, gets back a bag they can spread.
 */
export type ConnectBag<S> = {
  root: { 'data-scope': 'agent-confirm' }
  /**
   * Resolves a per-entry sub-bag. The returned bag's accessors look
   * up the entry by `id` lazily, so the bag stays valid even after
   * approve/reject mutates the entry's status.
   */
  entry: (id: string) => {
    card: {
      'data-part': 'entry'
      'data-status': (s: S) => 'pending' | 'approved' | 'rejected' | 'missing'
      'data-id': string
    }
    approveButton: { onClick: () => void; disabled: (s: S) => boolean }
    rejectButton: { onClick: () => void; disabled: (s: S) => boolean }
    intentText: (s: S) => string
    reasonText: (s: S) => string | null
    payloadText: (s: S) => string
  }
  empty: { 'data-part': 'empty'; 'data-visible': (s: S) => boolean }
}

export function connect<S>(
  get: (s: S) => AgentConfirmState,
  send: Send<AgentConfirmMsg>,
): ConnectBag<S> {
  const findEntry = (state: S, id: string): ConfirmEntry | undefined =>
    get(state).pending.find((e) => e.id === id)

  return {
    root: { 'data-scope': 'agent-confirm' },
    entry: (id) => ({
      card: {
        'data-part': 'entry',
        'data-status': (s) => findEntry(s, id)?.status ?? 'missing',
        'data-id': id,
      },
      approveButton: {
        onClick: () => send({ type: 'Approve', id }),
        disabled: (s) => findEntry(s, id)?.status !== 'pending',
      },
      rejectButton: {
        onClick: () => send({ type: 'Reject', id }),
        disabled: (s) => findEntry(s, id)?.status !== 'pending',
      },
      intentText: (s) => findEntry(s, id)?.intent ?? '',
      reasonText: (s) => findEntry(s, id)?.reason ?? null,
      payloadText: (s) => {
        const e = findEntry(s, id)
        return e ? JSON.stringify(e.payload, null, 2) : ''
      },
    }),
    empty: {
      'data-part': 'empty',
      'data-visible': (s) => get(s).pending.length === 0,
    },
  }
}
