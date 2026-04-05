import type { ComponentDef, AppHandle } from '@llui/dom'
import { mountApp } from '@llui/dom'

export interface ViewHarness<M> {
  /** Mounted container — useful for advanced cases. */
  readonly container: HTMLElement
  /** The AppHandle returned by mountApp — expose dispose/flush. */
  readonly handle: AppHandle
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
export function testView<S, M, E>(def: ComponentDef<S, M, E>, state: S): ViewHarness<M> {
  const container = document.createElement('div')

  const testDef: ComponentDef<S, M, E> = {
    ...def,
    init: () => [state, []],
  }

  // Capture the component's send via a view interceptor.
  let sendFn: ((msg: M) => void) | null = null
  const originalView = testDef.view
  testDef.view = (send) => {
    sendFn = send
    return originalView(send)
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
      if (!sendFn) throw new Error('[testView] send unavailable (mount failed?)')
      sendFn(msg)
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
      handle.dispose()
    },
  }
}
