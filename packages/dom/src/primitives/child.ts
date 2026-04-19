import type { ChildOptions, ComponentDef } from '../types.js'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context.js'
import { createLifetime, disposeLifetime, addDisposer } from '../lifetime.js'
import { createComponentInstance, flushInstance, type ComponentInstance } from '../update-loop.js'
import { createBinding, setFlatBindings } from '../binding.js'
import { registerChild, unregisterChild } from '../addressed.js'
import { createView } from '../view-helpers.js'

const FULL_MASK = 0xffffffff

export function child<S, ChildM>(opts: ChildOptions<S, ChildM>): Node[] {
  // Dev-mode guard: props must be a function, not a static object
  if (typeof opts.props !== 'function') {
    throw new Error(
      `child("${String(opts.key)}"): props must be a reactive accessor function ` +
        `(s => ({ ... })), not a static object. Static props are captured once at mount ` +
        `and never update.`,
    )
  }

  const parentCtx = getRenderContext('child')
  const parentLifetime = parentCtx.rootLifetime
  const childLifetime = createLifetime(parentLifetime)
  childLifetime._kind = 'child'
  // Tag eagerly: childLifetime lives as long as the child component is mounted,
  // so disposing it IS the child-unmount event. Setting the cause up front
  // (instead of inside the disposer closure below) ensures the parent's
  // _disposerLog sees it when `disposeLifetime` walks up the parent chain —
  // `childInst.rootLifetime` is an orphan (parent = null) and cannot emit.
  childLifetime.disposalCause = 'child-unmount'
  const parentSend = parentCtx.send

  const childDef = opts.def as ComponentDef<unknown, ChildM, unknown, Record<string, unknown>>
  const initialProps = opts.props(parentCtx.state as S)
  // Child component inherits the parent's DOM env — render-context
  // threading means the same env flows from mountApp to child() to any
  // nested primitives inside the child's view.
  const childInst = createComponentInstance(childDef, initialProps, null, parentCtx.dom)

  // Wrap child's send to intercept messages for onMsg → parent
  const originalSend = childInst.send
  childInst.send = (msg: ChildM) => {
    originalSend(msg)
    if (opts.onMsg && parentSend) {
      // Defer to after the child processes — use microtask
      queueMicrotask(() => {
        const parentMsg = opts.onMsg!(msg)
        if (parentMsg != null) {
          parentSend(parentMsg)
        }
      })
    }
  }

  // Track props for shallow-diff
  let prevProps: Record<string, unknown> = { ...initialProps }

  // Register a binding on the child scope that watches parent props changes.
  // This is a side-effect-only (`kind: 'effect'`) binding: Phase 2 runs the
  // accessor purely to fire the diff + propsMsg dispatch below. There is no
  // DOM output — the comment node is a detached anchor kept only so the
  // Binding shape stays uniform with other kinds.
  createBinding(childLifetime, {
    mask: FULL_MASK,
    accessor: ((parentState: S) => {
      const newProps = opts.props(parentState)

      let changed = false
      for (const key of Object.keys(newProps)) {
        if (!Object.is(newProps[key], prevProps[key])) {
          changed = true
          break
        }
      }

      if (changed && childDef.propsMsg) {
        const msg = childDef.propsMsg(newProps)
        // Dispatch via `originalSend` so framework-synthesized propsMsg
        // traffic bypasses the `onMsg` wrapper below. Otherwise a naive
        // `onMsg: m => forward(m)` echoes props/set back to the parent,
        // which mutates parent state, re-fires this accessor, and loops
        // forever.
        originalSend(msg)
        flushInstance(childInst)
      }
      prevProps = { ...newProps }
    }) as (state: never) => unknown,
    kind: 'effect',
    node: parentCtx.dom.createComment('child:' + opts.key),
    perItem: false,
  })

  // Run the child's view within the child's render context
  setFlatBindings(childInst.allBindings)
  setRenderContext({
    ...childInst,
    send: childInst.send as (msg: unknown) => void,
    instance: childInst as ComponentInstance,
  })
  const nodes = childDef.view(createView(childInst.send))
  clearRenderContext()
  setFlatBindings(parentCtx.allBindings)
  setRenderContext(parentCtx)

  // Register in component registry for addressed effects
  registerChild(opts.key, { send: childInst.send as (msg: unknown) => void })

  // Cleanup: dispose child instance when parent scope disposes
  addDisposer(childLifetime, () => {
    unregisterChild(opts.key)
    childInst.rootLifetime.disposalCause = 'child-unmount'
    disposeLifetime(childInst.rootLifetime)
  })

  return nodes
}
