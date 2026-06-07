// The editor's TEA state, messages, effects, and pure reducer. Lexical owns the
// live document; this state holds JSON-serializable mirrors/derivations only, so
// `update` stays pure and DOM-free (fully unit-testable).

import type { Alignment } from '@llui/lexical'

/** The block kind at the selection — base rich-text kinds plus list/code,
 * resolved by the markdown layer. */
export type BlockType =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'quote'
  | 'code'
  | 'bullet'
  | 'number'
  | 'check'
  | 'other'

/** The toolbar-facing format surface at the current selection (all primitives). */
export interface FormatState {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  code: boolean
  link: boolean
  blockType: BlockType
  alignment: Alignment
  canUndo: boolean
  canRedo: boolean
}

export const EMPTY_FORMAT: FormatState = {
  bold: false,
  italic: false,
  strikethrough: false,
  code: false,
  link: false,
  blockType: 'paragraph',
  alignment: null,
  canUndo: false,
  canRedo: false,
}

/** Which floating surface is currently open. */
export type OverlayKind = 'none' | 'floating' | 'slash' | 'context' | 'link'

/** Live collaborative-session status (mirror of the CRDT provider state).
 * `enabled` is false unless the editor was created with a `collab` factory. */
export interface CollabStatus {
  enabled: boolean
  connected: boolean
  synced: boolean
  /** Remote peers currently present (excludes this client). */
  peers: number
}

export const COLLAB_OFF: CollabStatus = {
  enabled: false,
  connected: false,
  synced: false,
  peers: 0,
}

export interface EditorState {
  /** Last serialized markdown (mirror of the live document). */
  value: string
  format: FormatState
  wordCount: number
  charCount: number
  ui: {
    activeOverlay: OverlayKind
    slashQuery: string
    menu: { x: number; y: number }
  }
  /** Per-plugin UI state slices, keyed by plugin name (see {@link PluginUI}). */
  plugins: Record<string, unknown>
  dirty: boolean
  readonly: boolean
  /** Collaborative-session status (always present; inert unless `collab` set). */
  collab: CollabStatus
}

export type EditorMsg =
  | { type: 'markdownChanged'; value: string }
  | { type: 'formatChanged'; format: FormatState; wordCount: number; charCount: number }
  | { type: 'runCommand'; id: string }
  | { type: 'setValue'; value: string }
  | { type: 'openOverlay'; overlay: OverlayKind; x?: number; y?: number }
  | { type: 'closeOverlay' }
  | { type: 'slashQuery'; query: string }
  | { type: 'setReadOnly'; readonly: boolean }
  | { type: 'collabStatus'; connected: boolean }
  | { type: 'collabSync'; synced: boolean }
  | { type: 'collabPeers'; peers: number }
  /** Route a message to a plugin's UI reducer (see {@link PluginUI}). */
  | { type: 'plugin'; name: string; msg: unknown }

/** The subset of messages a plugin may emit through its `PluginContext` (e.g. a
 * `register` listener routing an editor event into its own plugin UI). */
export type EditorOutMsg = Extract<
  EditorMsg,
  { type: 'openOverlay' | 'closeOverlay' | 'slashQuery' | 'plugin' }
>

export type EditorEffect =
  | { type: 'execCommand'; id: string }
  | { type: 'applyValue'; value: string }
  | { type: 'emitChange'; value: string }
  | { type: 'emitFormat'; format: FormatState }
  /** An effect produced by a plugin's UI reducer (see {@link PluginUI}). */
  | { type: 'pluginEffect'; name: string; effect: unknown }

export interface InitOptions {
  value: string
  readonly: boolean
  /** Whether a collaborative session is wired (drives `collab.enabled`). */
  collab?: boolean
}

export function init(opts: InitOptions): [EditorState, EditorEffect[]] {
  const wordCount = countWords(opts.value)
  return [
    {
      value: opts.value,
      format: EMPTY_FORMAT,
      wordCount,
      charCount: opts.value.length,
      ui: { activeOverlay: 'none', slashQuery: '', menu: { x: 0, y: 0 } },
      plugins: {},
      dirty: false,
      readonly: opts.readonly,
      collab: { ...COLLAB_OFF, enabled: opts.collab ?? false },
    },
    [],
  ]
}

export function update(state: EditorState, msg: EditorMsg): [EditorState, EditorEffect[]] {
  switch (msg.type) {
    case 'markdownChanged': {
      // Idempotent: re-emitting the current value is a no-op (echo safety).
      if (msg.value === state.value) return [state, []]
      return [
        { ...state, value: msg.value, dirty: true },
        [{ type: 'emitChange', value: msg.value }],
      ]
    }
    case 'formatChanged': {
      return [
        { ...state, format: msg.format, wordCount: msg.wordCount, charCount: msg.charCount },
        [{ type: 'emitFormat', format: msg.format }],
      ]
    }
    case 'runCommand': {
      return [state, [{ type: 'execCommand', id: msg.id }]]
    }
    case 'setValue': {
      // External markdown push (via the component handle). Idempotent; does not
      // re-emit onChange (the consumer already owns this value).
      if (msg.value === state.value) return [state, []]
      return [
        { ...state, value: msg.value, dirty: true },
        [{ type: 'applyValue', value: msg.value }],
      ]
    }
    case 'openOverlay': {
      return [
        {
          ...state,
          ui: {
            ...state.ui,
            activeOverlay: msg.overlay,
            slashQuery: msg.overlay === 'slash' ? '' : state.ui.slashQuery,
            menu: { x: msg.x ?? state.ui.menu.x, y: msg.y ?? state.ui.menu.y },
          },
        },
        [],
      ]
    }
    case 'closeOverlay': {
      if (state.ui.activeOverlay === 'none') return [state, []]
      return [{ ...state, ui: { ...state.ui, activeOverlay: 'none', slashQuery: '' } }, []]
    }
    case 'slashQuery': {
      return [{ ...state, ui: { ...state.ui, slashQuery: msg.query } }, []]
    }
    case 'setReadOnly': {
      if (state.readonly === msg.readonly) return [state, []]
      return [{ ...state, readonly: msg.readonly }, []]
    }
    case 'collabStatus': {
      if (state.collab.connected === msg.connected) return [state, []]
      return [{ ...state, collab: { ...state.collab, connected: msg.connected } }, []]
    }
    case 'collabSync': {
      if (state.collab.synced === msg.synced) return [state, []]
      return [{ ...state, collab: { ...state.collab, synced: msg.synced } }, []]
    }
    case 'collabPeers': {
      if (state.collab.peers === msg.peers) return [state, []]
      return [{ ...state, collab: { ...state.collab, peers: msg.peers } }, []]
    }
    case 'plugin': {
      // Plugin messages are routed by the host's composed reducer (it holds the
      // plugin registry); the pure core reducer treats them as a no-op.
      return [state, []]
    }
  }
}

/** Count whitespace-delimited words (shared by init and the format handler). */
export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}
