import type { Scope, Binding, BindingKind } from './types'
import { addBinding } from './scope'

export interface CreateBindingOpts {
  mask: number
  accessor: (state: never) => unknown
  kind: BindingKind
  node: Node
  key?: string
  perItem: boolean
}

export function createBinding(scope: Scope, opts: CreateBindingOpts): Binding {
  const binding: Binding = {
    mask: opts.mask,
    accessor: opts.accessor as (state: unknown) => unknown,
    lastValue: undefined,
    kind: opts.kind,
    node: opts.node,
    key: opts.key,
    ownerScope: scope,
    perItem: opts.perItem,
  }

  addBinding(scope, binding)
  return binding
}

export function applyBinding(
  target: { kind: BindingKind; node: Node; key?: string },
  value: unknown,
): void {
  switch (target.kind) {
    case 'text':
      target.node.nodeValue = String(value)
      break

    case 'prop': {
      const el = target.node as HTMLElement
      // DOM properties are set directly (value, checked, disabled, etc.)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(el as any)[target.key!] = value
      break
    }

    case 'attr':
      if (value == null || value === false) {
        ;(target.node as Element).removeAttribute(target.key!)
      } else {
        ;(target.node as Element).setAttribute(target.key!, String(value))
      }
      break

    case 'class':
      ;(target.node as Element).className = value as string
      break

    case 'style':
      if (value == null) {
        ;(target.node as HTMLElement).style.removeProperty(target.key!)
      } else {
        ;(target.node as HTMLElement).style.setProperty(target.key!, value as string)
      }
      break
  }
}
