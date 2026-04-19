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

  // Instance may resolve synchronously or asynchronously. `instance ===
  // undefined` means "not ready yet" — `sync` is suppressed and the
  // binding below only tracks `latestProps`. When the instance arrives,
  // an initial `sync` runs with `latestProps` (may differ from the props
  // at mount time if state changed while awaiting).
  const mountResult = opts.mount({ container, send: ctx.send as Send<M> })
  let instance: Instance | undefined = undefined
  let disposed = false
  let latestProps: T = opts.props(ctx.state as S)
  let syncedProps: T | undefined = undefined

  const callSync = (props: T, prev: T | undefined) => {
    if (typeof opts.sync === 'function') {
      opts.sync({ instance: instance as Instance, props, prev })
    } else {
      for (const key of Object.keys(props) as Array<keyof T>) {
        if (!prev || !Object.is(props[key], prev[key])) {
          const handler = opts.sync[key]
          if (handler) {
            handler({ instance: instance as Instance, value: props[key], prev: prev?.[key] })
          }
        }
      }
    }
    syncedProps = props
  }

  const isPromise = (v: unknown): v is Promise<Instance> =>
    typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function'

  if (isPromise(mountResult)) {
    mountResult.then(
      (resolved) => {
        // Dispose-before-resolve: still destroy so the library cleans up
        // whatever it allocated. Bail before calling sync.
        if (disposed) {
          opts.destroy(resolved)
          return
        }
        instance = resolved
        // Initial sync runs with the latest props the binding observed
        // while we were awaiting. `prev: undefined` matches the sync-
        // path semantics for the first sync call.
        callSync(latestProps, undefined)
      },
      (err) => {
        // Async mount failures shouldn't crash the app. Log once and
        // leave the container empty — caller can inspect the DOM to
        // detect the mount failed. `errorBoundary` catches sync mount
        // throws but can't reach async rejections through the microtask
        // queue, which is why we log here instead of re-throwing.
        console.error('[LLui] foreign({ mount }) promise rejected:', err)
      },
    )
  } else {
    instance = mountResult
    callSync(latestProps, undefined)
  }

  // Register a binding for the props accessor — fires when state changes
  createBinding(foreignScope, {
    mask: FULL_MASK,
    accessor: ((state: S) => {
      const newProps = opts.props(state)
      // Shallow-diff against whichever we have: syncedProps is the
      // truth once the instance is live; while still pending, latestProps
      // is the most recent thing we've observed.
      const compareTo = syncedProps ?? latestProps
      const changed = !shallowEqual(newProps, compareTo)

      if (changed) {
        latestProps = newProps
        // Only sync if the instance is ready. If not, `latestProps`
        // is updated and resolve will flush it.
        if (instance !== undefined) {
          callSync(newProps, syncedProps)
        }
      }

      return newProps
    }) as (state: never) => unknown,
    kind: 'text', // kind doesn't matter — applyBinding won't be called
    node: container,
    perItem: false,
  })

  // Destroy on scope disposal. If the mount promise is still pending,
  // flip the disposed flag so the resolve handler takes the
  // dispose-before-resolve path.
  addDisposer(foreignScope, () => {
    disposed = true
    if (instance !== undefined) {
      opts.destroy(instance)
    }
    // If instance is still undefined, the promise will destroy on resolve.
  })

  return [container]
}

function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  for (const key of Object.keys(a) as Array<keyof T>) {
    if (!Object.is(a[key], b[key])) return false
  }
  for (const key of Object.keys(b) as Array<keyof T>) {
    if (!(key in a)) return false
  }
  return true
}
