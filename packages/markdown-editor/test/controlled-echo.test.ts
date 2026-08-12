// Issue #70 in full, and the part of #71 that follows from it.
//
// The controlled value used to be guarded in three places with three different
// notions of equality: the `lexicalForeign` seam (against the last serialized
// emission), this package's editor (against the last value delivered to the
// consumer), and this package's reducer (against its mirrored value). All three
// asked "is this the same STRING", which is not the question that matters — the
// question is "would applying this change the DOCUMENT". These tests pin the
// single authority in the seam and the two behaviours it makes possible:
//
//   • a value authored in a surface form the serializer does not emit
//     (`_em_` where it emits `*em*`) is recognised as an echo, so the caret
//     survives typing in a controlled loop (#71);
//   • a value that WOULD change the document is never suppressed, even when it
//     is byte-identical to something a higher layer remembers (#70).
//
// ── What is NOT claimed here (#71's residual) ──────────────────────────────
// The authority decides "same document?" by round-tripping the value through
// the IMPORTER. So which surface differences count as cosmetic is settled by
// the importer/exporter pair, not by this seam — and #71 names three cases of
// which only one is cosmetic in this transformer set:
//
//   • emphasis / strong delimiters and blank-line runs collapse on import, so
//     they are echoes. Delivered — the tests below.
//   • the bullet marker (`-` / `*` / `+`) round-trips VERBATIM, so `* one` is a
//     genuinely different serialization of `- one`. Pinned as a real change
//     below, not as an echo; #71's AC naming it as cosmetic is wrong for this
//     transformer set, as all three #70 spikes measured independently.
//   • trailing whitespace (and the padding after a list marker) also round-trips
//     verbatim, though CommonMark strips final whitespace from a paragraph's raw
//     content — so this one is an IMPORTER conformance gap. The push applies
//     once and then converges (pinned below), but the caret dies on that first
//     write, and a consumer that re-authors whitespace onto every emission
//     authors a new document each time and so never converges at all.
//
// #71 therefore stays OPEN on the trailing-whitespace/list-padding half, which
// needs an importer normal-form fix (the mdast-driven importer this package
// already owes its transformer set), not another echo guard. Do not close it on
// the strength of this file.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, type SignalComponentHandle } from '@llui/dom'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical'
import { markdownEditor } from '../src/editor.js'
import type { EditorMsg, EditorState } from '../src/state.js'
import { waitFor } from './wait-for'

/** The mounted editor, typed — `dirty`/`value` assertions read real state here,
 * so nothing in this file needs a cast to inspect the reducer's mirror. */
type EditorHandle = SignalComponentHandle<EditorState, EditorMsg>

let container: HTMLElement
let app: EditorHandle | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A consumer with its own house style: it stores what the editor emits but
 * re-authors emphasis as `_…_` and strong as `__…__`. Both are valid CommonMark
 * for the same document and neither is the serializer's normal form (`*…*` /
 * `**…**`), so every push is a value "not in the serializer's normal form". */
function houseStyle(md: string): string {
  return md.replace(/\*\*(.+?)\*\*/g, '__$1__').replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '_$1_')
}

/** Type one character at the caret, committed synchronously. */
function typeChar(editor: LexicalEditor, ch: string): void {
  editor.update(
    () => {
      const sel = $getSelection()
      if ($isRangeSelection(sel)) sel.insertText(ch)
      else $getRoot().selectEnd().insertText(ch)
    },
    { discrete: true },
  )
}

/** The live caret, or null once a programmatic re-apply has dropped it
 * (`deserialize` clears the selection on every write). */
function caret(editor: LexicalEditor): RangeSelection | null {
  return editor.getEditorState().read(() => {
    const sel = $getSelection()
    return $isRangeSelection(sel) ? sel : null
  })
}

const markdownOf = (editor: LexicalEditor): string =>
  editor.getEditorState().read(() => $getRoot().getTextContent())

/** Key of the document's first block. A programmatic re-apply replaces the whole
 * tree, so a key that survives is proof the seam declined to write. */
const topKey = (editor: LexicalEditor): string =>
  editor.getEditorState().read(() => $getRoot().getFirstChildOrThrow().getKey())

describe('issue #71 (delivered half): a surface form the importer collapses', () => {
  /** Mount a controlled loop: the consumer owns the value, receives every
   * emission, and pushes it straight back in its own surface form. */
  function mountControlled(authored: string): { editor: LexicalEditor; pushes: string[] } {
    let editor!: LexicalEditor
    const pushes: string[] = []
    const handle = mountApp(
      container,
      markdownEditor({
        defaultValue: authored,
        changeDebounceMs: 5,
        onReady: (e) => {
          editor = e
        },
        onChange: (md) => {
          const value = houseStyle(md)
          pushes.push(value)
          handle.send({ type: 'setValue', value })
        },
      }),
    )
    app = handle
    return { editor, pushes }
  }

  it('survives the caret through a controlled typing loop (emphasis delimiter)', async () => {
    const { editor, pushes } = mountControlled('_em_ tail')
    // The document is the same either way; only the surface form differs.
    expect(markdownOf(editor)).toBe('em tail')

    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    for (const ch of 'abc') {
      typeChar(editor, ch)
      // Let the debounce fire, the consumer re-author, and the push come back.
      await waitFor(() => pushes.length > 0 && pushes.at(-1)!.endsWith(ch))
      await wait(5)
      // The push was recognised as an echo: the document was NOT rewritten, so
      // the caret is still where the user left it.
      expect(caret(editor)).not.toBeNull()
    }
    expect(markdownOf(editor)).toBe('em tailabc')
    // Every push was in the consumer's form, never the serializer's.
    expect(pushes.every((p) => p.startsWith('_em_'))).toBe(true)
  })

  it('survives the caret through a controlled typing loop (strong delimiter)', async () => {
    const { editor, pushes } = mountControlled('__bold__ tail')
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    for (const ch of 'xy') {
      typeChar(editor, ch)
      await waitFor(() => pushes.length > 0 && pushes.at(-1)!.endsWith(ch))
      await wait(5)
      expect(caret(editor)).not.toBeNull()
    }
    expect(markdownOf(editor)).toBe('bold tailxy')
    expect(pushes.every((p) => p.startsWith('__bold__'))).toBe(true)
  })

  it('recognises a blank-line variant of the same document as an echo', async () => {
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        defaultValue: 'one\n\ntwo',
        changeDebounceMs: 5,
        onReady: (e) => {
          editor = e
        },
      }),
    )
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    expect(caret(editor)).not.toBeNull()

    // Extra blank lines collapse on serialization — a different string, the same
    // document. Pushing it must not rewrite the document.
    app.send({ type: 'setValue', value: 'one\n\n\n\ntwo' })
    await wait(0)
    expect(caret(editor)).not.toBeNull()
    expect(markdownOf(editor)).toBe('one\n\ntwo')
  })

  it('treats a different bullet marker as a REAL change in this transformer set', async () => {
    // #71 names the bullet marker as a cosmetic difference. In this transformer
    // set it is not: `-`, `*` and `+` each round-trip verbatim, so `* one` and
    // `- one` are genuinely different serializations of the document and the
    // seam is right to write. Pinned so nobody "fixes" the echo authority to
    // swallow it — that would mean losing a marker change the host asked for.
    // The real normalization cases are emphasis/strong delimiters and blank-line
    // runs, covered above.
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        defaultValue: '- one\n- two',
        changeDebounceMs: 5,
        onReady: (e) => {
          editor = e
        },
      }),
    )
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    expect(caret(editor)).not.toBeNull()

    app.send({ type: 'setValue', value: '* one\n* two' })
    await wait(0)
    // Written, so the selection went with it — the marker really did change.
    expect(caret(editor)).toBeNull()
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(app.getState().dirty).toBe(true)
  })

  it('records #71’s residual: trailing whitespace and list padding are REAL changes', async () => {
    // The other two surface forms #71 calls cosmetic. They are not, here, and
    // NOT for the reason the bullet marker is not: the importer keeps the extra
    // spaces in the text node and the exporter emits them, so the value round-
    // trips verbatim and really does describe a different document. CommonMark
    // disagrees (final whitespace is stripped from a paragraph's raw content),
    // which makes this an IMPORTER normal-form gap — out of #70's scope, and the
    // reason #71 is not closed by this change. Pinned so the residual is
    // executable: an importer fix flips these assertions instead of landing
    // silently.
    //
    // What the echo authority DOES buy here is termination: the value applies
    // once and every re-push of it is then an echo. (A consumer that appends
    // whitespace to each emission instead of storing it authors a NEW document
    // every time, and no echo authority can converge that.)
    const probe = async (seed: string, padded: string): Promise<void> => {
      let editor!: LexicalEditor
      const handle = mountApp(
        container,
        markdownEditor({
          defaultValue: seed,
          changeDebounceMs: 5,
          onReady: (e) => {
            editor = e
          },
        }),
      )
      app = handle
      editor.update(() => $getRoot().selectEnd(), { discrete: true })
      expect(caret(editor)).not.toBeNull()

      // First push: a real write — the caret dies. This IS #71's symptom, and
      // it is the importer's doing, not a stale echo baseline's.
      handle.send({ type: 'setValue', value: padded })
      await wait(0)
      expect(caret(editor)).toBeNull()
      const key = topKey(editor)

      // Second push: the document now serializes to exactly the pushed value, so
      // the authority declines. The loop converges rather than rebuilding forever.
      editor.update(() => $getRoot().selectEnd(), { discrete: true })
      handle.send({ type: 'setValue', value: padded })
      await wait(0)
      expect(topKey(editor)).toBe(key)
      expect(caret(editor)).not.toBeNull()

      handle.dispose()
      app = null
      container.innerHTML = ''
    }

    await probe('hello', 'hello   ')
    await probe('- one\n- two', '-   one\n-   two')
  })

  it('still applies a value that really is a different document', async () => {
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        defaultValue: '_em_ tail',
        changeDebounceMs: 5,
        onReady: (e) => {
          editor = e
        },
      }),
    )
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    app.send({ type: 'setValue', value: '# Replaced' })
    await wait(0)
    expect(container.querySelector('h1')?.textContent).toBe('Replaced')
    // A real write clears the selection, by design (`deserialize` does this so an
    // external push can't steal DOM focus).
    expect(caret(editor)).toBeNull()
  })
})

describe('issue #70: no layer above the seam holds an opinion about the value', () => {
  it('does not notify the consumer when a commit did not move the document', async () => {
    // Every commit arms the outbound debounce, including a bare caret move. The
    // seam is the layer that knows a caret move is not a change; with the editor's
    // per-mount dedupe deleted there is no second net, so this pins the seam's own
    // outbound gate. (Before #70 the dedupe let the FIRST such emission through,
    // because it had nothing to compare against yet.)
    let editor!: LexicalEditor
    const changes: string[] = []
    app = mountApp(
      container,
      markdownEditor({
        defaultValue: 'stable text',
        changeDebounceMs: 5,
        onReady: (e) => {
          editor = e
        },
        onChange: (md) => changes.push(md),
      }),
    )
    editor.update(() => $getRoot().selectStart(), { discrete: true })
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    await wait(30)
    expect(changes).toEqual([])

    // A real edit still reports, exactly once.
    typeChar(editor, '!')
    await waitFor(() => changes.length === 1)
    expect(changes).toEqual(['stable text!'])
  })

  it('applies a push that a value-mirroring reducer would have swallowed', async () => {
    // The reducer's mirror is the last SERIALIZED document. Here the user types
    // inside the debounce window, so the mirror is stale: a push equal to the
    // mirror is a genuine revert of the un-emitted keystrokes. A reducer-level
    // `if (msg.value === state.value) return` swallows it and the revert is lost.
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        defaultValue: 'original',
        changeDebounceMs: 1000, // long: the typing never reaches the reducer
        onReady: (e) => {
          editor = e
        },
      }),
    )
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    typeChar(editor, '?')
    expect(markdownOf(editor)).toBe('original?')
    // The reducer still mirrors 'original' — the edit is inside the debounce.
    expect(app.getState().value).toBe('original')

    app.send({ type: 'setValue', value: 'original' })
    await wait(0)
    // The revert reached the document instead of being swallowed as an "echo".
    expect(markdownOf(editor)).toBe('original')
  })

  it('reports the same value twice when the document really returned to it', async () => {
    // The editor used to dedupe consumer notifications per mount against the last
    // value it delivered. That net is gone and must stay gone: after a push moves
    // the document away, a user edit that lands back on a previously emitted value
    // is a genuine change the consumer has to hear about. A reintroduced
    // `lastChange` guard swallows the second delivery and this test fails.
    let editor!: LexicalEditor
    const changes: string[] = []
    const handle = mountApp(
      container,
      markdownEditor({
        defaultValue: 'original',
        changeDebounceMs: 5,
        onReady: (e) => {
          editor = e
        },
        onChange: (md) => changes.push(md),
      }),
    )
    app = handle

    typeChar(editor, '!')
    await waitFor(() => changes.length === 1)
    expect(changes).toEqual(['original!'])

    // Push the document back to the seed — a real write, so the seam rebases.
    handle.send({ type: 'setValue', value: 'original' })
    await wait(0)
    expect(markdownOf(editor)).toBe('original')

    // The same edit again produces the same markdown, and it is news again.
    typeChar(editor, '!')
    await waitFor(() => changes.length === 2)
    expect(changes).toEqual(['original!', 'original!'])
  })
})

describe('issue #70: `dirty` follows the seam’s write decision, not the push', () => {
  /** Mount uncontrolled (the live `setValue` + `onChange` channel). */
  function mount(defaultValue: string, changeDebounceMs = 5): EditorHandle {
    const handle = mountApp(container, markdownEditor({ defaultValue, changeDebounceMs }))
    app = handle
    return handle
  }

  it('stays clean when the seam declines a push it already holds', async () => {
    const handle = mount('*em* tail')
    expect(handle.getState().dirty).toBe(false)

    // The same document in the consumer's surface form. The seam declines the
    // write, so the document did not move and `dirty` must not claim it did —
    // and the reducer learns that from the seam's report, never by comparing
    // the pushed string against its own mirror (that comparison IS issue #70).
    handle.send({ type: 'setValue', value: '_em_ tail' })
    await wait(0)
    expect(handle.getState().dirty).toBe(false)
    // The push is still mirrored: `state.value` tracks imperative pushes.
    expect(handle.getState().value).toBe('_em_ tail')
  })

  it('goes dirty when the seam actually writes', async () => {
    const handle = mount('*em* tail')
    handle.send({ type: 'setValue', value: '# Different' })
    await wait(0)
    expect(handle.getState().dirty).toBe(true)
  })

  it('keeps a dirty flag an earlier edit set when a later push is declined', async () => {
    let editor!: LexicalEditor
    const handle = mountApp(
      container,
      markdownEditor({
        defaultValue: 'seed',
        changeDebounceMs: 5,
        onReady: (e) => {
          editor = e
        },
      }),
    )
    app = handle
    typeChar(editor, '!')
    await waitFor(() => handle.getState().dirty)

    // Echoing the serialized document back is declined — and a decline reports
    // nothing about the document, so it can never CLEAR an edit's dirty flag.
    handle.send({ type: 'setValue', value: 'seed!' })
    await wait(0)
    expect(handle.getState().dirty).toBe(true)
  })
})

describe('issue #70: the authored-form memo (a value the live editor rewrites on import)', () => {
  // The seam decides "would applying this change the document?" by parsing the
  // value in a scratch editor built from the same node set but WITHOUT the live
  // editor's registered node transforms. `registerLinkSanitizer` is exactly such
  // a transform: it unwraps a `javascript:` link on import, so this value's
  // normalized form can never equal the live serialization. Without the memo of
  // authored forms already proven to describe the current document, every re-push
  // rewrites the document and the caret dies on every keystroke — #71's bug
  // reappearing inside #71's fix.
  const UNSAFE = '[click](javascript:alert)'

  it('applies such a value once, then recognises every re-push as an echo', async () => {
    let editor!: LexicalEditor
    const handle = mountApp(
      container,
      markdownEditor({
        defaultValue: 'seed',
        changeDebounceMs: 5,
        onReady: (e) => {
          editor = e
        },
      }),
    )
    app = handle

    handle.send({ type: 'setValue', value: UNSAFE })
    await wait(0)
    // The sanitizer's node transform unwrapped the link: the live document is
    // plain text (no anchor), so it serializes to `click` and can never
    // round-trip back to the authored value.
    expect(container.querySelector('a')).toBeNull()
    expect(markdownOf(editor)).toBe('click')
    expect(handle.getState().dirty).toBe(true)

    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    const key = topKey(editor)
    expect(caret(editor)).not.toBeNull()

    // Twice more: the memo does not decay after one hit, so the loop converges.
    for (let i = 0; i < 2; i++) {
      handle.send({ type: 'setValue', value: UNSAFE })
      await wait(0)
      expect(topKey(editor)).toBe(key)
      expect(caret(editor)).not.toBeNull()
    }
  })

  it('re-applies the value once the document has moved on', async () => {
    let editor!: LexicalEditor
    const handle = mountApp(
      container,
      markdownEditor({
        defaultValue: 'seed',
        changeDebounceMs: 1000,
        onReady: (e) => {
          editor = e
        },
      }),
    )
    app = handle

    handle.send({ type: 'setValue', value: UNSAFE })
    await wait(0)
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    typeChar(editor, '?')
    expect(markdownOf(editor)).toBe('click?')

    // The memo is keyed on the live serialization, so the keystroke dropped it:
    // this push is a real change again and is written.
    handle.send({ type: 'setValue', value: UNSAFE })
    await wait(0)
    expect(markdownOf(editor)).toBe('click')
  })
})
