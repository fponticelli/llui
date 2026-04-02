import { onMount } from '@llui/core'

/**
 * Minimal Zag service interface — matches what Zag v1 machines produce.
 */
export interface ZagService {
  state: Record<string, unknown>
  send: (event: Record<string, unknown>) => void
  subscribe: (cb: () => void) => () => void
  start: () => void
  stop: () => void
}

export interface UseMachineReturn<Api> {
  api: Api
  service: ZagService
}

/**
 * Bridge a Zag.js machine into LLui's reactivity model.
 *
 * Starts the machine on mount, subscribes to state changes, and returns
 * a live API proxy. When the machine transitions, all LLui bindings that
 * read from the API automatically get fresh values on the next Phase 2
 * pass (because the proxy delegates to the latest connect() output).
 *
 * Usage in view():
 *   const { api } = useMachine(dialog.machine({ id: 'dlg' }), dialog.connect, normalizeProps)
 *   return [
 *     button({ ...spread(api.getTriggerProps()) }, [text('Open')]),
 *   ]
 */
export function useMachine<Api extends Record<string, unknown>>(
  machine: { start: () => ZagService },
  connect: (service: ZagService, normalize: (props: Record<string, unknown>) => Record<string, unknown>) => Api,
  normalize: (props: Record<string, unknown>) => Record<string, unknown>,
): UseMachineReturn<Api> {
  const service = machine.start()

  let currentApi = connect(service, normalize)

  // Subscribe to state changes — refresh the API on each transition
  const unsubscribe = service.subscribe(() => {
    currentApi = connect(service, normalize)
  })

  // Clean up on scope disposal
  onMount(() => {
    return () => {
      unsubscribe()
      service.stop()
    }
  })

  // Proxy that always reads from the latest API
  const proxy = new Proxy({} as Api, {
    get(_, prop: string | symbol) {
      const value = currentApi[prop as keyof Api]
      // If it's a function (prop getter), wrap it to always read fresh
      if (typeof value === 'function') {
        return (...args: unknown[]) => (value as Function)(...args)
      }
      return value
    },
  })

  return { api: proxy, service }
}
