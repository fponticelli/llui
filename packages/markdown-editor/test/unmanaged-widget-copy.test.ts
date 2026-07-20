// GATING TEST for the "formula results as unmanaged DOM" design.
//
// The design renders a computed result as a widget element injected into a
// TextNode's own keyed DOM element and marked with Lexical's `setDOMUnmanaged`
// (lexical/src/LexicalUtils.ts:3046). The document is never mutated, so the
// Markdown export stays structurally clean — but the widget DOM lives INSIDE
// the contenteditable, so the open question is whether a native copy captures
// it.
//
// The expectation under test: Lexical intercepts `copy` and serializes from the
// EditorState (rich-text's COPY_COMMAND handler -> @lexical/clipboard
// `copyToClipboard` -> `$getClipboardDataFromSelection`), never from the live
// DOM, so the widget text must not reach the clipboard.
//
// ---------------------------------------------------------------------------
// JSDOM FIDELITY — read before trusting a green run.
//
// jsdom implements NEITHER `ClipboardEvent` NOR `DataTransfer` NOR
// `document.execCommand` (probed against this repo's jsdom: all three are
// `undefined`). So the browser's own clipboard write cannot be exercised here.
//
// What this test therefore fakes: ONLY the two inert data-carrier classes. It
// installs a minimal `DataTransfer` (a MIME->string map) and a `ClipboardEvent`
// (an `Event` subclass carrying `clipboardData`). The class NAME matters and is
// preserved, because Lexical gates on `objectKlassEquals`, which compares
// `Object.getPrototypeOf(object).constructor.name` (@lexical/utils
// src/index.ts:835) rather than identity.
//
// What is REAL and actually exercised, end to end:
//   - the `copy` listener Lexical registers on the root element
//     (lexical/src/LexicalEvents.ts:180, `['copy', PASS_THROUGH_COMMAND]`),
//   - the COPY_COMMAND dispatch,
//   - rich-text's handler calling `copyToClipboard`
//     (@lexical/rich-text src/index.ts:1793),
//   - `$copyToClipboardEvent`'s real DOM-selection guards
//     (`getDOMSelection` / `isSelectionWithinEditor`), against a real jsdom
//     Selection that genuinely spans the widget,
//   - the real serializers: `$getHtmlContent` (@lexical/html) and the
//     text/plain path off `$getSelection()`.
//
// So the test proves the load-bearing claim — the clipboard payload is derived
// from the EditorState and not from the live DOM subtree — while NOT proving
// anything about how a real browser's native clipboard behaves if Lexical's
// handler were bypassed (e.g. a `preventDefault` that some other handler
// cancels first). That residual risk needs a real-browser check.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { waitFor } from './wait-for'
import { mountApp } from '@llui/dom'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  $isTextNode,
  $isElementNode,
  isDOMUnmanaged,
  setDOMUnmanaged,
  type LexicalEditor,
  type TextNode,
} from 'lexical'
import { markdownEditor } from '../src/editor.js'

const WIDGET_TEXT = 'WIDGET-RESULT-42'
const DOC_TEXT = 'alpha bravo'

/** The single TextNode of the seeded paragraph. Must be called inside a
 * `read`/`update` (it uses the active editor state). */
function $onlyTextNode(): TextNode {
  const paragraph = $getRoot().getFirstChild()
  if (!$isElementNode(paragraph)) throw new Error('expected an ElementNode at the root')
  const child = paragraph.getFirstChild()
  if (!$isTextNode(child)) throw new Error('expected a TextNode in the seeded paragraph')
  return child
}

/** Minimal stand-in for the DOM `DataTransfer` jsdom does not implement. Only
 * `setData`/`getData` are touched by Lexical's clipboard writer
 * (`setLexicalClipboardDataTransfer`). The class name is load-bearing for
 * `objectKlassEquals`. */
class DataTransferStub {
  private readonly data = new Map<string, string>()
  setData(type: string, value: string): void {
    this.data.set(type, value)
  }
  getData(type: string): string {
    return this.data.get(type) ?? ''
  }
  get types(): readonly string[] {
    return [...this.data.keys()]
  }
}

/** Minimal stand-in for the DOM `ClipboardEvent` jsdom does not implement. It
 * is a real `Event` (so `dispatchEvent` and `preventDefault` behave), and its
 * constructor is NAMED `ClipboardEvent` so `objectKlassEquals(event,
 * ClipboardEvent)` — a constructor-NAME comparison — passes. */
const ClipboardEventStub = class ClipboardEvent extends Event {
  readonly clipboardData: DataTransferStub
  constructor(type: string, init: { clipboardData: DataTransferStub; bubbles?: boolean }) {
    super(type, { bubbles: init.bubbles ?? true, cancelable: true })
    this.clipboardData = init.clipboardData
  }
}

type ClipboardGlobals = {
  ClipboardEvent?: unknown
  DataTransfer?: unknown
}

let container: HTMLElement
let app: ReturnType<typeof mountApp> | null = null
let priorGlobals: ClipboardGlobals = {}

beforeEach(() => {
  const g = globalThis as ClipboardGlobals
  priorGlobals = { ClipboardEvent: g.ClipboardEvent, DataTransfer: g.DataTransfer }
  g.ClipboardEvent = ClipboardEventStub
  g.DataTransfer = DataTransferStub
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
  const g = globalThis as ClipboardGlobals
  g.ClipboardEvent = priorGlobals.ClipboardEvent
  g.DataTransfer = priorGlobals.DataTransfer
})

/** Mount an editor holding a single paragraph of `DOC_TEXT` and hand back the
 * editor plus the key of its one TextNode. */
function mountWithParagraph(onChange?: (md: string) => void): {
  editor: LexicalEditor
  textKey: string
} {
  let editor!: LexicalEditor
  app = mountApp(
    container,
    markdownEditor({
      defaultValue: DOC_TEXT,
      changeDebounceMs: 5,
      onReady: (e) => {
        editor = e
      },
      onChange,
    }),
  )
  const textKey = editor.getEditorState().read(() => $onlyTextNode().getKey())
  return { editor, textKey }
}

/** Append the unmanaged widget into the TextNode's keyed element. Append-only
 * is the contract the TextNode reconciler documents
 * (lexical/src/nodes/LexicalTextNode.ts:240): the default DOMSlot reads
 * `getFirstChild()` for the text node and inserts before `slot.before`, so a
 * trailing sibling is safe; prepending or wrapping is NOT. */
function injectWidget(editor: LexicalEditor, textKey: string): HTMLElement {
  const host = editor.getElementByKey(textKey)
  if (host === null) throw new Error('no keyed element for the TextNode')
  const widget = document.createElement('span')
  widget.textContent = WIDGET_TEXT
  widget.setAttribute('contenteditable', 'false')
  widget.setAttribute('data-widget', 'formula-result')
  setDOMUnmanaged(widget, { captureSelection: true })
  host.appendChild(widget)
  return widget
}

/** Put BOTH the real jsdom selection and the Lexical selection across the
 * paragraph, so the widget genuinely sits inside the copied DOM range. */
function selectAcross(editor: LexicalEditor, textKey: string): void {
  const host = editor.getElementByKey(textKey)
  if (host === null) throw new Error('no keyed element for the TextNode')
  // Lexical selection FIRST: committing it syncs the native selection, which
  // would otherwise clobber the wider DOM range we install below.
  editor.update(
    () => {
      const child = $onlyTextNode()
      child.select(0, child.getTextContentSize())
    },
    { discrete: true },
  )

  const domSelection = window.getSelection()
  if (domSelection === null) throw new Error('no window selection')
  const range = document.createRange()
  // Span the WHOLE host element — its text node AND the appended widget — so
  // the native range genuinely covers the widget at the moment of the copy.
  range.setStart(host, 0)
  range.setEnd(host, host.childNodes.length)
  domSelection.removeAllRanges()
  domSelection.addRange(range)
}

/** Drive Lexical's real copy path by dispatching a `copy` event on the root
 * element, exactly as a browser would. Returns the payload Lexical wrote. */
async function copyViaLexical(editor: LexicalEditor): Promise<DataTransferStub> {
  const root = editor.getRootElement()
  if (root === null) throw new Error('editor has no root element')
  const clipboardData = new DataTransferStub()
  const event = new ClipboardEventStub('copy', { clipboardData })
  root.dispatchEvent(event)
  // `copyToClipboard` resolves through `editor.update(...)` + a promise, so the
  // write lands on a microtask, not synchronously.
  await waitFor(() => clipboardData.types.length > 0)
  return clipboardData
}

describe('unmanaged widget DOM inside the contenteditable', () => {
  it('is NOT captured by Lexical copy (text/plain and text/html come from the EditorState)', async () => {
    const { editor, textKey } = mountWithParagraph()
    const widget = injectWidget(editor, textKey)

    // Sanity: the widget really is inside the contenteditable and inside the
    // range we are about to copy — otherwise this test would prove nothing.
    const root = editor.getRootElement()
    expect(root?.contains(widget)).toBe(true)
    expect(root?.textContent).toContain(WIDGET_TEXT)

    selectAcross(editor, textKey)
    const domRange = window.getSelection()?.getRangeAt(0)
    expect(domRange?.cloneContents().textContent).toContain(WIDGET_TEXT)

    const clipboardData = await copyViaLexical(editor)

    const plain = clipboardData.getData('text/plain')
    const html = clipboardData.getData('text/html')

    expect(plain).toBe(DOC_TEXT)
    expect(plain).not.toContain(WIDGET_TEXT)
    expect(html).toContain(DOC_TEXT)
    expect(html).not.toContain(WIDGET_TEXT)
    expect(html).not.toContain('data-widget')

    // The Lexical-native payload must be clean too — that is what an in-editor
    // paste round-trips through.
    expect(clipboardData.getData('application/x-lexical-editor')).not.toContain(WIDGET_TEXT)
  })

  it('survives a text-content reconcile of its host TextNode', async () => {
    const { editor, textKey } = mountWithParagraph()
    const widget = injectWidget(editor, textKey)

    editor.update(
      () => {
        $onlyTextNode().setTextContent('alpha bravo charlie')
      },
      { discrete: true },
    )
    // Let the MutationObserver cleanup pass run — that is what would evict
    // "unknown DOM children" if `setDOMUnmanaged` were not honoured
    // (lexical/src/LexicalMutations.ts:221).
    await new Promise((r) => setTimeout(r, 0))

    const host = editor.getElementByKey(textKey)
    expect(host?.contains(widget)).toBe(true)
    expect(isDOMUnmanaged(widget)).toBe(true)
    expect(editor.getRootElement()?.textContent).toContain(WIDGET_TEXT)
    expect(editor.getRootElement()?.textContent).toContain('alpha bravo charlie')
  })

  // CONFIRMED EVICTION CASE. The prior spike's flag is real: toggling a text
  // format changes the TextNode's OUTER TAG (measured: SPAN -> STRONG), so the
  // reconciler builds a NEW element and discards the old one — taking the
  // appended widget with it. `setDOMUnmanaged` does not help here; it only stops
  // the MutationObserver from evicting foreign children of a SURVIVING element.
  //
  // Consequence for the design: the widget must be re-attached whenever the host
  // element identity changes. The `updated` mutation from
  // `registerMutationListener` is the hook, and the re-attach must be
  // idempotent — compare `editor.getElementByKey(key)` against the element the
  // widget is currently parented to rather than assuming it is gone.
  it('is EVICTED when an outer-tag change (format toggle) swaps the host element', async () => {
    const { editor, textKey } = mountWithParagraph()
    const widget = injectWidget(editor, textKey)
    const hostBefore = editor.getElementByKey(textKey)

    editor.update(
      () => {
        $onlyTextNode().toggleFormat('bold')
      },
      { discrete: true },
    )
    await new Promise((r) => setTimeout(r, 0))

    const hostAfter = editor.getElementByKey(textKey)

    // Pin the exact mechanism, so a Lexical upgrade that changes it fails loudly
    // HERE rather than silently in the feature.
    expect(hostBefore?.tagName).toBe('SPAN')
    expect(hostAfter?.tagName).toBe('STRONG')
    expect(hostAfter).not.toBe(hostBefore)
    expect(editor.getRootElement()?.contains(widget)).toBe(false)
    expect(editor.getRootElement()?.textContent).not.toContain(WIDGET_TEXT)

    // Re-attaching to the NEW host restores the widget — the recovery the
    // design must perform on the `updated` mutation.
    hostAfter?.appendChild(widget)
    expect(editor.getRootElement()?.contains(widget)).toBe(true)

    // The document text is unaffected throughout.
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(DOC_TEXT)
  })

  it('leaves the Markdown export unaffected', async () => {
    const changes: string[] = []
    const { editor, textKey } = mountWithParagraph((md) => changes.push(md))
    injectWidget(editor, textKey)

    editor.update(
      () => {
        $onlyTextNode().setTextContent('alpha bravo charlie')
      },
      { discrete: true },
    )

    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)).toBe('alpha bravo charlie')
    expect(changes.at(-1)).not.toContain(WIDGET_TEXT)
  })

  it('keeps the Lexical selection intact when the caret resolves inside the widget', () => {
    // `captureSelection: true` is what stops selection resolution from
    // force-syncing the caret out of the widget
    // (lexical/src/LexicalSelection.ts:3014).
    const { editor, textKey } = mountWithParagraph()
    const widget = injectWidget(editor, textKey)
    expect(isDOMUnmanaged(widget)).toBe(true)

    selectAcross(editor, textKey)
    const selectionText = editor.getEditorState().read(() => {
      const sel = $getSelection()
      return $isRangeSelection(sel) ? sel.getTextContent() : null
    })
    expect(selectionText).toBe(DOC_TEXT)
  })
})

// Guard against the seeded fixture drifting: every assertion above assumes the
// paragraph is a single TextNode.
describe('fixture assumptions', () => {
  it('seeds exactly one TextNode', () => {
    const { editor } = mountWithParagraph()
    const count = editor.getEditorState().read(() => {
      const p = $getRoot().getFirstChild()
      return $isElementNode(p) ? p.getChildrenSize() : -1
    })
    expect(count).toBe(1)
    expect($createParagraphNode).toBeTypeOf('function')
    expect($createTextNode).toBeTypeOf('function')
  })
})
