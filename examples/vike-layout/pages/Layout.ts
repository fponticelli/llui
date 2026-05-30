import { component, div, header, main, nav, a, span, button, text, each, provide } from '@llui/dom'
import { pageSlot } from '@llui/vike/client'
import { ToastContext, SessionContext } from '../src/contexts'

interface Toast {
  id: number
  msg: string
}

type AppLayoutState = {
  user: string | null
  toasts: readonly Toast[]
  nextToastId: number
}

type AppLayoutMsg =
  /**
   * @intent("Set the logged-in user; pages observe via SessionContext")
   * @example({"type":"session/login","user":"alice"})
   */
  | { type: 'session/login'; user: string }
  /** @intent("Clear the logged-in user; pages observe via SessionContext") */
  | { type: 'session/logout' }
  /**
   * @intent("Push a transient notification onto the layout's toast stack")
   * @example({"type":"toast/show","msg":"Saved."})
   */
  | { type: 'toast/show'; msg: string }
  /**
   * @intent("Remove a previously-shown toast by id")
   * @example({"type":"toast/dismiss","id":3})
   */
  | { type: 'toast/dismiss'; id: number }

/**
 * Root layout. Mounted once on first page load, stays alive across
 * every client navigation — header, nav links, session state, and
 * the toast queue all survive page swaps.
 *
 * Exposes two context values for pages below the slot:
 *
 *   - `ToastContext` — show/dismiss dispatchers for pages to push
 *     notifications into the layout's toast stack.
 *   - `SessionContext` — login/logout dispatchers and a getter for
 *     the current user so pages can trigger session changes without
 *     touching this layout's state directly.
 *
 * Both dispatchers close over the layout's `send`, so calls to them
 * land as messages in this layout's update loop.
 */
export const AppLayout = component<AppLayoutState, AppLayoutMsg, never>({
  name: 'AppLayout',
  init: () => [{ user: null, toasts: [], nextToastId: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'session/login':
        return [{ ...state, user: msg.user }, []]
      case 'session/logout':
        return [{ ...state, user: null }, []]
      case 'toast/show':
        return [
          {
            ...state,
            toasts: [...state.toasts, { id: state.nextToastId, msg: msg.msg }],
            nextToastId: state.nextToastId + 1,
          },
          [],
        ]
      case 'toast/dismiss':
        return [{ ...state, toasts: state.toasts.filter((t) => t.id !== msg.id) }, []]
    }
  },
  view: ({ state, send }) => [
    div({ class: 'app-shell' }, [
      header({ class: 'app-header' }, [
        div({ class: 'app-logo' }, [text('llui/vike layout demo')]),
        nav({ class: 'app-nav' }, [
          a({ href: '/', class: 'nav-link' }, [text('Home')]),
          a({ href: '/dashboard/overview', class: 'nav-link' }, [text('Dashboard')]),
          a({ href: '/dashboard/reports', class: 'nav-link' }, [text('Reports')]),
          a({ href: '/settings', class: 'nav-link' }, [text('Settings')]),
        ]),
        div({ class: 'app-session' }, [
          span({ class: 'session-user' }, [
            text(state.map((s) => (s.user ? `Logged in as ${s.user}` : 'Not logged in'))),
          ]),
        ]),
      ]),

      // Toast stack rendered from layout state. Pages push into this
      // stack via ToastContext.show() below — the notifications appear
      // in persistent chrome and survive client navigation.
      div({ class: 'toast-stack' }, [
        each(
          state.map((s) => s.toasts),
          {
            key: (toast) => toast.id,
            render: (item) => [
              div({ class: 'toast' }, [
                span({ class: 'toast-msg' }, [text(item.map((t) => t.msg))]),
                button(
                  {
                    class: 'toast-dismiss',
                    'aria-label': 'Dismiss notification',
                    onClick: () => send({ type: 'toast/dismiss', id: item.peek().id }),
                  },
                  [text('×')],
                ),
              ]),
            ],
          },
        ),
      ]),

      // Two stable dispatcher bags wrap the main content region. Each
      // exposes methods that close over `send`, so any page below the slot
      // can read them via `useContext` and trigger layout state changes
      // without direct coupling. Both contexts are state-independent, so a
      // build-time `provide` value is exactly right. `provide` returns a
      // single Node; `pageSlot()` likewise.
      provide(
        ToastContext,
        {
          show: (msg: string) => send({ type: 'toast/show', msg }),
          dismiss: (id: number) => send({ type: 'toast/dismiss', id }),
        },
        () => [
          provide(
            SessionContext,
            {
              login: (user: string) => send({ type: 'session/login', user }),
              logout: () => send({ type: 'session/logout' }),
            },
            () => [main({ class: 'app-main' }, [pageSlot()])],
          ),
        ],
      ),
    ]),
  ],
})
