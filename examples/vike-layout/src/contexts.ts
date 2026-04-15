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
 */
export interface SessionDispatcher {
  login: (user: string) => void
  logout: () => void
  getUser: () => string | null
}

export const SessionContext = createContext<SessionDispatcher>(undefined, 'Session')
