import type { ChildOptions, ComponentDef } from '../types'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context'
import { createScope, disposeScope, addDisposer } from '../scope'
import { createComponentInstance, flushInstance } from '../update-loop'
import { createBinding, setFlatBindings } from '../binding'
import { registerChild, unregisterChild } from '../addressed'

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

  const parentCtx = getRenderContext()
  const parentScope = parentCtx.rootScope
  const childScope = createScope(parentScope)
  const parentSend = parentCtx.send

  const childDef = opts.def as ComponentDef<unknown, ChildM, unknown>
  const initialProps = opts.props(parentCtx.state as S)
  const childInst = createComponentInstance(childDef, initialProps)

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

  // Register a binding on the child scope that watches parent props changes
  createBinding(childScope, {
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
        childInst.send(msg)
        flushInstance(childInst)
      }
      prevProps = { ...newProps }

      return newProps
    }) as (state: never) => unknown,
    kind: 'text',
    node: document.createComment('child:' + opts.key),
    perItem: false,
  })

  // Run the child's view within the child's render context
  setFlatBindings(childInst.allBindings)
  setRenderContext({ ...childInst, send: childInst.send as (msg: unknown) => void })
  const nodes = childDef.view(childInst.state, childInst.send)
  clearRenderContext()
  setFlatBindings(parentCtx.allBindings)
  setRenderContext(parentCtx)

  // Register in component registry for addressed effects
  registerChild(opts.key, { send: childInst.send as (msg: unknown) => void })

  // Cleanup: dispose child instance when parent scope disposes
  addDisposer(childScope, () => {
    unregisterChild(opts.key)
    disposeScope(childInst.rootScope)
  })

  return nodes
}
