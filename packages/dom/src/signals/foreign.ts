// `foreign` — an imperative-subtree boundary. Declared reactive `state` inputs are
// materialized to LiveSignals (peek + bind) and handed to `mount`, which builds a
// third-party instance into the host element. The signals stay reactive; `unmount`
// runs on the owning component's dispose. The analyzer sees the declared deps; the
// imperative body is opaque.

import { requireCtx, mountable, type Mountable } from './build-context.js'
import type { LiveSignal } from './types.js'

/** A declared reactive input to `foreign`: an accessor + its dep paths. */
export interface SignalSpec<T> {
  produce: (state: unknown) => T
  deps: readonly string[]
}

/** Create a LiveSignal plus a `push` to feed it new values (fires subscribers on
 * change). `bind` fires immediately with the current value, then on every change;
 * returns an unsubscribe. */
function makeLive<T>(): { live: LiveSignal<T>; push: (v: T) => void; clear: () => void } {
  const subs = new Set<(v: T) => void>()
  let last: T
  let has = false
  const live: LiveSignal<T> = {
    peek: () => last,
    bind: (cb) => {
      subs.add(cb)
      if (has) cb(last) // immediate
      return () => subs.delete(cb)
    },
  }
  return {
    live,
    push: (v) => {
      if (has && Object.is(v, last)) return
      last = v
      has = true
      for (const cb of subs) cb(v)
    },
    clear: () => subs.clear(),
  }
}

export interface ForeignSpec<Inst, State extends Record<string, SignalSpec<unknown>>> {
  /** host element tag (default 'div') */
  tag?: string
  /** declared reactive inputs — materialized to LiveSignals for `mount` */
  state?: State
  /** build the imperative instance into the host element */
  mount: (args: {
    el: Element
    state: { [K in keyof State]: LiveSignal<State[K] extends SignalSpec<infer T> ? T : unknown> }
  }) => Inst
  /** tear down the instance (runs on the owning component's dispose) */
  unmount?: (instance: Inst) => void
}

/**
 * Imperative-subtree boundary. Declared `state` signals are materialized to
 * LiveSignals (peek + bind) and handed to `mount`, which builds a third-party
 * instance into the host element. The signals stay reactive: when a declared
 * input changes, its LiveSignal fires bound callbacks. `unmount` runs on the
 * owning component's dispose. Communicate OUT via `send` (closed over from the
 * view bag). The analyzer sees the declared deps; the imperative body is opaque.
 */
export function signalForeign<Inst, State extends Record<string, SignalSpec<unknown>>>(
  spec: ForeignSpec<Inst, State>,
): Mountable {
  return mountable(() => buildSignalForeign(spec))
}

function buildSignalForeign<Inst, State extends Record<string, SignalSpec<unknown>>>(
  spec: ForeignSpec<Inst, State>,
): Node {
  const c = requireCtx()
  const host = c.doc.createElement(spec.tag ?? 'div')

  const entries = Object.entries(spec.state ?? {}) as Array<[string, SignalSpec<unknown>]>
  const lives: Record<string, LiveSignal<unknown>> = {}
  const controllers: Array<{ clear: () => void }> = []

  for (const [key, sig] of entries) {
    const { live, push, clear } = makeLive<unknown>()
    lives[key] = live
    controllers.push({ clear })
    // per-input binding: push new value when this input's deps change
    c.specs.push({ deps: sig.deps, produce: (s) => sig.produce(s), commit: (v) => push(v) })
  }

  let instance: Inst | undefined
  // boot binding (no deps -> runs once at mount, never on update): builds the
  // instance after the inputs have their initial values.
  c.specs.push({
    deps: [],
    produce: () => 0,
    commit: () => {
      if (instance === undefined) {
        instance = spec.mount({
          el: host,
          state: lives as never,
        })
      }
    },
  })

  c.teardowns.push(() => {
    for (const ctrl of controllers) ctrl.clear()
    if (instance !== undefined) spec.unmount?.(instance)
  })

  return host
}
