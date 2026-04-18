import type { BindingKind } from './types.js'
import { getRenderContext } from './render-context.js'
import { createBinding, applyBinding } from './binding.js'
import { addCheckedItemUpdater } from './lifetime.js'

export function elSplit(
  tag: string,
  staticFn: ((el: HTMLElement) => void) | null,
  events: Array<[string, EventListener]> | null,
  bindings: Array<[number, BindingKind, string, (state: never) => unknown]> | null,
  // Accepts raw strings too (wrapped in Text nodes at append time so
  // user code like `button([], ['Sign in'])` works without an explicit
  // text() wrapper) and nested arrays (flattened one level to match the
  // raw createElement path — supports patterns like `main([pageSlot()])`
  // where pageSlot() returns Node[]).
  children: Array<Node | string | Array<Node | string>> | null,
): HTMLElement {
  const el = document.createElement(tag)

  if (staticFn) {
    staticFn(el)
  }

  if (events) {
    for (const [eventName, handler] of events) {
      el.addEventListener(eventName, handler)
    }
  }

  const ctx = getRenderContext()

  if (bindings) {
    for (const [mask, kind, key, accessor] of bindings) {
      const perItem = accessor.length === 0
      if (perItem) {
        const get = accessor as unknown as () => unknown
        const target = { kind, node: el, key }
        const initial = addCheckedItemUpdater(ctx.rootLifetime, get, (v) => applyBinding(target, v))
        applyBinding(target, initial)
      } else {
        const binding = createBinding(ctx.rootLifetime, {
          mask,
          accessor,
          kind,
          node: el,
          key,
          perItem: false,
        })
        const initialValue = accessor(ctx.state as never)
        binding.lastValue = initialValue
        applyBinding({ kind, node: el, key }, initialValue)
      }
    }
  }

  if (children) {
    for (const child of children) {
      // Strings get wrapped in Text nodes — matches createElement's
      // behavior in elements.ts. Without this, user code that passes
      // raw strings as children (e.g. `button([], ['Sign in'])`) crashes
      // in jsdom with "parameter 1 is not of type 'Node'" during SSR
      // and throws a TypeError in strict browsers.
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child))
      } else if (Array.isArray(child)) {
        // Arrays-in-children are flattened one level. This matches
        // the raw createElement path in elements.ts and makes patterns
        // like `main([pageSlot()])` (where pageSlot() returns Node[])
        // work consistently between raw and compiled call paths.
        // Without this flattening, tests run via vitest pass (raw path
        // flattens) but SSR via the compiler transform crashes with
        // "appendChild parameter is not of type Node".
        for (const node of child) {
          if (typeof node === 'string') {
            el.appendChild(document.createTextNode(node))
          } else {
            el.appendChild(node)
          }
        }
      } else {
        el.appendChild(child)
      }
    }
  }

  return el
}
