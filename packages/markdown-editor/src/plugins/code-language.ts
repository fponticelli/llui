// Code-block language plugin — makes a fenced block's **info string** visible
// and editable, and makes it round-trip verbatim.
//
// ## Why this package replaces `@lexical/markdown`'s CODE transformer
//
// Upstream's `CODE` captures the info string with `([\w-]+)?`, i.e. a SINGLE
// word-ish token, pushing the rest of the fence line into the code CONTENT:
//
//   ```lance table      →  language 'lance',  body 'table\nsum(x)'   (corrupt)
//   ```c++              →  language 'c',      body '++\nint main()'  (corrupt)
//
// That is silent data loss for any consumer that keys off the info string
// (downstream, ```lance / ```lance table marks a formula block). The CommonMark
// -correct replacement lives in `transformers/code.ts` and is the DEFAULT in
// `GFM_TRANSFORMERS`, so the corruption is fixed for every consumer whether or
// not they enable this plugin, and plugin ORDER cannot reintroduce it. This
// plugin therefore adds only the editing chrome.
//
// ## Why no highlighter
//
// The package deliberately depends on `@lexical/code-core`, not `@lexical/code`,
// to keep Prism out of the bundle (see `transformers/gfm.ts`). The language is
// therefore an OPAQUE label: it is stored, shown, edited, and re-emitted, but
// nothing interprets it. That is precisely what lets an arbitrary token like
// `lance table` survive. The optional `languages` option only seeds a
// `<datalist>` of suggestions — it never constrains what may be typed.
//
// ## Chrome
//
// The editor uses the shared overlay seam (`overlayRoot` + `definePluginUI`),
// exactly like the table tools: a small portaled badge anchored to the code
// block's top-right corner whenever the caret is inside one.

import { $getNodeByKey, $getSelection, $isRangeSelection, SKIP_DOM_SELECTION_TAG } from 'lexical'
import { $findMatchingParent, mergeRegister } from '@lexical/utils'
import { $isCodeNode, CodeHighlightNode, CodeNode } from '@lexical/code-core'
import { el, input, text, type Mountable } from '@llui/dom'
import { definePluginUI } from './ui.js'
import { OVERLAY_Z, hideOverlay, onViewportChange, overlayRoot } from './overlay.js'
import type { MarkdownPlugin } from './types.js'

/** This plugin's registry name (the `plugin` message envelope's `name`). */
export const CODE_LANGUAGE_PLUGIN = 'codeLanguage'

// The fenced-code transformer now lives in `transformers/code.ts` so that it is
// the DEFAULT in `GFM_TRANSFORMERS`, not an opt-in a consumer must remember to
// order ahead of `corePlugin()`. This plugin contributes the SAME object
// reference, so `buildTransformers`' reference de-duplication collapses the two
// contributions into one and plugin order cannot change the parse.
// Re-exported here because it is part of this plugin's documented surface.
import { CODE_INFO_TRANSFORMER, normalizeCodeInfo } from '../transformers/code.js'

export { CODE_INFO_TRANSFORMER, normalizeCodeInfo }

// ── Plugin UI state ─────────────────────────────────────────────────────────

/** The language badge's state. JSON-serializable, like every LLui state slice. */
export interface CodeLanguageState {
  /** Whether the badge is shown. */
  open: boolean
  /** Viewport x of the anchor (the code block's right edge). */
  x: number
  /** Viewport y of the anchor (the code block's top edge). */
  y: number
  /** Node key of the anchored code block (`''` when none). */
  key: string
  /** The input's current value (the block's info string, or the in-flight edit). */
  language: string
  /** The info string as last read from the node — the baseline `cancel` restores
   * and `commit` diffs against, so a no-op commit never touches the document. */
  committed: string
  /** Whether the input has focus; a refresh must not overwrite what's being typed. */
  editing: boolean
  /** A `hide` that arrived mid-edit, applied when the edit ends. */
  pendingHide: boolean
}

export type CodeLanguageMsg =
  | { type: 'show'; key: string; x: number; y: number; language: string | null }
  | { type: 'hide' }
  | { type: 'edit' }
  | { type: 'input'; language: string }
  | { type: 'commit' }
  | { type: 'cancel' }

/** Write `language` (null clears it) onto the code block with node key `key`. */
export type CodeLanguageEffect = { type: 'apply'; key: string; language: string | null }

const INITIAL: CodeLanguageState = {
  open: false,
  x: 0,
  y: 0,
  key: '',
  language: '',
  committed: '',
  editing: false,
  pendingHide: false,
}

function sameState(a: CodeLanguageState, b: CodeLanguageState): boolean {
  return (
    a.open === b.open &&
    a.x === b.x &&
    a.y === b.y &&
    a.key === b.key &&
    a.language === b.language &&
    a.committed === b.committed &&
    a.editing === b.editing &&
    a.pendingHide === b.pendingHide
  )
}

/** End an edit: drop the editing flag and honour a hide deferred during it. */
function endEdit(state: CodeLanguageState, language: string): CodeLanguageState {
  return {
    ...state,
    language,
    editing: false,
    pendingHide: false,
    open: state.pendingHide ? false : state.open,
  }
}

function reduce(
  state: CodeLanguageState,
  msg: CodeLanguageMsg,
): CodeLanguageState | [CodeLanguageState, CodeLanguageEffect[]] {
  switch (msg.type) {
    case 'show': {
      const language = normalizeCodeInfo(msg.language) ?? ''
      // A refresh for the block being edited only re-anchors it: the typed value
      // and the edit itself are preserved (the register listener re-emits `show`
      // on every editor update, including the one this plugin's own commit made).
      const keepEdit = state.editing && state.key === msg.key
      const next: CodeLanguageState = {
        open: true,
        x: msg.x,
        y: msg.y,
        key: msg.key,
        language: keepEdit ? state.language : language,
        committed: language,
        editing: keepEdit,
        // Preserved across a same-block `show` for the same reason `language`
        // and `editing` are. `onViewportChange(refresh)` re-emits `show` on
        // every scroll/resize, so an unconditional reset let a scroll while the
        // input was focused erase a deferred hide — `endEdit` then saw
        // `pendingHide === false` and left the badge anchored over a block the
        // caret had already left.
        pendingHide: keepEdit ? state.pendingHide : false,
      }
      return sameState(state, next) ? state : next
    }
    case 'hide':
      // Focusing the badge's input can collapse the editor selection, which makes
      // the register listener emit `hide`. Closing then would yank the input out
      // from under the caret, so remember it and apply it when the edit ends.
      if (state.editing) return state.pendingHide ? state : { ...state, pendingHide: true }
      return hideOverlay(state)
    case 'edit':
      return state.editing ? state : { ...state, editing: true }
    case 'input':
      return state.language === msg.language && state.editing
        ? state
        : { ...state, language: msg.language, editing: true }
    case 'commit': {
      const next = normalizeCodeInfo(state.language)
      const previous = normalizeCodeInfo(state.committed)
      const ended = endEdit({ ...state, committed: next ?? '' }, next ?? '')
      // An unchanged (or still-empty) value must NOT touch the document: doing so
      // would dirty the editor and re-emit onChange for a no-op.
      if (next === previous) return [endEdit(state, state.committed), []]
      return [ended, [{ type: 'apply', key: state.key, language: next }]]
    }
    case 'cancel':
      return endEdit(state, state.committed)
  }
}

// ── Plugin ──────────────────────────────────────────────────────────────────

export interface CodeLanguagePluginOptions {
  /** Suggestions offered in the language input's `<datalist>`. Purely advisory —
   * ANY info string may be typed, including multi-token ones. */
  languages?: readonly string[]
  /** Placeholder shown when a block has no language (default `'plain text'`). */
  placeholder?: string
  /** Accessible label for the language input (default `'Code block language'`). */
  label?: string
}

/** Unique per plugin instance so two mounted editors never share a datalist id. */
let datalistSeq = 0

export function codeLanguagePlugin(opts: CodeLanguagePluginOptions = {}): MarkdownPlugin {
  const languages = opts.languages ?? []
  const listId = languages.length > 0 ? `md-code-lang-${++datalistSeq}` : null
  // Per-instance id so the command item can focus THIS editor's badge input even
  // with several editors mounted at once (the overlay is portaled to <body>).
  const inputId = `md-code-lang-input-${++datalistSeq}`

  return {
    name: CODE_LANGUAGE_PLUGIN,

    // The keyboard route to the badge. The overlay is portaled to a body-level
    // sibling that exists only while the caret is in a code block, and Tab
    // inside a Lexical CodeNode is consumed for indentation — so without a
    // command the input was unreachable without a pointer, making the ONLY way
    // to set or clear a code block's language mouse-only.
    items: [
      {
        id: CODE_LANGUAGE_PLUGIN,
        label: 'Set code block language',
        icon: 'codeLanguage',
        group: 'block',
        keywords: ['code', 'language', 'fence', 'syntax', 'info string'],
        isDisabled: () => false,
        run: (editor) => {
          // Only meaningful with the caret inside a code block; the overlay is
          // open in exactly that case, so focusing its input is the whole action.
          const focus = (): void => {
            const el = editor.getRootElement()?.ownerDocument.getElementById(inputId)
            if (el instanceof HTMLInputElement) {
              el.focus()
              el.select()
            }
          }
          // The overlay may not be open yet if the caret only just moved; let the
          // register listener's refresh land first.
          if (typeof queueMicrotask === 'function') queueMicrotask(focus)
          else focus()
        },
        surfaces: ['slash', 'context'],
      },
    ],
    // Declared so the plugin stands alone (a code-only editor without
    // `corePlugin`); the mount de-duplicates node classes across plugins.
    nodes: [CodeNode, CodeHighlightNode],
    transformers: [CODE_INFO_TRANSFORMER],
    // Track the code block under the caret and its viewport rect. Mirrors
    // `tablePlugin`: re-emit only when the anchor or the language actually
    // changes, so typing inside a code block doesn't reconcile the overlay.
    register: (editor, ctx) => {
      let lastKey: string | null = null
      let lastX = NaN
      let lastY = NaN
      let lastLanguage: string | null = null
      const refresh = (): void => {
        const found = editor.getEditorState().read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return null
          const code = $findMatchingParent(selection.anchor.getNode(), $isCodeNode)
          if (!$isCodeNode(code)) return null
          return { key: code.getKey(), language: normalizeCodeInfo(code.getLanguage()) }
        })
        const element = found ? editor.getElementByKey(found.key) : null
        if (!found || !element) {
          if (lastKey !== null) {
            lastKey = null
            lastX = NaN
            lastY = NaN
            lastLanguage = null
            ctx.emit({
              type: 'plugin',
              name: CODE_LANGUAGE_PLUGIN,
              msg: { type: 'hide' },
            })
          }
          return
        }
        const rect = element.getBoundingClientRect()
        if (
          found.key === lastKey &&
          rect.right === lastX &&
          rect.top === lastY &&
          found.language === lastLanguage
        ) {
          return
        }
        lastKey = found.key
        lastX = rect.right
        lastY = rect.top
        lastLanguage = found.language
        ctx.emit({
          type: 'plugin',
          name: CODE_LANGUAGE_PLUGIN,
          msg: {
            type: 'show',
            key: found.key,
            x: rect.right,
            y: rect.top,
            language: found.language,
          },
        })
      }
      return mergeRegister(
        editor.registerUpdateListener(() => refresh()),
        onViewportChange(refresh),
      )
    },
    ui: definePluginUI<CodeLanguageState, CodeLanguageMsg, CodeLanguageEffect>({
      init: () => INITIAL,
      update: reduce,
      onEffect: (effect, ctx) => {
        const editor = ctx.editor()
        if (!editor) return
        // SKIP_DOM_SELECTION_TAG is load-bearing, not decoration. `setLanguage`
        // dirties the CodeNode, so an untagged update reaches
        // `$updateDOMSelection`. Lexical does not clear its selection on blur
        // ('blur' is a PASS_THROUGH_COMMAND), so while the badge input holds DOM
        // focus the pending selection still points INSIDE the code block; the
        // equality short-circuit therefore fails and the reconciler moves the
        // native selection back into the contenteditable — stealing focus out of
        // the input mid-edit. This package already defends against the same
        // hazard in editor.ts (the explicit `$setSelection(null)`).
        editor.update(
          () => {
            const node = $getNodeByKey(effect.key)
            if ($isCodeNode(node)) node.setLanguage(effect.language)
          },
          { tag: SKIP_DOM_SELECTION_TAG },
        )
      },
      view: ({ state, send }) =>
        overlayRoot({
          open: state.at('open'),
          x: state.at('x'),
          y: state.at('y'),
          zIndex: OVERLAY_Z.codeLanguage,
          // Sit just above the block's top-right corner.
          transform: 'transform:translate(-100%,-100%)',
          attrs: { 'data-scope': 'md-code-language', 'data-part': 'bar' },
          children: (): Mountable[] => {
            const children: Mountable[] = [
              input({
                type: 'text',
                'data-scope': 'md-code-language',
                'data-part': 'input',
                id: inputId,
                'aria-label': opts.label ?? 'Code block language',
                placeholder: opts.placeholder ?? 'plain text',
                spellcheck: 'false',
                autocapitalize: 'off',
                autocomplete: 'off',
                ...(listId ? { list: listId } : {}),
                value: state.at('language'),
                onFocus: () => send({ type: 'edit' }),
                onBlur: () => send({ type: 'commit' }),
                onInput: (e: Event) =>
                  send({ type: 'input', language: (e.target as HTMLInputElement).value }),
                // The badge lives in a portal outside the contenteditable, but
                // document-level editor handlers would still see these keys.
                onKeyDown: (e: KeyboardEvent) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    send({ type: 'commit' })
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    send({ type: 'cancel' })
                  }
                },
              }),
            ]
            if (listId) {
              children.push(
                el(
                  'datalist',
                  { id: listId },
                  languages.map((language) => el('option', { value: language }, [text(language)])),
                ),
              )
            }
            return children
          },
        }),
    }),
  }
}
