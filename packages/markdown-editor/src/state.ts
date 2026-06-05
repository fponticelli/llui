// The editor's TEA state, messages, effects, and pure reducer. Lexical owns the
// live document; this state holds JSON-serializable mirrors/derivations only, so
// `update` stays pure and DOM-free (fully unit-testable).

import type { Alignment } from '@llui/lexical'
import type { DialogMsg } from '@llui/components/dialog'

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
    /** Link dialog open state (drives the @llui/components dialog). */
    linkDialog: { open: boolean }
    /** Current value of the link dialog's URL input. */
    linkUrl: string
  }
  dirty: boolean
  readOnly: boolean
}

export type EditorMsg =
  | { type: 'markdownChanged'; value: string }
  | { type: 'formatChanged'; format: FormatState; wordCount: number; charCount: number }
  | { type: 'runCommand'; id: string }
  | { type: 'setValue'; value: string }
  | { type: 'openOverlay'; overlay: OverlayKind; x?: number; y?: number }
  | { type: 'closeOverlay' }
  | { type: 'slashQuery'; query: string }
  | { type: 'setReadOnly'; readOnly: boolean }
  // Link dialog flow
  | { type: 'openLink' }
  | { type: 'showLink'; url: string }
  | { type: 'setLinkUrl'; url: string }
  | { type: 'submitLink' }
  | { type: 'linkDialog'; msg: DialogMsg }

/** The subset of messages a plugin may emit through its `PluginContext`. */
export type EditorOutMsg = Extract<
  EditorMsg,
  { type: 'openOverlay' | 'closeOverlay' | 'slashQuery' }
>

export type EditorEffect =
  | { type: 'execCommand'; id: string }
  | { type: 'applyValue'; value: string }
  | { type: 'emitChange'; value: string }
  | { type: 'emitFormat'; format: FormatState }
  /** Save the selection + read the current link URL, then open the dialog. */
  | { type: 'beginLink' }
  /** Restore the saved selection and toggle the link to `url` (empty removes). */
  | { type: 'commitLink'; url: string }

export interface InitOptions {
  value: string
  readOnly: boolean
}

export function init(opts: InitOptions): [EditorState, EditorEffect[]] {
  const wordCount = countWords(opts.value)
  return [
    {
      value: opts.value,
      format: EMPTY_FORMAT,
      wordCount,
      charCount: opts.value.length,
      ui: {
        activeOverlay: 'none',
        slashQuery: '',
        menu: { x: 0, y: 0 },
        linkDialog: { open: false },
        linkUrl: '',
      },
      dirty: false,
      readOnly: opts.readOnly,
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
      if (state.readOnly === msg.readOnly) return [state, []]
      return [{ ...state, readOnly: msg.readOnly }, []]
    }
    case 'openLink': {
      // Defer to an effect: it reads the live editor (selection + current URL).
      return [state, [{ type: 'beginLink' }]]
    }
    case 'showLink': {
      return [{ ...state, ui: { ...state.ui, linkUrl: msg.url, linkDialog: { open: true } } }, []]
    }
    case 'setLinkUrl': {
      return [{ ...state, ui: { ...state.ui, linkUrl: msg.url } }, []]
    }
    case 'submitLink': {
      return [
        { ...state, ui: { ...state.ui, linkDialog: { open: false } } },
        [{ type: 'commitLink', url: state.ui.linkUrl }],
      ]
    }
    case 'linkDialog': {
      const m = msg.msg
      const open =
        m.type === 'open'
          ? true
          : m.type === 'close'
            ? false
            : m.type === 'toggle'
              ? !state.ui.linkDialog.open
              : m.type === 'setOpen'
                ? m.open
                : state.ui.linkDialog.open
      if (open === state.ui.linkDialog.open) return [state, []]
      return [{ ...state, ui: { ...state.ui, linkDialog: { open } } }, []]
    }
  }
}

/** Count whitespace-delimited words (shared by init and the format handler). */
export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}
