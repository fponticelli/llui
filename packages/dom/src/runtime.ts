import { flushInstance } from './update-loop.js'
import type { ComponentInstance } from './update-loop.js'

const activeInstances = new Set<object>()

export function registerInstance(inst: object): void {
  activeInstances.add(inst)
}

export function unregisterInstance(inst: object): void {
  activeInstances.delete(inst)
}

export function flush(): void {
  for (const inst of activeInstances) {
    flushInstance(inst as ComponentInstance)
  }
}
