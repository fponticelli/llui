// The plugin contract for the LLui ↔ Lexical binding.
//
// A plugin is a pure descriptor: it contributes Lexical node classes, an
// imperative `register` step (commands/listeners), keyboard shortcuts, and
// decorator bridges (LLui sub-views mounted inside Lexical DecoratorNodes).
// It is intentionally markdown-agnostic — `@llui/markdown-editor` extends this
// contract with markdown transformers and toolbar items.

import type { LexicalEditor, LexicalNodeConfig } from 'lexical'
import { component, mountApp, type Renderable, type Signal } from '@llui/dom'

/** A keyboard shortcut bound to an editor action.
 *
 * `combo` is a normalized chord: `Mod` resolves to ⌘ on macOS and Ctrl
 * elsewhere, e.g. `Mod-b`, `Mod-Shift-7`, `Mod-Alt-1`. `run` returns `true`
 * when it handled the event (which stops propagation / prevents default). */
export interface ShortcutSpec {
  combo: string
  run: (editor: LexicalEditor) => boolean
}

/** Context handed to `plugin.register` so a plugin can talk back to the host
 * (e.g. open a slash menu) without owning the host's `send`. `Emit` is the
 * host message type; `@llui/lexical` leaves it `unknown`, hosts narrow it. */
export interface PluginContext<Emit = unknown> {
  /** Emit a host message into the embedding component's update loop. */
  emit: (msg: Emit) => void
}

/** Imperative handle a decorator sub-view uses to talk to its Lexical node. */
export interface DecoratorApi<Data> {
  /** Persist new node data (writes into the Lexical node → markdown-serializable). */
  update: (next: Data) => void
  /** The owning Lexical editor (for dispatching commands, reading state). */
  editor: LexicalEditor
}

/** A live decorator sub-view instance: dispose it, or push fresh data into it
 * WITHOUT remounting (the reactive update channel — see {@link decoratorBridge}). */
export interface DecoratorMount {
  /** Tear the sub-app down (call on the node's `'destroyed'` mutation). */
  dispose: () => void
  /** Push new node data into the ALREADY-MOUNTED sub-app. Reactive: it feeds the
   * data signal the view was built against, so only the affected bindings update —
   * focus, selection, and local DOM (an editable island) all survive. */
  update: (data: unknown) => void
}

/**
 * Bridges a custom node type to an LLui sub-view. The sub-view's `Data` type is
 * erased here: a bridge is stored monomorphically in the registry, and `mount`
 * builds + mounts the sub-app ONCE, returning a {@link DecoratorMount} whose
 * `update` channel reactively pushes later data changes in place. Authors
 * construct bridges with the typed {@link decoratorBridge} helper.
 */
export interface DecoratorBridge {
  /** The id used by the contributing markdown transformer. */
  type: string
  /** Mount the sub-view for a node's (deserialized) data ONCE; returns a live
   * {@link DecoratorMount} (dispose + reactive data-push). */
  mount: (container: Element, data: unknown, api: DecoratorApi<unknown>) => DecoratorMount
}

/**
 * Author-facing constructor for a {@link DecoratorBridge}. The `view` builder
 * receives a REACTIVE `Signal<Data>` (not a snapshot) plus the node api, and
 * returns the sub-view's DOM. The bridge wraps it in a tiny host component whose
 * single state field IS the data, so a later `mount.update(next)` simply drives
 * that signal — the sub-view re-renders in place, never remounting (the fix for
 * focus/selection loss on every data commit). `Data` is narrowed from the node's
 * serialized payload at mount (the single deserialization-boundary cast, exactly
 * like `JSON.parse` returning a declared type).
 */
export function decoratorBridge<Data>(
  type: string,
  view: (data: Signal<Data>, api: DecoratorApi<Data>) => Renderable,
): DecoratorBridge {
  type HostState = { data: Data }
  type HostMsg = { type: '__setData'; data: Data }
  return {
    type,
    mount: (container, data, api) => {
      const typedApi: DecoratorApi<Data> = {
        editor: api.editor,
        update: (next) => api.update(next),
      }
      const handle = mountApp(
        container,
        component<HostState, HostMsg, never>({
          name: `Decorator(${type})`,
          init: () => ({ data: data as Data }),
          update: (state, msg) => (msg.type === '__setData' ? { data: msg.data } : state),
          view: ({ state }) => view(state.at('data') as Signal<Data>, typedApi),
        }),
      )
      return {
        dispose: () => handle.dispose(),
        update: (next) => handle.send({ type: '__setData', data: next as Data }),
      }
    },
  }
}

/** A composable unit of editor behaviour. */
export interface LexicalPlugin<Emit = unknown> {
  /** Stable identifier (also used for de-duplication and overrides). */
  name: string
  /**
   * Lexical node classes registered on the editor config.
   *
   * `LexicalNodeConfig` — not `Klass<LexicalNode>` — so a plugin can register
   * the `{ replace, with, withKlass }` replacement form. Subclassing a built-in
   * node (e.g. to reserve a DOM slot boundary via `getDOMSlot`) is only
   * expressible that way, and the runtime already passes these straight to
   * `createEditor`.
   */
  nodes?: ReadonlyArray<LexicalNodeConfig>
  /** Imperative registration (commands, listeners). Returns a disposer. */
  register?: (editor: LexicalEditor, ctx: PluginContext<Emit>) => () => void
  /** Keyboard shortcuts wired through a single KEY_DOWN command. */
  shortcuts?: readonly ShortcutSpec[]
  /** Decorator bridges this plugin owns. */
  decorators?: readonly DecoratorBridge[]
}
