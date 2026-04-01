import type { ChildOptions, ComponentDef } from '../types'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context'
import { createScope, disposeScope } from '../scope'
import { createComponentInstance, flushInstance } from '../update-loop'
import { createBinding } from '../binding'

const FULL_MASK = 0xffffffff

export function child<S, ChildM>(opts: ChildOptions<S, ChildM>): Node[] {
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
  setRenderContext({ ...childInst, send: childInst.send as (msg: unknown) => void })
  const nodes = childDef.view(childInst.state, childInst.send)
  clearRenderContext()
  setRenderContext(parentCtx)

  // Cleanup: dispose child instance when parent scope disposes
  childScope.disposers.push(() => {
    disposeScope(childInst.rootScope)
  })

  return nodes
}
