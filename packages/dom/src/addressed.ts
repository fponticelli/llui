import type { ComponentDef } from './types.js'
import { setAddressedDispatcher } from './update-loop.js'

export interface AddressedEffect {
  __addressed: true
  __targetKey: string | number
  __msg: unknown
}

// Global component registry — keyed by child key
const registry = new Map<string | number, { send: (msg: unknown) => void }>()

export function registerChild(key: string | number, inst: { send: (msg: unknown) => void }): void {
  registry.set(key, inst)
}

export function unregisterChild(key: string | number): void {
  registry.delete(key)
}

function dispatchAddressed(effect: { __targetKey: string | number; __msg: unknown }): void {
  const target = registry.get(effect.__targetKey)
  if (target) {
    target.send(effect.__msg)
  }
}

// Register the dispatcher — this runs when addressed.ts is first imported
setAddressedDispatcher(dispatchAddressed)

export function isAddressedEffect(effect: unknown): effect is AddressedEffect {
  return (
    typeof effect === 'object' &&
    effect !== null &&
    (effect as AddressedEffect).__addressed === true
  )
}

/**
 * Build a typed address builder from a component definition's `receives` map.
 */
export function addressOf<S, M, E, D = void>(
  def: ComponentDef<S, M, E, D>,
  key: string | number,
): Record<string, (params?: unknown) => AddressedEffect> {
  const receives = def.receives
  if (!receives) return {}

  const builder: Record<string, (params?: unknown) => AddressedEffect> = {}
  for (const [name, handler] of Object.entries(receives)) {
    builder[name] = (params?: unknown) => ({
      __addressed: true,
      __targetKey: key,
      __msg: handler(params),
    })
  }
  return builder
}
