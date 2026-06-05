// The plugin contract for the LLui ↔ Lexical binding.
//
// A plugin is a pure descriptor: it contributes Lexical node classes, an
// imperative `register` step (commands/listeners), keyboard shortcuts, and
// decorator bridges (LLui sub-views mounted inside Lexical DecoratorNodes).
// It is intentionally markdown-agnostic — `@llui/markdown-editor` extends this
// contract with markdown transformers and toolbar items.

import type { Klass, LexicalEditor, LexicalNode } from 'lexical'
import { mountApp, type SignalComponentDef } from '@llui/dom'

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

/**
 * Bridges a custom node type to an LLui sub-view. The sub-view's
 * `State`/`Msg`/`Effect` and `Data` types are fully erased here: a bridge is
 * stored monomorphically in the registry, and `mount` builds + mounts the
 * sub-app, returning a disposer. Authors construct bridges with the typed
 * {@link decoratorBridge} helper, which captures concrete types in a closure.
 */
export interface DecoratorBridge {
  /** The id used by the contributing markdown transformer. */
  type: string
  /** Mount the sub-view for a node's (deserialized) data; returns a disposer. */
  mount: (container: Element, data: unknown, api: DecoratorApi<unknown>) => () => void
}

/**
 * Author-facing constructor for a {@link DecoratorBridge}. Preserves the
 * sub-component's `State`/`Msg`/`Effect` and the node `Data` type at the
 * definition site; only the node's serialized payload is narrowed back to
 * `Data` at mount time (the single deserialization-boundary cast, exactly like
 * `JSON.parse` returning a declared type).
 */
export function decoratorBridge<
  Data,
  S,
  M extends { type: string },
  E extends { type: string } = never,
>(
  type: string,
  factory: (data: Data, api: DecoratorApi<Data>) => SignalComponentDef<S, M, E>,
): DecoratorBridge {
  return {
    type,
    mount: (container, data, api) => {
      const typedApi: DecoratorApi<Data> = {
        editor: api.editor,
        update: (next) => api.update(next),
      }
      const handle = mountApp(container, factory(data as Data, typedApi))
      return () => handle.dispose()
    },
  }
}

/** A composable unit of editor behaviour. */
export interface LexicalPlugin<Emit = unknown> {
  /** Stable identifier (also used for de-duplication and overrides). */
  name: string
  /** Lexical node classes registered on the editor config. */
  nodes?: ReadonlyArray<Klass<LexicalNode>>
  /** Imperative registration (commands, listeners). Returns a disposer. */
  register?: (editor: LexicalEditor, ctx: PluginContext<Emit>) => () => void
  /** Keyboard shortcuts wired through a single KEY_DOWN command. */
  shortcuts?: readonly ShortcutSpec[]
  /** Decorator bridges this plugin owns. */
  decorators?: readonly DecoratorBridge[]
}
