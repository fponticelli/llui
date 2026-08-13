// Issue #99: typing `- [ ] ` must produce a check-list item, not a bullet item
// whose text is the literal `[ ] `.
//
// These are KEYSTROKE tests on purpose. The import path (`- [ ] task` in a
// document) already worked and would not have caught this: the defect lives in
// `@lexical/markdown`'s typing loop, whose `runElementTransformers` bails unless
// the block's grandparent is the root — and `- ` has already made the block a
// `ListItemNode` inside a `ListNode` by the time `[ ] ` is typed.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp } from '@llui/dom'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'
import { $isListItemNode, $isListNode } from '@lexical/list'
import { markdownEditor } from '../src/editor.js'

let container: HTMLElement
let app: ReturnType<typeof mountApp> | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
})

const yieldToLoop = (): Promise<unknown> => new Promise((r) => setTimeout(r, 0))

/** Type `text` one character at a time, yielding between keys like a real user
 * so every keystroke is its own committed update (and its own shortcut pass). */
async function type(editor: LexicalEditor, text: string): Promise<void> {
  for (const ch of text) {
    editor.update(
      () => {
        const root = $getRoot()
        let sel = $getSelection()
        if (!$isRangeSelection(sel)) sel = root.selectEnd()
        if ($isRangeSelection(sel)) {
          if (ch === '\n') sel.insertParagraph()
          else sel.insertText(ch)
        }
      },
      { discrete: true },
    )
    await yieldToLoop()
  }
}

/** One block of the document, flattened to the few facts these tests assert. */
interface Block {
  kind: string
  /** `undefined` for a non-list block. */
  listType?: string
  items?: Array<{ checked: boolean | undefined; text: string }>
  text?: string
}

function describeRoot(): Block[] {
  return $getRoot()
    .getChildren()
    .map((node: LexicalNode): Block => {
      if ($isListNode(node)) {
        return {
          kind: 'list',
          listType: node.getListType(),
          items: node
            .getChildren()
            .flatMap((item) =>
              $isListItemNode(item)
                ? [{ checked: item.getChecked(), text: item.getTextContent() }]
                : [],
            ),
        }
      }
      return { kind: node.getType(), text: node.getTextContent() }
    })
}

async function typeIntoEditor(text: string): Promise<Block[]> {
  let editor!: LexicalEditor
  app = mountApp(
    container,
    markdownEditor({
      defaultValue: '',
      onReady: (e) => {
        editor = e
      },
      onChange: () => {},
    }),
  )
  await type(editor, text)
  return editor.getEditorState().read(describeRoot)
}

describe('issue #99: typing a task marker inside a bullet item', () => {
  const checkItem = (checked: boolean, text: string): Block[] => [
    { kind: 'list', listType: 'check', items: [{ checked, text }] },
  ]

  it('typing `- [ ] ` produces an unchecked check-list item', async () => {
    expect(await typeIntoEditor('- [ ] task')).toEqual(checkItem(false, 'task'))
  })

  it('typing `- [x] ` produces a checked check-list item', async () => {
    expect(await typeIntoEditor('- [x] task')).toEqual(checkItem(true, 'task'))
  })

  // Ties #100 (uppercase `[X]` loses the checked state) to the typing path too:
  // the two halves must agree about case wherever a marker is read.
  it('typing `- [X] ` produces a checked check-list item', async () => {
    expect(await typeIntoEditor('- [X] task')).toEqual(checkItem(true, 'task'))
  })

  it('typing `* [ ] ` behaves like `- [ ] `', async () => {
    expect(await typeIntoEditor('* [ ] task')).toEqual(checkItem(false, 'task'))
  })

  it('typing `+ [ ] ` behaves like `- [ ] `', async () => {
    expect(await typeIntoEditor('+ [ ] task')).toEqual(checkItem(false, 'task'))
  })

  it('typing `[ ] ` from a plain paragraph still works', async () => {
    expect(await typeIntoEditor('[ ] task')).toEqual(checkItem(false, 'task'))
  })

  it('leaves `- [note] see below` a bullet item with its text intact', async () => {
    expect(await typeIntoEditor('- [note] see below')).toEqual([
      {
        kind: 'list',
        listType: 'bullet',
        items: [{ checked: undefined, text: '[note] see below' }],
      },
    ])
  })

  it('leaves a bracket that is not a task marker alone (`- [] x` needs no space)', async () => {
    // `- []x` has no space after the closing bracket, so it is not a task
    // marker and must survive as literal text.
    expect(await typeIntoEditor('- []x')).toEqual([
      { kind: 'list', listType: 'bullet', items: [{ checked: undefined, text: '[]x' }] },
    ])
  })

  it('converts an existing bullet item by typing `[ ] ` at its start, splitting the list', async () => {
    // `- one` ⏎ `[ ] two`: the second item is already a ListItemNode when the
    // marker is typed, which is precisely the case the upstream guard blocks.
    expect(await typeIntoEditor('- one\n[ ] two')).toEqual([
      { kind: 'list', listType: 'bullet', items: [{ checked: undefined, text: 'one' }] },
      { kind: 'list', listType: 'check', items: [{ checked: false, text: 'two' }] },
    ])
  })

  it('converts the middle item of a bullet list, keeping the items around it', async () => {
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        defaultValue: '',
        onReady: (e) => {
          editor = e
        },
        onChange: () => {},
      }),
    )
    await type(editor, '- one\ntwo\nthree')
    // Put the caret at the start of the MIDDLE item, then type the marker there.
    editor.update(
      () => {
        const list = $getRoot().getFirstChild()
        if (!$isListNode(list)) throw new Error('expected a list')
        const middle = list.getChildren()[1]
        if (!$isListItemNode(middle)) throw new Error('expected a list item')
        middle.selectStart()
      },
      { discrete: true },
    )
    await yieldToLoop()
    await type(editor, '[x] ')

    expect(editor.getEditorState().read(describeRoot)).toEqual([
      { kind: 'list', listType: 'bullet', items: [{ checked: undefined, text: 'one' }] },
      { kind: 'list', listType: 'check', items: [{ checked: true, text: 'two' }] },
      { kind: 'list', listType: 'bullet', items: [{ checked: undefined, text: 'three' }] },
    ])
  })
})
