// The guards on `registerTaskMarkerShortcut` — the half of #99 that says when
// the shortcut must NOT fire.
//
// `test/check-list-typing.test.ts` drives the real mounted editor, because #99
// is a defect in the typing LOOP and only a keystroke reaches it. These are the
// complementary unit tests: the shortcut registered on a headless editor, with
// the caret placed exactly and one character inserted, so each guard is
// isolated and its control case sits beside it. All three survived a mutation
// of the full suite.

import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import {
  $addUpdateTag,
  $createTextNode,
  $getRoot,
  $isTextNode,
  COMPOSITION_END_TAG,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical'
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from '@lexical/list'
import type { ListType } from '@lexical/list'
import { GFM_NODES } from '../src/transformers/gfm.js'
import { registerTaskMarkerShortcut } from '../src/list-shortcuts.js'

function editor(): LexicalEditor {
  const ed = createHeadlessEditor({
    namespace: 'task-marker-guards',
    nodes: [...GFM_NODES],
    onError: (e) => {
      throw e
    },
  })
  registerTaskMarkerShortcut(ed)
  return ed
}

interface Seed {
  /** The list the item lives in. */
  readonly listType: ListType
  /** The item's text BEFORE the final keystroke. */
  readonly text: string
  /** A format to apply to that text node (the `code` guard). */
  readonly format?: TextFormatType
  /** Where the caret sits when the final character is typed. Defaults to the
   * end of `text`. */
  readonly caret?: number
}

interface Result {
  readonly listType: string
  readonly checked: boolean | undefined
  readonly text: string
}

/**
 * Seed one list item, place the caret, type `key`, and report the list the item
 * ended up in. One keystroke is all the shortcut ever sees.
 *
 * The yield is load-bearing: the shortcut does its work in an `editor.update()`
 * called FROM an update listener, which Lexical defers rather than nesting. The
 * controls at the top of this file fail without it, which is how it was found.
 */
async function typeOneKey(seed: Seed, key: string): Promise<Result[]> {
  const ed = editor()
  ed.update(
    () => {
      const list = $createListNode(seed.listType)
      const item = $createListItemNode()
      const text = $createTextNode(seed.text)
      if (seed.format !== undefined) text.setFormat(seed.format)
      item.append(text)
      list.append(item)
      $getRoot().append(list)
      text.select(seed.caret ?? seed.text.length, seed.caret ?? seed.text.length)
    },
    { discrete: true },
  )
  ed.update(
    () => {
      const list = $getRoot().getFirstChild()
      if (!$isListNode(list)) throw new Error('expected a list')
      const item = list.getFirstChild()
      if (!$isListItemNode(item)) throw new Error('expected an item')
      const text = item.getFirstChild()
      if (!$isTextNode(text)) throw new Error('expected a text node')
      const at = seed.caret ?? seed.text.length
      text.select(at, at)
      text.spliceText(at, 0, key, true)
    },
    { discrete: true },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  return ed.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .flatMap((node) =>
        $isListNode(node)
          ? node.getChildren().flatMap((item) =>
              $isListItemNode(item)
                ? [
                    {
                      listType: node.getListType(),
                      checked: item.getChecked(),
                      text: item.getTextContent(),
                    },
                  ]
                : [],
            )
          : [],
      ),
  )
}

describe('the control: the shortcut DOES fire on a plain bullet item', () => {
  // Without this the three guard tests below would pass vacuously.
  it('converts when the typed space completes the marker', async () => {
    expect(await typeOneKey({ listType: 'bullet', text: '[ ]' }, ' ')).toEqual([
      { listType: 'check', checked: false, text: '' },
    ])
  })

  it('converts `[x]` as checked and keeps the text after the marker', async () => {
    expect(await typeOneKey({ listType: 'bullet', text: '[x]task', caret: 3 }, ' ')).toEqual([
      { listType: 'check', checked: true, text: 'task' },
    ])
  })
})

describe('bullet-only: an ordered or check list is left alone', () => {
  it('leaves a task marker typed in an ORDERED item as literal text', async () => {
    // GFM has no ordered task item, so converting would silently retype the
    // list. `list.getListType() !== 'bullet'` is the whole guard.
    expect(await typeOneKey({ listType: 'number', text: '[ ]' }, ' ')).toEqual([
      { listType: 'number', checked: undefined, text: '[ ] ' },
    ])
  })

  it('leaves a task marker typed in an existing CHECK item as literal text', async () => {
    // Already the thing the shortcut produces; firing would split a list for
    // nothing.
    expect(await typeOneKey({ listType: 'check', text: '[ ]' }, ' ')).toEqual([
      { listType: 'check', checked: false, text: '[ ] ' },
    ])
  })
})

describe('caret completion: the typed character must be the one that closed the marker', () => {
  it('does not convert when the caret is past the end of the marker', async () => {
    // The text still starts with `[ ] ` and the caret moved in a dirty text
    // node, but `match[0].length !== anchorOffset`: this is an edit inside an
    // item, not the completion of a marker.
    expect(await typeOneKey({ listType: 'bullet', text: '[ ] task' }, '!')).toEqual([
      { listType: 'bullet', checked: undefined, text: '[ ] task!' },
    ])
  })

  it('does not convert when the caret is still inside the marker', async () => {
    // Typing the `]` of `[ ]` leaves no trailing space, so there is no marker
    // to complete yet.
    expect(await typeOneKey({ listType: 'bullet', text: '[ ', caret: 2 }, ']')).toEqual([
      { listType: 'bullet', checked: undefined, text: '[ ]' },
    ])
  })
})

describe('composition: an IME-committed marker still fires', () => {
  /** Mark the item's text dirty under a `COMPOSITION_END_TAG` WITHOUT moving
   * the caret — an IME commit that confirms text already in the node. */
  async function commitComposition(text: string): Promise<Result[]> {
    const ed = editor()
    ed.update(
      () => {
        const list = $createListNode('bullet')
        const item = $createListItemNode()
        const node = $createTextNode(text)
        item.append(node)
        list.append(item)
        $getRoot().append(list)
        node.select(text.length, text.length)
      },
      { discrete: true },
    )
    ed.update(
      () => {
        const list = $getRoot().getFirstChild()
        if (!$isListNode(list)) throw new Error('expected a list')
        const item = list.getFirstChild()
        if (!$isListItemNode(item)) throw new Error('expected an item')
        const node = item.getFirstChild()
        if (!$isTextNode(node)) throw new Error('expected a text node')
        $addUpdateTag(COMPOSITION_END_TAG)
        node.select(text.length, text.length)
        node.markDirty()
      },
      { discrete: true },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    return ed.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .flatMap((node) =>
          $isListNode(node)
            ? node.getChildren().flatMap((item) =>
                $isListItemNode(item)
                  ? [
                      {
                        listType: node.getListType(),
                        checked: item.getChecked(),
                        text: item.getTextContent(),
                      },
                    ]
                  : [],
              )
            : [],
        ),
    )
  }

  it('converts when composition ends without the caret moving', () => {
    // The selection is IDENTICAL to the previous one, which the "only as the
    // user types" test rejects on its own. Upstream exempts a
    // `COMPOSITION_END_TAG` update (`MarkdownShortcuts.ts:567`); without that
    // exemption an IME-committed marker never fires at all.
    return expect(commitComposition('[ ] ')).resolves.toEqual([
      { listType: 'check', checked: false, text: '' },
    ])
  })
})

describe('code format: a code-formatted marker is literal text', () => {
  it('leaves a code-formatted `[ ] ` at the start of a bullet item alone', async () => {
    // `canContainTransformableMarkdown` (`importTextTransformers.ts:29`).
    // Upstream applies it to every TEXT transformer and nothing carried it to
    // an element one, so without the explicit `hasFormat('code')` test this
    // converted.
    expect(await typeOneKey({ listType: 'bullet', text: '[ ]', format: 'code' }, ' ')).toEqual([
      { listType: 'bullet', checked: undefined, text: '[ ] ' },
    ])
  })
})
