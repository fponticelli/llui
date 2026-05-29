import type { SignalComponentDef, SignalComponentHandle } from '@llui/dom/signals'
import { mountApp } from '@llui/dom/signals'

export interface ViewHarness<S, M> {
  /** Mounted container — useful for advanced cases. */
  readonly container: HTMLElement
  /** The handle returned by mountApp — expose dispose/flush. */
  readonly handle: SignalComponentHandle<S, M>
  /** Query a single element. */
  query(selector: string): Element | null
  /** Query all matching elements. */
  queryAll(selector: string): Element[]
  /** Read the element's text content. Returns empty string if the element is missing. */
  text(selector: string): string
  /** Read an element's attribute. */
  attr(selector: string, name: string): string | null
  /** Dispatch a message and flush synchronously. */
  send(msg: M): void
  /** Click an element and flush. Throws if no element matches. */
  click(selector: string): void
  /** Set an input's value and dispatch an 'input' event, then flush. */
  input(selector: string, value: string): void
  /** Dispatch a custom event and flush. Default bubbles: true. */
  fire(selector: string, type: string, init?: EventInit): void
  /** Dispose + remove DOM. Idempotent. */
  unmount(): void
}

/**
 * Mount a component against a fresh container and return an interactive harness.
 * Simulates events + auto-flushes so tests can chain assertions naturally.
 */
export function testView<S, M, E>(def: SignalComponentDef<S, M, E>, state: S): ViewHarness<S, M> {
  const container = document.createElement('div')

  // testView runs the component against the provided `state`, not its
  // own init data — so the inner def overrides `init` to seed it.
  const testDef: SignalComponentDef<S, M, E> = {
    ...def,
    init: () => [state, []],
  }

  const handle = mountApp(container, testDef)
  let disposed = false

  function required(selector: string): Element {
    const el = container.querySelector(selector)
    if (!el) throw new Error(`[testView] no element matches selector ${JSON.stringify(selector)}`)
    return el
  }

  return {
    container,
    handle,
    query: (s) => container.querySelector(s),
    queryAll: (s) => Array.from(container.querySelectorAll(s)),
    text: (s) => container.querySelector(s)?.textContent ?? '',
    attr: (s, name) => container.querySelector(s)?.getAttribute(name) ?? null,
    send(msg) {
      handle.send(msg)
      handle.flush()
    },
    click(selector) {
      const el = required(selector)
      ;(el as HTMLElement).click()
      handle.flush()
    },
    input(selector, value) {
      const el = required(selector) as HTMLInputElement
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      handle.flush()
    },
    fire(selector, type, init) {
      const el = required(selector)
      el.dispatchEvent(new Event(type, { bubbles: true, ...init }))
      handle.flush()
    },
    unmount() {
      if (disposed) return
      disposed = true
      // The signal runtime's dispose() runs teardowns (foreign unmount,
      // subscriptions) but leaves the rendered nodes in place; the harness
      // owns the container, so it clears the DOM it appended.
      handle.dispose()
      container.replaceChildren()
    },
  }
}
