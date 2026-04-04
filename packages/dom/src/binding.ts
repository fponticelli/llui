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

let flatBindings: Binding[] | null = null
let flatBindingsByBit: Map<number, Binding[]> | null = null

export function getFlatBindings(): Binding[] | null {
  return flatBindings
}

export function setFlatBindings(arr: Binding[] | null, byBit?: Map<number, Binding[]> | null): void {
  flatBindings = arr
  flatBindingsByBit = byBit ?? null
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
    dead: false,
  }

  addBinding(scope, binding)
  if (flatBindings) flatBindings.push(binding)
  if (flatBindingsByBit) indexBinding(flatBindingsByBit, binding)

  return binding
}

function indexBinding(byBit: Map<number, Binding[]>, binding: Binding): void {
  const mask = binding.mask
  if (mask === (0xffffffff | 0) || mask === -1) {
    // FULL_MASK → bucket 0 (always checked)
    let bucket = byBit.get(0)
    if (!bucket) { bucket = []; byBit.set(0, bucket) }
    bucket.push(binding)
  } else {
    // Index into each bit bucket
    for (let bit = 1; bit !== 0; bit <<= 1) {
      if (mask & bit) {
        let bucket = byBit.get(bit)
        if (!bucket) { bucket = []; byBit.set(bit, bucket) }
        bucket.push(binding)
      }
    }
  }
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
