// ── Handler Chain ─────────────────────────────────────────────────

import {
  createDispatch,
  type Deps,
  type DispatchFn,
  type InternalHandler,
  type InternalSend,
  type PluginFn,
  type Registry,
  type Runner,
} from './core.js'
import { defaultRunners } from './default-runners.js'

export interface EffectCtx<E, M> {
  effect: E
  send: (msg: M) => void
  signal: AbortSignal
}

/** Plugin handler — returns true if the effect was handled, false to pass through. */
export type EffectPlugin<E, M> = (ctx: EffectCtx<E, M>) => boolean

export interface EffectChain<E extends { type: string }, M> {
  /**
   * Add a plugin that handles specific effects. Returns true if handled, false to
   * pass through. Plugins run BEFORE the built-in runners on every dispatch, so a
   * plugin can intercept even a built-in kind (e.g. `http`) — the first plugin to
   * return `true` wins and the built-in handler never runs. `E2` is constrained to
   * a subtype of the chain's effect type `E`.
   */
  use<E2 extends E, M2 = M>(plugin: EffectPlugin<E2, M2>): EffectChain<E, M>
  /** Terminal handler for remaining effects. Returns the final onEffect function. */
  else(handler: (ctx: EffectCtx<E, M>) => void): (ctx: EffectCtx<E, M>) => void
}

/**
 * Build a handler chain over an explicit set of runners. `handleEffects()` is
 * this with the batteries-included {@link defaultRunners}; pass a hand-picked
 * subset here to tree-shake unused runner code out of the bundle.
 *
 * Per-mount registries are keyed off each mount's lifecycle `AbortSignal` (a
 * `WeakMap` so a torn-down mount's registry is collectible once its signal is
 * unreachable). One registry is created lazily per distinct signal — i.e. per
 * mount — and torn down exactly once when that signal aborts. Keying off the
 * signal (rather than a chain-level closure) keeps two concurrent mounts of the
 * same component isolated: disposing one never cancels the other's in-flight
 * http / intervals / debounces / websockets.
 */
export function handleEffectsWith<E extends { type: string }, M = never>(
  runners: readonly Runner[],
): EffectChain<E, M> {
  const registries = new WeakMap<AbortSignal, Registry>()
  const plugins: PluginFn[] = []
  const dispatch: DispatchFn = createDispatch(runners)

  function registryFor(signal: AbortSignal): Registry {
    const cached = registries.get(signal)
    if (cached) return cached
    const registry: Registry = {
      cancelControllers: new Map(),
      debounceTimers: new Map(),
      websockets: new Map(),
    }
    registries.set(signal, registry)
    if (!signal.aborted) {
      signal.addEventListener(
        'abort',
        () => {
          for (const ctrl of registry.cancelControllers.values()) ctrl.abort()
          registry.cancelControllers.clear()
          for (const timer of registry.debounceTimers.values()) clearTimeout(timer)
          registry.debounceTimers.clear()
          for (const ws of registry.websockets.values()) {
            ws.onclose = null // don't dispatch app onClose after unmount
            ws.close()
          }
          registry.websockets.clear()
          registries.delete(signal)
        },
        { once: true },
      )
    }
    return registry
  }

  const chain: EffectChain<E, M> = {
    use(plugin) {
      plugins.push(plugin as PluginFn)
      return chain
    },
    else(handler) {
      // Terminal handler for effects that no plugin and no built-in claimed.
      // Plugins have already run (at the top of `dispatch`), so this only ever
      // forwards genuinely custom effects to the user handler.
      const custom: InternalHandler = (effect, send, signal) => {
        // `send` is `InternalSend` (`(msg: unknown) => void`); a handler that only
        // accepts `M` accepts an `unknown` message too (params are contravariant),
        // so no cast is needed. `effect` widens from the erased supertype to `E`.
        handler({
          effect: effect as E,
          send,
          signal,
        })
      }
      return ({ effect, send, signal }: EffectCtx<E, M>) => {
        const deps: Deps = { registry: registryFor(signal), custom, plugins, dispatch }
        // `InternalSend` is intentionally message-type-erased (`(msg: unknown) =>
        // void`) so the dispatch core can synthesize dynamic messages (e.g. an http
        // `onSuccess` result). The app's `send` accepts its own `M`; the runtime
        // only ever feeds it `M`-shaped messages, so widening its input to `unknown`
        // here is the one deliberate, sound boundary — a single downcast, not an
        // `as unknown as`.
        dispatch(effect, send as InternalSend, signal, deps)
      }
    },
  }

  return chain
}

/**
 * Batteries-included handler chain — handles every built-in effect out of the box.
 * See {@link handleEffectsWith} for the tree-shakeable, hand-picked-runner form.
 */
export function handleEffects<E extends { type: string }, M = never>(): EffectChain<E, M> {
  return handleEffectsWith<E, M>(defaultRunners)
}

/**
 * Adapt a `handleEffects()` chain (the `(ctx) => void` returned by `.else()`) to
 * the signal-runtime `onEffect` shape: `(effect, api) => cleanup`.
 *
 * The signal runtime now hands `onEffect` a per-mount `api.signal` (an
 * `AbortSignal` aborted exactly once, on THIS mount's `dispose()`). When present,
 * this adapter passes that signal straight through to the chain: every mount owns
 * a distinct signal, so the chain keys its per-mount registries off it and two
 * concurrent mounts of one definition never interfere. Teardown is driven by the
 * runtime aborting `api.signal`, so the returned cleanup is a no-op — the chain's
 * own abort listener clears the mount's pending http / debounce / interval /
 * websocket resources. We must NOT abort `api.signal` ourselves (it is the
 * runtime's, shared with everything else on the mount).
 *
 * FALLBACK: when no `api.signal` is supplied (a bare unit test, or a non-signal
 * caller), the adapter owns one AbortController PER MOUNT, keyed off the mount's
 * `send` identity in a `WeakMap`. The runtime passes ONE stable `send` per mount
 * for every effect it emits, so all of a mount's effects share that mount's
 * controller — and two CONCURRENT mounts of the same definition get DISTINCT
 * controllers (distinct `send`s). That isolation is the point: disposing mount A
 * must never abort mount B's in-flight http. Controllers are created lazily —
 * never at factory-call time, since `asOnEffect` typically runs at module
 * top-level where constructing an AbortController throws on Cloudflare Workers —
 * and recreated if a stale (aborted) one is found under a reused `send`, so a
 * re-mount never inherits a dead signal. The returned cleanup captures the
 * controller live at ITS dispatch, so a late unmount of one mount never tears
 * down a later mount's effects.
 *
 * Usage: `onEffect: asOnEffect(handleEffects<E, M>().use(…).else(…))`.
 */
export function asOnEffect<E extends { type: string }, M>(
  chain: (ctx: EffectCtx<E, M>) => void,
): (effect: E, api: { send: (msg: M) => void; signal?: AbortSignal }) => () => void {
  const noop = (): void => {}
  const controllers = new WeakMap<(msg: M) => void, AbortController>()
  return (effect, { send, signal }) => {
    if (signal) {
      // Per-mount signal from the runtime — teardown is the runtime's job.
      chain({ effect, send, signal })
      return noop
    }
    // Fallback: one controller per mount, keyed off `send`, recreated once aborted.
    let controller = controllers.get(send)
    if (controller === undefined || controller.signal.aborted) {
      controller = new AbortController()
      controllers.set(send, controller)
    }
    const ctrl = controller
    chain({ effect, send, signal: ctrl.signal })
    return () => ctrl.abort() // targets the controller live at this dispatch
  }
}
