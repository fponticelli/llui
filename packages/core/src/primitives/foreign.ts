import type { ForeignOptions, Send } from '../types'
import { getRenderContext } from '../render-context'
import { createBinding } from '../binding'
import { createScope, addDisposer } from '../scope'

const FULL_MASK = 0xffffffff

export function foreign<S, T extends Record<string, unknown>, Instance>(
  opts: ForeignOptions<S, T, Instance>,
): Node[] {
  const ctx = getRenderContext()
  const parentScope = ctx.rootScope
  const foreignScope = createScope(parentScope)

  // Create container element
  const tag = opts.container?.tag ?? 'div'
  const container = document.createElement(tag)
  if (opts.container?.attrs) {
    for (const [key, value] of Object.entries(opts.container.attrs)) {
      container.setAttribute(key, value)
    }
  }

  // Mount the foreign instance
  const instance = opts.mount(container, ctx.state as Send<unknown>)

  // Evaluate initial props and call sync
  let prevProps: T | undefined = undefined
  const initialProps = opts.props(ctx.state as S)

  if (typeof opts.sync === 'function') {
    opts.sync(instance, initialProps, undefined)
  } else {
    for (const key of Object.keys(initialProps) as Array<keyof T>) {
      const handler = opts.sync[key]
      if (handler) {
        handler(instance, initialProps[key], undefined)
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
          opts.sync(instance, newProps, prevProps)
        } else {
          for (const key of Object.keys(newProps) as Array<keyof T>) {
            if (!prevProps || !Object.is(newProps[key], prevProps[key])) {
              const handler = opts.sync[key]
              if (handler) {
                handler(instance, newProps[key], prevProps?.[key])
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
