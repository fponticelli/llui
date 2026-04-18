import type { Lifetime, Binding, BindingKind } from './types.js'
import { addBinding } from './lifetime.js'

export interface CreateBindingOpts {
  mask: number
  accessor: (state: never) => unknown
  kind: BindingKind
  node: Node
  key?: string
  perItem: boolean
}

let flatBindings: Binding[] | null = null

export function getFlatBindings(): Binding[] | null {
  return flatBindings
}

export function setFlatBindings(arr: Binding[] | null): void {
  flatBindings = arr
}

export function createBinding(scope: Lifetime, opts: CreateBindingOpts): Binding {
  const binding: Binding = {
    mask: opts.mask,
    accessor: opts.accessor as (state: unknown) => unknown,
    lastValue: undefined,
    kind: opts.kind,
    node: opts.node,
    key: opts.key,
    ownerLifetime: scope,
    perItem: opts.perItem,
    dead: false,
  }

  addBinding(scope, binding)
  if (flatBindings) flatBindings.push(binding)

  return binding
}

export function applyBinding(
  target: { kind: BindingKind; node: Node; key?: string },
  value: unknown,
): void {
  // Defensive guard: if a reactive accessor leaks through as a raw
  // function value, emitting its `.toString()` into the DOM (e.g. as
  // an attribute) would be a silent correctness bug that only surfaces
  // on server-rendered pages. Throw loudly so the callsite is obvious.
  // Event handlers (onXxx → 'prop' kind) are NOT handled here; events
  // are registered via addEventListener in the element helpers, not
  // via applyBinding.
  if (typeof value === 'function') {
    throw new TypeError(
      `[LLui] applyBinding(${target.kind}${target.key ? `, '${target.key}'` : ''}) received ` +
        `a function as its value. This means an accessor wasn't invoked before ` +
        `reaching the binding layer — usually a bug in a compiled binding tuple or ` +
        `in a helper that forwards props without calling them. The arrow's source ` +
        `would have been serialized into the DOM otherwise. Offender: ${value.toString().slice(0, 120)}`,
    )
  }

  switch (target.kind) {
    case 'effect':
      // Side-effect-only binding — the accessor already ran for its
      // side effects in Phase 2. We keep `applyBinding` callable for
      // type-uniform call sites, but there is no DOM write to perform.
      break

    case 'text':
      target.node.nodeValue = String(value)
      break

    case 'prop': {
      const el = target.node as HTMLElement
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(el as any)[target.key!] = value
      break
    }

    case 'attr':
      if (value == null) {
        ;(target.node as Element).removeAttribute(target.key!)
      } else if (value === false) {
        // ARIA attributes need explicit "false"; others are removed
        if (target.key!.startsWith('aria-')) {
          ;(target.node as Element).setAttribute(target.key!, 'false')
        } else {
          ;(target.node as Element).removeAttribute(target.key!)
        }
      } else {
        ;(target.node as Element).setAttribute(target.key!, String(value))
      }
      break

    case 'class':
      ;(target.node as Element).setAttribute('class', value as string)
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
