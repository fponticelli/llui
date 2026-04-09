import type { Send } from '@llui/dom'

/**
 * In View — tracks whether an element is visible in the viewport
 * using IntersectionObserver.
 *
 * State machine: `{ visible: false }` → enter → `{ visible: true }` → leave → …
 *
 * With `once: true`, the observer disconnects after the first enter,
 * keeping `visible: true` permanently. Useful for lazy-load and
 * scroll-triggered animations.
 *
 * ```ts
 * const parts = inView.connect<State>(s => s.iv, sendIv, { id: 'hero' })
 *
 * view: () => [
 *   div({ ...parts.root, class: (s) => s.iv.visible ? 'fade-in' : '' }, [
 *     // content that animates on scroll
 *   ]),
 * ]
 * ```
 *
 * Wire up the observer in `onMount`:
 * ```ts
 * onMount((el) => inView.createObserver(el, sendIv, { threshold: 0.5, once: true }))
 * ```
 */

export interface InViewState {
  visible: boolean
}

export type InViewMsg = { type: 'enter' } | { type: 'leave' }

export function init(): InViewState {
  return { visible: false }
}

export function update(state: InViewState, msg: InViewMsg): [InViewState, never[]] {
  switch (msg.type) {
    case 'enter':
      return state.visible ? [state, []] : [{ visible: true }, []]
    case 'leave':
      return state.visible ? [{ visible: false }, []] : [state, []]
  }
}

export interface InViewParts<S> {
  root: {
    'data-scope': 'in-view'
    'data-part': 'root'
    'data-state': (s: S) => 'visible' | 'hidden'
  }
}

export interface ConnectOptions {
  id: string
}

export function connect<S>(
  get: (s: S) => InViewState,
  _send: Send<InViewMsg>,
  _opts: ConnectOptions,
): InViewParts<S> {
  return {
    root: {
      'data-scope': 'in-view',
      'data-part': 'root',
      'data-state': (s) => (get(s).visible ? 'visible' : 'hidden'),
    },
  }
}

export interface ObserverOptions {
  threshold?: number
  rootMargin?: string
  once?: boolean
}

/**
 * Create an IntersectionObserver for the given element. Returns a cleanup
 * function that disconnects the observer.
 *
 * Call this inside `onMount`:
 * ```ts
 * onMount((el) => inView.createObserver(el, send, { once: true }))
 * ```
 */
export function createObserver(
  el: Element,
  send: Send<InViewMsg>,
  opts: ObserverOptions = {},
): () => void {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          send({ type: 'enter' })
          if (opts.once) {
            observer.disconnect()
            return
          }
        } else {
          send({ type: 'leave' })
        }
      }
    },
    {
      threshold: opts.threshold ?? 0,
      rootMargin: opts.rootMargin ?? '0px',
    },
  )

  observer.observe(el)
  return () => observer.disconnect()
}

export const inView = { init, update, connect, createObserver }
