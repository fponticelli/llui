/**
 * Composition examples for the family's two BEHAVIOUR-ONLY products (#266).
 *
 * `in-view` and `presence` are classified `styleless` on both styling paths:
 * they publish state (`data-state`) for another product to act on and have no
 * surface of their own. A styleless classification is only honest if the
 * product is still USEFUL composed with styled ones, so each gets one real,
 * tested composition with a styled family product:
 *
 *  - `lazyQrCodeInView` — in-view gates the mount of a styled QR code, so the
 *    code (and its encoder, in a real app) costs nothing until it scrolls in.
 *  - `presenceClipboardConfirmation` — presence retains a styled "Copied"
 *    confirmation through its exit animation instead of cutting it off.
 *
 * Both are ordinary components over the real machines — no stand-ins — and
 * both render only parts the baseline and registry paths already style. The
 * Components page documents the same two compositions.
 */
import {
  button,
  component,
  div,
  input,
  onMount,
  path,
  rect,
  show,
  span,
  svg,
  text,
  type SignalComponentDef,
  type Send,
} from '@llui/dom'
import * as clipboard from '../../src/components/clipboard'
import * as inView from '../../src/components/in-view'
import * as presence from '../../src/components/presence'
import * as qrCode from '../../src/components/qr-code'

// ─── in-view → qr-code ───────────────────────────────────────────────────────

export interface LazyQrState {
  inView: inView.InViewState
  qr: qrCode.QrCodeState
}

export type LazyQrMsg = { type: 'inView'; msg: inView.InViewMsg }

/** In-view gates a styled QR code's mount until the placeholder scrolls in. */
export function lazyQrCodeInView(
  qr: qrCode.QrCodeState,
): SignalComponentDef<LazyQrState, LazyQrMsg, never> {
  return component<LazyQrState, LazyQrMsg, never>({
    name: 'LazyQrCodeInView',
    init: () => [{ inView: inView.init(), qr }, []],
    update: (state, msg) => [{ ...state, inView: inView.update(state.inView, msg.msg)[0] }, []],
    view: ({ state, send }) => {
      const toInView: Send<inView.InViewMsg> = (msg) => send({ type: 'inView', msg })
      const watch = inView.connect(state.at('inView'), toInView, { id: 'lazy-qr' })
      const code = qrCode.connect(state.at('qr'), () => {}, { label: 'Share link' })
      return [
        div({ ...watch.root, style: 'min-height: 9rem' }, [
          onMount((root) => {
            const el = root.querySelector('[data-scope="in-view"][data-part="root"]')
            if (el === null) return
            return inView.createObserver(el, toInView, { once: true })
          }),
          show(state.at('inView.visible'), () => [
            div({ ...code.root }, [
              svg({ ...code.svg }, [rect({ ...code.background }), path({ ...code.foreground })]),
              button({ ...code.downloadTrigger }, [text('Download')]),
            ]),
          ]),
        ]),
      ]
    },
  })
}

// ─── presence → clipboard confirmation ────────────────────────────────────────

export interface ClipboardConfirmationState {
  clipboard: clipboard.ClipboardState
  confirmation: presence.PresenceState
}

export type ClipboardConfirmationMsg =
  | { type: 'clipboard'; msg: clipboard.ClipboardMsg }
  | { type: 'confirmation'; msg: presence.PresenceMsg }

/**
 * Presence retains a styled confirmation through its exit: a resolved copy
 * opens it, `reset` closes it, and it unmounts only when its own exit
 * animation ends — never mid-fade.
 */
export function presenceClipboardConfirmation(
  value: string,
): SignalComponentDef<ClipboardConfirmationState, ClipboardConfirmationMsg, never> {
  return component<ClipboardConfirmationState, ClipboardConfirmationMsg, never>({
    name: 'PresenceClipboardConfirmation',
    init: () => [
      { clipboard: clipboard.init({ value }), confirmation: presence.init({ present: false }) },
      [],
    ],
    update: (state, msg) => {
      switch (msg.type) {
        case 'clipboard': {
          const [next] = clipboard.update(state.clipboard, msg.msg)
          // The composition: the clipboard's RESULT drives the presence.
          const confirmation =
            msg.msg.type === 'copied'
              ? presence.update(state.confirmation, { type: 'open' })[0]
              : msg.msg.type === 'reset'
                ? presence.update(state.confirmation, { type: 'close' })[0]
                : state.confirmation
          return [{ clipboard: next, confirmation }, []]
        }
        case 'confirmation':
          return [{ ...state, confirmation: presence.update(state.confirmation, msg.msg)[0] }, []]
      }
    },
    view: ({ state, send }) => {
      const copy = clipboard.connect(state.at('clipboard'), (msg) =>
        send({ type: 'clipboard', msg }),
      )
      const lifecycle = presence.connect(state.at('confirmation'), (msg) =>
        send({ type: 'confirmation', msg }),
      )
      return [
        div({ ...copy.root }, [
          input({ ...copy.input }),
          button({ ...copy.trigger }, [text('Copy')]),
          span({ ...copy.indicator }, [
            text(
              state
                .at('clipboard')
                .map((s) => (s.copied ? 'Copied' : s.failed ? 'Copy failed' : '')),
            ),
          ]),
        ]),
        show(
          state.at('confirmation').map((s) => presence.isMounted(s)),
          () => [span({ ...lifecycle.root }, [text('Copied to clipboard')])],
        ),
      ]
    },
  })
}
