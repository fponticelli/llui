import { onMount } from '@llui/core'
import { normalizeProps } from './normalize-props'

/**
 * Bridge a Zag.js v1 machine into LLui's reactivity model.
 *
 * Usage:
 *   import * as dialog from '@zag-js/dialog'
 *   import { VanillaMachine } from '@zag-js/vanilla'
 *   import { useMachine } from '@llui/zag'
 *   const { api } = useMachine(VanillaMachine, dialog.machine, dialog.connect, { id: 'dlg' })
 */
export function useMachine(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MachineClass: new (config: any, props?: any) => any,
  machineConfig: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect: (service: any, normalize: any) => Record<string, unknown>,
  props?: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { api: Record<string, unknown>; send: (event: any) => void } {
  const machine = new MachineClass(machineConfig, props)
  machine.start()

  let currentApi = connect(machine.service, normalizeProps)

  machine.subscribe(() => {
    currentApi = connect(machine.service, normalizeProps)
  })

  onMount(() => {
    return () => machine.stop()
  })

  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_, prop: string | symbol) {
      const value = currentApi[prop as string]
      if (typeof value === 'function') {
        return (...args: unknown[]) => (value as (...a: unknown[]) => unknown)(...args)
      }
      return value
    },
  })

  return { api: proxy, send: (event) => machine.send(event) }
}
