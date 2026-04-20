import { div, button, span, p, text, branch, each } from '@llui/dom'
import type { State, Msg } from '../types'
import type { Send, ItemAccessor } from '@llui/dom'
import { agentConfirm } from '@llui/agent/client'

type ConfirmEntry = agentConfirm.ConfirmEntry

// ── Design tokens ──────────────────────────────────────────────────────────────

const CARD_STYLE = [
  'position: fixed',
  'bottom: 20px',
  'right: 20px',
  'z-index: 9999',
  'width: 340px',
  'background: #ffffff',
  'border: 1px solid #e2e8f0',
  'border-radius: 12px',
  'box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)',
  'font-family: system-ui, -apple-system, sans-serif',
  'font-size: 14px',
  'color: #1a202c',
  'overflow: hidden',
].join('; ')

const HEADER_STYLE = [
  'display: flex',
  'align-items: center',
  'gap: 8px',
  'padding: 12px 16px',
  'background: #f8fafc',
  'border-bottom: 1px solid #e2e8f0',
].join('; ')

const BODY_STYLE = 'padding: 16px'

const BTN_PRIMARY = [
  'display: block',
  'width: 100%',
  'padding: 9px 16px',
  'background: #7c3aed',
  'color: #fff',
  'border: none',
  'border-radius: 8px',
  'font-size: 14px',
  'font-weight: 500',
  'cursor: pointer',
  'transition: background 0.15s',
].join('; ')

const BTN_PRIMARY_DISABLED = BTN_PRIMARY.replace('#7c3aed', '#a78bfa') + '; cursor: not-allowed'

const BTN_SM_APPROVE = [
  'padding: 5px 12px',
  'background: #059669',
  'color: #fff',
  'border: none',
  'border-radius: 6px',
  'font-size: 12px',
  'font-weight: 500',
  'cursor: pointer',
].join('; ')

const BTN_SM_REJECT = BTN_SM_APPROVE.replace('#059669', '#dc2626')

const SNIPPET_BOX = [
  'margin-top: 12px',
  'padding: 10px 12px',
  'background: #f1f5f9',
  'border: 1px solid #cbd5e1',
  'border-radius: 8px',
].join('; ')

const SNIPPET_LABEL = 'font-size: 12px; color: #64748b; margin-bottom: 6px'

const SNIPPET_CODE = [
  'display: block',
  'font-family: ui-monospace, monospace',
  'font-size: 12px',
  'color: #1e293b',
  'word-break: break-all',
  'white-space: pre-wrap',
  'margin: 0',
].join('; ')

const BTN_COPY = [
  'margin-top: 8px',
  'padding: 5px 10px',
  'background: #e2e8f0',
  'color: #334155',
  'border: none',
  'border-radius: 6px',
  'font-size: 12px',
  'cursor: pointer',
].join('; ')

const CONFIRM_CARD = [
  'padding: 10px 12px',
  'background: #fffbeb',
  'border: 1px solid #fcd34d',
  'border-radius: 8px',
  'margin-top: 8px',
].join('; ')

// ── Status dot ─────────────────────────────────────────────────────────────────

function statusDotColor(status: string): string {
  if (status === 'active') return '#059669'
  if (status === 'minting' || status === 'pending-claude') return '#d97706'
  if (status === 'error') return '#dc2626'
  return '#94a3b8'
}

function statusLabel(status: string): string {
  if (status === 'idle') return 'Idle'
  if (status === 'minting') return 'Minting token…'
  if (status === 'pending-claude') return 'Waiting for Claude'
  if (status === 'active') return 'Connected'
  if (status === 'error') return 'Error'
  return status
}

// ── View ───────────────────────────────────────────────────────────────────────

export function agentPanel(send: Send<Msg>): HTMLElement {
  return div({ style: CARD_STYLE }, [
    // ── Header ──────────────────────────────────────────────────────────────
    div({ style: HEADER_STYLE }, [
      span({
        style: (s: State) =>
          `width: 10px; height: 10px; border-radius: 50%; background: ${statusDotColor(s.agent.connect.status)}; flex-shrink: 0`,
      }),
      span({
        style: 'font-weight: 600; font-size: 13px; color: #334155; flex: 1',
      }, [text('Claude Agent')]),
      span({
        style: (s: State) => `font-size: 12px; color: ${s.agent.connect.status === 'active' ? '#059669' : s.agent.connect.status === 'error' ? '#dc2626' : '#64748b'}`,
      }, [text((s: State) => statusLabel(s.agent.connect.status))]),
    ]),

    // ── Body ────────────────────────────────────────────────────────────────
    div({ style: BODY_STYLE }, [
      // ── Idle: connect button ──────────────────────────────────────────────
      ...branch<State, Msg>({
        on: (s) => s.agent.connect.status,
        cases: {
          idle: () => [
            button(
              {
                style: BTN_PRIMARY,
                onClick: () => send({ type: 'agent', sub: 'connect', msg: { type: 'Mint' } }),
              },
              [text('Connect with Claude')],
            ),
          ],
          minting: () => [
            button(
              { style: BTN_PRIMARY_DISABLED, disabled: true },
              [text('Minting token…')],
            ),
          ],
          'pending-claude': () => [
            p({ style: 'margin: 0 0 10px; font-size: 13px; color: #475569; line-height: 1.5' }, [
              text('Paste this snippet into Claude Desktop to connect:'),
            ]),
            div({ style: SNIPPET_BOX }, [
              p({ style: SNIPPET_LABEL }, [text('Connect snippet')]),
              span({ style: SNIPPET_CODE }, [
                text((s: State) => s.agent.connect.pendingToken?.connectSnippet ?? ''),
              ]),
              button(
                {
                  style: BTN_COPY,
                  onClick: () => {
                    const s = document.querySelector<HTMLElement>('[data-agent-snippet]')
                    const snippet = s?.textContent ?? ''
                    if (snippet && typeof navigator !== 'undefined' && 'clipboard' in navigator) {
                      void navigator.clipboard.writeText(snippet)
                    }
                  },
                },
                [text('Copy')],
              ),
            ]),
            // hidden data-agent-snippet carrier for clipboard read
            span({
              'data-agent-snippet': '',
              style: 'display: none',
            }, [text((s: State) => s.agent.connect.pendingToken?.connectSnippet ?? '')]),
            p({
              style: 'margin: 8px 0 0; font-size: 11px; color: #94a3b8; line-height: 1.4',
            }, [
              text(
                'Tokens are signed with a per-session key — restarting the dev server invalidates them. Set AGENT_SIGNING_KEY for persistence.',
              ),
            ]),
          ],
          active: () => [
            div({
              style: [
                'display: flex',
                'align-items: center',
                'gap: 8px',
                'padding: 10px 12px',
                'background: #f0fdf4',
                'border: 1px solid #86efac',
                'border-radius: 8px',
              ].join('; '),
            }, [
              span({ style: 'font-size: 18px' }, [text('✓')]),
              span({ style: 'font-size: 13px; color: #166534; font-weight: 500' }, [text('Claude is connected')]),
            ]),
          ],
          error: () => [
            div({
              style: [
                'padding: 10px 12px',
                'background: #fef2f2',
                'border: 1px solid #fca5a5',
                'border-radius: 8px',
                'margin-bottom: 10px',
              ].join('; '),
            }, [
              p({ style: 'margin: 0 0 4px; font-size: 13px; color: #991b1b; font-weight: 500' }, [text('Connection error')]),
              p({ style: 'margin: 0; font-size: 12px; color: #b91c1c' }, [
                text((s: State) => s.agent.connect.error?.detail ?? s.agent.connect.error?.code ?? 'Unknown error'),
              ]),
            ]),
            button(
              {
                style: BTN_PRIMARY,
                onClick: () => {
                  send({ type: 'agent', sub: 'connect', msg: { type: 'ClearError' } })
                },
              },
              [text('Try again')],
            ),
          ],
        },
      }),

      // ── Pending confirmations ─────────────────────────────────────────────
      ...branch<State, Msg>({
        on: (s) => s.agent.confirm.pending.some((e) => e.status === 'pending') ? 'has-pending' : 'none',
        cases: {
          'has-pending': () => [
            div({ style: 'margin-top: 14px' }, [
              p({ style: 'margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #92400e; text-transform: uppercase; letter-spacing: 0.05em' }, [
                text('Pending confirmations'),
              ]),
              ...each<State, ConfirmEntry, Msg>({
                items: (s) => s.agent.confirm.pending.filter((e) => e.status === 'pending'),
                key: (e) => e.id,
                render: ({ item, send: innerSend }) => [
                  confirmCard(item, innerSend),
                ],
              }),
            ]),
          ],
          none: () => [],
        },
      }),
    ]),
  ])
}

function confirmCard(item: ItemAccessor<ConfirmEntry>, send: Send<Msg>): HTMLElement {
  const id = item((e) => e.id)()
  return div({ style: CONFIRM_CARD }, [
    p({ style: 'margin: 0 0 4px; font-size: 13px; font-weight: 500; color: #92400e' }, [
      text(item((e) => e.intent)),
    ]),
    p({ style: 'margin: 0 0 10px; font-size: 12px; color: #78350f' }, [
      text(item((e) => e.reason ?? '')),
    ]),
    div({ style: 'display: flex; gap: 8px' }, [
      button(
        {
          style: BTN_SM_APPROVE,
          onClick: () => send({ type: 'agent', sub: 'confirm', msg: { type: 'Approve', id } }),
        },
        [text('Approve')],
      ),
      button(
        {
          style: BTN_SM_REJECT,
          onClick: () => send({ type: 'agent', sub: 'confirm', msg: { type: 'Reject', id } }),
        },
        [text('Reject')],
      ),
    ]),
  ])
}
