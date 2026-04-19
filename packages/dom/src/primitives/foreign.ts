import type { ForeignOptions, Send } from '../types.js'
import { getRenderContext } from '../render-context.js'
import { createBinding } from '../binding.js'
import { createLifetime, addDisposer } from '../lifetime.js'

const FULL_MASK = 0xffffffff

export function foreign<S, M, T extends Record<string, unknown>, Instance>(
  opts: ForeignOptions<S, M, T, Instance>,
): Node[] {
  const ctx = getRenderContext('foreign')
  const parentLifetime = ctx.rootLifetime
  const foreignScope = createLifetime(parentLifetime)
  foreignScope._kind = 'foreign'

  // Create container element — cast to HTMLElement since foreign() is
  // HTML-only (no SVG/MathML foreign containers) and HTMLElement is the
  // contract callers see on the `mount({ container })` argument.
  const tag = opts.container?.tag ?? 'div'
  const container = ctx.dom.createElement(tag) as HTMLElement
  if (opts.container?.attrs) {
    for (const [key, value] of Object.entries(opts.container.attrs)) {
      container.setAttribute(key, value)
    }
  }

  // Mount the foreign instance
  const instance = opts.mount({ container, send: ctx.send as Send<M> })

  // Evaluate initial props and call sync
  let prevProps: T | undefined = undefined
  const initialProps = opts.props(ctx.state as S)

  if (typeof opts.sync === 'function') {
    opts.sync({ instance, props: initialProps, prev: undefined })
  } else {
    for (const key of Object.keys(initialProps) as Array<keyof T>) {
      const handler = opts.sync[key]
      if (handler) {
        handler({ instance, value: initialProps[key], prev: undefined })
      }
    }
  }
  prevProps = initialProps

  // Register a binding for the props accessor — fires when state changes
  createBinding(foreignScope, {
    mask: FULL_MASK,
    accessor: ((state: S) => {
      const newProps = opts.props(state)
      // Shallow-diff props
      let changed = false
      if (!prevProps) {
        changed = true
      } else {
        for (const key of Object.keys(newProps) as Array<keyof T>) {
          if (!Object.is(newProps[key], prevProps[key])) {
            changed = true
            break
          }
        }
      }

      if (changed) {
        if (typeof opts.sync === 'function') {
          opts.sync({ instance, props: newProps, prev: prevProps })
        } else {
          for (const key of Object.keys(newProps) as Array<keyof T>) {
            if (!prevProps || !Object.is(newProps[key], prevProps[key])) {
              const handler = opts.sync[key]
              if (handler) {
                handler({ instance, value: newProps[key], prev: prevProps?.[key] })
              }
            }
          }
        }
        prevProps = newProps
      }

      return newProps
    }) as (state: never) => unknown,
    kind: 'text', // kind doesn't matter — applyBinding won't be called
    node: container,
    perItem: false,
  })

  // Destroy on scope disposal
  addDisposer(foreignScope, () => {
    opts.destroy(instance)
  })

  return [container]
}
