import { div, button, span, p, text, branch, each } from '@llui/dom'
import type { State, Msg } from '../types'
import type { Send, Signal } from '@llui/dom'

type AgentState = State['agent']
import { agentConfirm, summarizeDiff } from '@llui/agent/client'
import type { LogEntry } from '@llui/agent/protocol'

type ConfirmEntry = agentConfirm.ConfirmEntry

// How many recent activity entries to show in the panel.
const ACTIVITY_WINDOW = 8

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

const SECTION_LABEL = [
  'margin: 14px 0 8px',
  'font-size: 11px',
  'font-weight: 600',
  'color: #64748b',
  'text-transform: uppercase',
  'letter-spacing: 0.06em',
].join('; ')

const ACTIVITY_ROW = [
  'display: flex',
  'align-items: baseline',
  'gap: 8px',
  'padding: 6px 0',
  'border-top: 1px solid #f1f5f9',
  'font-size: 12px',
  'line-height: 1.4',
].join('; ')

const ACTIVITY_KIND_CHIP = [
  'display: inline-block',
  'min-width: 58px',
  'padding: 2px 6px',
  'border-radius: 4px',
  'font-size: 10px',
  'font-weight: 600',
  'text-transform: uppercase',
  'letter-spacing: 0.04em',
  'text-align: center',
  'flex-shrink: 0',
].join('; ')

const ACTIVITY_TIME =
  'color: #94a3b8; font-size: 10px; flex-shrink: 0; font-variant-numeric: tabular-nums'

const ACTIVITY_TEXT =
  'color: #334155; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap'

const ACTIVITY_DETAIL =
  'display: block; padding: 2px 0 0 66px; color: #64748b; font-size: 11px; line-height: 1.4; font-family: ui-monospace, monospace; word-break: break-all'

const ACTIVITY_DIFF =
  'display: block; padding: 2px 0 0 66px; color: #2563eb; font-size: 10px; font-style: italic'

function activityChipStyle(kind: LogEntry['kind']): string {
  const base = ACTIVITY_KIND_CHIP
  switch (kind) {
    case 'dispatched':
    case 'confirmed':
      return base + '; background: #dcfce7; color: #166534'
    case 'read':
      return base + '; background: #e0e7ff; color: #3730a3'
    case 'proposed':
      return base + '; background: #fef3c7; color: #92400e'
    case 'blocked':
    case 'rejected':
      return base + '; background: #fee2e2; color: #991b1b'
    case 'error':
      return base + '; background: #fee2e2; color: #7f1d1d; font-weight: 700'
    default:
      return base + '; background: #e2e8f0; color: #475569'
  }
}

function relativeTime(now: number, at: number): string {
  const delta = Math.max(0, now - at)
  if (delta < 1000) return 'now'
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`
  return `${Math.floor(delta / 3_600_000)}h`
}

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

export function agentPanel(agent: Signal<AgentState>, send: Send<Msg>): Node {
  return div({ style: CARD_STYLE }, [
    // ── Header ──────────────────────────────────────────────────────────────
    div({ style: HEADER_STYLE }, [
      span({
        style: agent.map(
          (a) =>
            `width: 10px; height: 10px; border-radius: 50%; background: ${statusDotColor(a.connect.status)}; flex-shrink: 0`,
        ),
      }),
      span(
        {
          style: 'font-weight: 600; font-size: 13px; color: #334155; flex: 1',
        },
        [text('Claude Agent')],
      ),
      span(
        {
          style: agent.map(
            (a) =>
              `font-size: 12px; color: ${a.connect.status === 'active' ? '#059669' : a.connect.status === 'error' ? '#dc2626' : '#64748b'}`,
          ),
        },
        [text(agent.map((a) => statusLabel(a.connect.status)))],
      ),
    ]),

    // ── Body ────────────────────────────────────────────────────────────────
    div({ style: BODY_STYLE }, [
      // ── Idle: connect button ──────────────────────────────────────────────
      branch(
        agent.map((a) => a.connect.status),
        {
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
            button({ style: BTN_PRIMARY_DISABLED, disabled: true }, [text('Minting token…')]),
          ],
          'pending-claude': () => [
            p({ style: 'margin: 0 0 10px; font-size: 13px; color: #475569; line-height: 1.5' }, [
              text('Paste this snippet into Claude Desktop to connect:'),
            ]),
            div({ style: SNIPPET_BOX }, [
              p({ style: SNIPPET_LABEL }, [text('Connect snippet')]),
              span({ style: SNIPPET_CODE }, [
                text(agent.map((a) => a.connect.pendingToken?.connectSnippet ?? '')),
              ]),
              button(
                {
                  style: agent.map((a) =>
                    a.ui.copied ? BTN_COPY + '; background: #dcfce7; color: #166534' : BTN_COPY,
                  ),
                  onClick: () => send({ type: 'agent', sub: 'ui', msg: { type: 'Copy' } }),
                },
                [text(agent.map((a) => (a.ui.copied ? 'Copied!' : 'Copy')))],
              ),
            ]),
            p(
              {
                style: 'margin: 8px 0 0; font-size: 11px; color: #94a3b8; line-height: 1.4',
              },
              [
                text(
                  'Tokens are signed with a per-session key — restarting the dev server invalidates them. Set AGENT_SIGNING_KEY for persistence.',
                ),
              ],
            ),
          ],
          active: () => [
            branch(
              agent.map((a) => (a.log.entries.length > 0 ? 'hidden' : 'visible')),
              {
                visible: () => [
                  div(
                    {
                      style: [
                        'display: flex',
                        'align-items: center',
                        'gap: 8px',
                        'padding: 10px 12px',
                        'background: #f0fdf4',
                        'border: 1px solid #86efac',
                        'border-radius: 8px',
                      ].join('; '),
                    },
                    [
                      span({ style: 'font-size: 18px' }, [text('✓')]),
                      span({ style: 'font-size: 13px; color: #166534; font-weight: 500' }, [
                        text('Claude is connected'),
                      ]),
                    ],
                  ),
                ],
                hidden: () => [],
              },
            ),
          ],
          error: () => [
            div(
              {
                style: [
                  'padding: 10px 12px',
                  'background: #fef2f2',
                  'border: 1px solid #fca5a5',
                  'border-radius: 8px',
                  'margin-bottom: 10px',
                ].join('; '),
              },
              [
                p({ style: 'margin: 0 0 4px; font-size: 13px; color: #991b1b; font-weight: 500' }, [
                  text('Connection error'),
                ]),
                p({ style: 'margin: 0; font-size: 12px; color: #b91c1c' }, [
                  text(
                    agent.map(
                      (a) => a.connect.error?.detail ?? a.connect.error?.code ?? 'Unknown error',
                    ),
                  ),
                ]),
              ],
            ),
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
      ),

      // ── Pending confirmations ─────────────────────────────────────────────
      branch(
        agent.map((a) =>
          a.confirm.pending.some((e) => e.status === 'pending') ? 'has-pending' : 'none',
        ),
        {
          'has-pending': () => [
            div({ style: 'margin-top: 14px' }, [
              p(
                {
                  style:
                    'margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #92400e; text-transform: uppercase; letter-spacing: 0.05em',
                },
                [text('Pending confirmations')],
              ),
              each(
                agent.map((a) => a.confirm.pending.filter((e) => e.status === 'pending')),
                {
                  key: (e) => e.id,
                  render: (item) => [confirmCard(item, send)],
                },
              ),
            ]),
          ],
          none: () => [],
        },
      ),

      // ── Recent activity ───────────────────────────────────────────────────
      branch(
        agent.map((a) => (a.log.entries.length > 0 ? 'has-activity' : 'none')),
        {
          'has-activity': () => [
            p({ style: SECTION_LABEL }, [text('Recent activity')]),
            each(
              agent.map((a) => a.log.entries.slice(-ACTIVITY_WINDOW).slice().reverse()),
              {
                key: (e) => e.id,
                render: (item) => [activityRow(item)],
              },
            ),
          ],
          none: () => [],
        },
      ),
    ]),
  ])
}

function activityRow(item: Signal<LogEntry>): Node {
  const entry = item.peek()
  const kind = entry.kind
  const at = entry.at
  const detail = entry.detail
  const diffSummary = summarizeDiff(entry.stateDiff)
  // The diff line only shows for dispatched entries that actually mutated
  // state — surfacing "no changes" for read entries would be noise.
  const showDiff = kind === 'dispatched' && diffSummary !== 'no changes'
  return div({ style: 'padding: 6px 0; border-top: 1px solid #f1f5f9' }, [
    div({ style: 'display: flex; align-items: baseline; gap: 8px; font-size: 12px' }, [
      span({ style: activityChipStyle(kind) }, [text(kind)]),
      span({ style: ACTIVITY_TEXT }, [text(item.map((e) => e.intent ?? e.variant ?? '—'))]),
      span({ style: ACTIVITY_TIME }, [text(relativeTime(Date.now(), at))]),
    ]),
    ...(detail ? [span({ style: ACTIVITY_DETAIL }, [text(detail)])] : []),
    ...(showDiff ? [span({ style: ACTIVITY_DIFF }, [text(diffSummary)])] : []),
  ])
}

function confirmCard(item: Signal<ConfirmEntry>, send: Send<Msg>): Node {
  const id = item.peek().id
  return div({ style: CONFIRM_CARD }, [
    p({ style: 'margin: 0 0 4px; font-size: 13px; font-weight: 500; color: #92400e' }, [
      text(item.at('intent')),
    ]),
    p({ style: 'margin: 0 0 10px; font-size: 12px; color: #78350f' }, [
      text(item.map((e) => e.reason ?? '')),
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
