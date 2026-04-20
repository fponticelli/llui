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

type ConnectBag = {
  root: { 'data-scope': string }
  entry: (id: string) => {
    card: { 'data-part': string; 'data-status': string; 'data-id': string }
    approveButton: { onClick: () => void; disabled: boolean }
    rejectButton: { onClick: () => void; disabled: boolean }
    intentText: string
    reasonText: string | null
    payloadText: string
  } | null
  empty: { 'data-part': string; 'data-visible': boolean }
}

export function connect<S>(
  get: (s: S) => AgentConfirmState,
  send: Send<AgentConfirmMsg>,
): (state: S) => ConnectBag {
  return (state) => {
    const s = get(state)
    return {
      root: { 'data-scope': 'agent-confirm' },
      entry: (id) => {
        const e = s.pending.find((x) => x.id === id)
        if (!e) return null
        return {
          card: { 'data-part': 'entry', 'data-status': e.status, 'data-id': e.id },
          approveButton: {
            onClick: () => send({ type: 'Approve', id }),
            disabled: e.status !== 'pending',
          },
          rejectButton: {
            onClick: () => send({ type: 'Reject', id }),
            disabled: e.status !== 'pending',
          },
          intentText: e.intent,
          reasonText: e.reason,
          payloadText: JSON.stringify(e.payload, null, 2),
        }
      },
      empty: { 'data-part': 'empty', 'data-visible': s.pending.length === 0 },
    }
  }
}
