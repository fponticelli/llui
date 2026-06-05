// Plugin UI/state extensions — the seam that makes stateful, UI-bearing features
// (link editor, slash menu, @mentions, …) into plugins instead of core built-ins.
//
// A plugin may contribute a small TEA module: a namespaced state slice (stored
// under `state.plugins[name]`), a reducer, a view (overlays/panels rendered by
// the host), and effects (handled with live-editor access). Types are erased at
// the registry boundary via {@link definePluginUI}, which keeps each plugin's
// `State`/`Msg`/`Effect` fully typed at the definition site.

import type { LexicalEditor } from 'lexical'
import type { Renderable, Signal } from '@llui/dom'

/** Context for a plugin's `onEffect` — reach the live editor and dispatch back. */
export interface PluginEffectContext<M> {
  /** The live Lexical editor (null before mount). */
  editor: () => LexicalEditor | null
  /** Dispatch a message back into this plugin. */
  send: (msg: M) => void
}

/** Args for a plugin's `view` — its reactive state slice + a scoped dispatcher. */
export interface PluginViewArgs<S, M> {
  state: Signal<S>
  send: (msg: M) => void
  editor: () => LexicalEditor | null
}

/** A typed plugin UI module (authored via {@link definePluginUI}). */
export interface PluginUISpec<S, M, E = never> {
  /** Initial slice state (JSON-serializable). */
  init: () => S
  /** Pure reducer over the slice; may return effects. */
  update?: (state: S, msg: M) => S | [S, E[]]
  /** View contribution (overlays/panels), rendered by the host. */
  view?: (args: PluginViewArgs<S, M>) => Renderable
  /** Effect handler with live-editor access. */
  onEffect?: (effect: E, ctx: PluginEffectContext<M>) => void
}

/** The type-erased form stored on a plugin and consumed by the host. */
export interface PluginUI {
  init: () => unknown
  update?: (state: unknown, msg: unknown) => unknown | [unknown, unknown[]]
  view?: (args: PluginViewArgs<unknown, unknown>) => Renderable
  onEffect?: (effect: unknown, ctx: PluginEffectContext<unknown>) => void
}

/**
 * Author a plugin UI module with full `State`/`Msg`/`Effect` types, erased for
 * storage. The casts are confined to this boundary (the host only knows
 * `unknown`), exactly like the decorator bridge.
 */
export function definePluginUI<S, M, E = never>(spec: PluginUISpec<S, M, E>): PluginUI {
  return {
    init: spec.init,
    update: spec.update ? (state, msg) => spec.update!(state as S, msg as M) : undefined,
    view: spec.view
      ? (args) =>
          spec.view!({
            state: args.state as Signal<S>,
            send: args.send as (msg: M) => void,
            editor: args.editor,
          })
      : undefined,
    onEffect: spec.onEffect
      ? (effect, ctx) =>
          spec.onEffect!(effect as E, {
            editor: ctx.editor,
            send: ctx.send as (msg: M) => void,
          })
      : undefined,
  }
}
