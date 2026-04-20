import { div, button, textarea, text } from '@llui/dom'
import type { State, Msg } from '../types'
import type { Send } from '@llui/dom'

export function agentPanel(send: Send<Msg>): HTMLElement {
  return div({ class: 'agent-panel' }, [
    // ── Connect with Claude button ────────────────────────────────
    button(
      {
        class: 'agent-connect-btn',
        onClick: () =>
          send({
            type: 'agent',
            sub: 'connect',
            msg: { type: 'Mint' },
          }),
        disabled: (s: State) =>
          s.agent.connect.status === 'minting' ||
          s.agent.connect.status === 'pending-claude' ||
          s.agent.connect.status === 'active',
      },
      [
        text(
          (s: State) =>
            s.agent.connect.status === 'active'
              ? 'Connected with Claude'
              : s.agent.connect.status === 'minting'
                ? 'Connecting…'
                : 'Connect with Claude',
        ),
      ],
    ),

    // ── Pending token / connect snippet ──────────────────────────
    div(
      {
        class: 'agent-snippet-box',
        hidden: (s: State) => s.agent.connect.pendingToken === null,
      },
      [
        div({ class: 'agent-snippet-label' }, [
          text('Paste this snippet into Claude Desktop:'),
        ]),
        textarea(
          {
            class: 'agent-snippet-textarea',
            readOnly: true,
          },
          [text((s: State) => s.agent.connect.pendingToken?.connectSnippet ?? '')],
        ),
        button(
          {
            class: 'agent-copy-btn',
            onClick: () => {
              // Copy is handled by the button handler reading current DOM value;
              // we dispatch a no-op and rely on clipboard API in the handler.
              if (typeof navigator !== 'undefined' && 'clipboard' in navigator) {
                const ta = document.querySelector<HTMLTextAreaElement>('.agent-snippet-textarea')
                if (ta) void navigator.clipboard.writeText(ta.value)
              }
            },
          },
          [text('Copy')],
        ),
      ],
    ),

    // ── Pending confirmations ─────────────────────────────────────
    div(
      {
        class: 'agent-confirm-list',
        hidden: (s: State) => s.agent.confirm.pending.filter((e) => e.status === 'pending').length === 0,
      },
      [
        div({ class: 'agent-confirm-heading' }, [text('Pending confirmations')]),
        div(
          { class: 'agent-confirm-entries' },
          [
            // Dynamic list rendered via show/each isn't available at view-init
            // time without the full View bag; we render a placeholder text node
            // that the user sees only when the parent is visible. A real
            // production implementation would use `each` from the View bag.
            text(
              (s: State) =>
                s.agent.confirm.pending
                  .filter((e) => e.status === 'pending')
                  .map((e) => `"${e.intent}"`)
                  .join(', '),
            ),
            button(
              {
                class: 'agent-approve-all-btn',
                hidden: (s: State) =>
                  s.agent.confirm.pending.filter((e) => e.status === 'pending').length === 0,
                onClick: () => {
                  // Approve the first pending entry found via DOM state
                  const btn = document.querySelector<HTMLElement>('[data-confirm-id]')
                  if (btn) {
                    const id = btn.dataset['confirmId']
                    if (id)
                      send({ type: 'agent', sub: 'confirm', msg: { type: 'Approve', id } })
                  }
                },
              },
              [text('Approve')],
            ),
            button(
              {
                class: 'agent-reject-all-btn',
                hidden: (s: State) =>
                  s.agent.confirm.pending.filter((e) => e.status === 'pending').length === 0,
                onClick: () => {
                  const btn = document.querySelector<HTMLElement>('[data-confirm-id]')
                  if (btn) {
                    const id = btn.dataset['confirmId']
                    if (id)
                      send({ type: 'agent', sub: 'confirm', msg: { type: 'Reject', id } })
                  }
                },
              },
              [text('Reject')],
            ),
          ],
        ),
      ],
    ),
  ])
}
