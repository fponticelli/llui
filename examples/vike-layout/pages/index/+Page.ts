import { component, div, h1, p, button, useContextValue } from '@llui/dom'
import { ToastContext, SessionContext } from '../../src/contexts'

type HomeState = { clicks: number }
type HomeMsg = { type: 'clicked' }

/**
 * Home page — rendered into the AppLayout slot. Uses only the root
 * layout (no dashboard layer). Reads two context values the layout
 * provides and triggers layout-state changes through them.
 *
 * This page demonstrates cross-instance communication: the button
 * handlers call dispatchers that `useContext` resolved from the
 * enclosing layout's providers. No import from the layout's internals
 * — just the context keys from `src/contexts.ts`.
 */
export const Page = component<HomeState, HomeMsg, never>({
  name: 'HomePage',
  init: () => [{ clicks: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'clicked':
        return [{ clicks: state.clicks + 1 }, []]
    }
  },
  view: ({ send, text }) => {
    // useContextValue reads the layout-provided dispatcher bag in
    // one call. The reactive useContext(ctx) form would return an
    // accessor and force `useContext(ToastContext)(undefined as never).show(...)`
    // at every call site — useContextValue gives us toast.show('...')
    // directly because the ToastContext value doesn't depend on state.
    const toast = useContextValue(ToastContext)
    const session = useContextValue(SessionContext)
    return [
      div({ class: 'page page-home' }, [
        h1([text('Welcome')]),
        p([
          text(
            'This is the home page. The layout header above stays mounted across every client navigation — click around the nav links and watch the DOM devtools: only this content replaces, the header does not re-mount.',
          ),
        ]),

        p([text('Click count on this page: '), text((s) => String(s.clicks))]),
        button(
          {
            class: 'primary',
            onClick: () => {
              send({ type: 'clicked' })
              toast.show('You clicked the button')
            },
          },
          [text('Click me (also shows a toast from the layout)')],
        ),

        p([text('Session actions (dispatched through the layout via SessionContext):')]),
        button(
          {
            onClick: () => session.login('alice'),
          },
          [text('Log in as alice')],
        ),
        button(
          {
            onClick: () => session.logout(),
          },
          [text('Log out')],
        ),
      ]),
    ]
  },
})
