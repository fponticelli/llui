import { createContext } from '@llui/dom'

/**
 * Dispatchers the AppLayout provides to every page below the slot.
 * Pages can trigger layout operations without importing from the layout
 * component itself — they just `useContext(ToastContext)` and call the
 * methods. The methods close over the layout's `send`, so calls land
 * as messages in the layout's update loop.
 */
export interface ToastDispatcher {
  show: (msg: string) => void
  dismiss: (id: number) => void
}

export const ToastContext = createContext<ToastDispatcher>(undefined, 'Toast')

/**
 * Session dispatchers — any page can trigger login/logout via context
 * without caring about how the AppLayout's session state machine works.
 *
 * Note: this bag is intentionally write-only. The current user is
 * displayed in the layout's own header (which reads layout state
 * directly), not piped down into pages. Pages that need to render
 * "current user" content should receive it via `lluiLayoutData`
 * propagated through `propsMsg`, not via context — context accessors
 * can't reach across instance boundaries to read live layout state.
 */
export interface SessionDispatcher {
  login: (user: string) => void
  logout: () => void
}

export const SessionContext = createContext<SessionDispatcher>(undefined, 'Session')
