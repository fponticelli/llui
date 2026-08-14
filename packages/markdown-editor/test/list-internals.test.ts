// The two `@lexical/list` internals `MarkdownListNode` had to re-implement,
// tested on the surfaces that actually expose them.
//
// Declaring `extends: ElementNode` skips `ListNode`'s whole `$config()`, not
// just its merging `$transform`, so `nodes/list.ts` ports two unexported
// upstream functions: `updateChildrenListItemValue` (the ordered-item
// bookkeeping) and `mergeLists` (including its nested-sublist splice).
//
// Neither was reachable from the #129/#100 tests. `$listExport` renders an
// ordered prefix as `getStart() + index`, so item VALUES never appear in the
// markdown a round-trip compares — deleting the whole `$updateChildrenListItemValue`
// call left `3. a\n4. b\n5. c` exporting correctly while every item's value was
// `1`. Anything reading the node model instead (a themed `<li value>`, a
// collab peer, `exportJSON`) saw the wrong numbers.
//
// The third case here is HTML import. `$convertListNode` is reached through the
// conversion cache Lexical builds from every registered klass's `importDOM`, and
// nothing in the package had ever imported a list from HTML — `test/paste.test.ts`
// only asserts that a clipboard carrying `text/html` DEFERS to Lexical.

import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString } from '@lexical/markdown'
import { $generateNodesFromDOM } from '@lexical/html'
import { $createTextNode, $getRoot, type LexicalEditor, type LexicalNode } from 'lexical'
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListType,
} from '@lexical/list'
import { corePlugin } from '../src/plugins/core.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'
import { $isMarkdownListNode } from '../src/nodes/list.js'

const transformers = buildTransformers([corePlugin()])

function editor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: 'list-internals',
    nodes: [...GFM_NODES],
    onError: (e) => {
      throw e
    },
  })
}

/** The `value` Lexical gave each item of the document's first list. */
function firstListItemValues(markdown: string): number[] {
  const ed = editor()
  ed.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  return ed.getEditorState().read(() => {
    const list = $getRoot().getFirstChild()
    if (!$isListNode(list)) throw new Error('expected a list')
    return list.getChildren().flatMap((item) => ($isListItemNode(item) ? [item.getValue()] : []))
  })
}

describe('$updateChildrenListItemValue — ordered items carry their ordinal', () => {
  // Invisible to a markdown round-trip: `$listExport` renders `getStart() + index`,
  // so these all export correctly even when every value is 1.
  it('numbers `3. a / 4. b / 5. c` as 3, 4, 5', () => {
    expect(firstListItemValues('3. a\n4. b\n5. c')).toEqual([3, 4, 5])
  })

  it('numbers a list starting at 1 as 1, 2, 3', () => {
    expect(firstListItemValues('1. a\n2. b\n3. c')).toEqual([1, 2, 3])
  })

  it('renumbers from the list start after a `1)` delimiter run', () => {
    expect(firstListItemValues('7) a\n8) b')).toEqual([7, 8])
  })

  it('does not number an item that only holds a nested list', () => {
    const ed = editor()
    ed.update(
      () => {
        const outer = $createListNode('number', 1)
        const first = $createListItemNode()
        first.append($createTextNode('a'))
        const holder = $createListItemNode()
        const nested = $createListNode('number', 1)
        const nestedItem = $createListItemNode()
        nestedItem.append($createTextNode('a1'))
        nested.append(nestedItem)
        holder.append(nested)
        const last = $createListItemNode()
        last.append($createTextNode('b'))
        outer.append(first, holder, last)
        $getRoot().append(outer)
      },
      { discrete: true },
    )
    const got = ed.getEditorState().read(() => {
      const list = $getRoot().getFirstChild()
      if (!$isListNode(list)) throw new Error('expected a list')
      return list.getChildren().flatMap((item) => ($isListItemNode(item) ? [item.getValue()] : []))
    })
    // The nested-list holder keeps the ordinal of its position but does NOT
    // advance the counter, so the text item after it is `2`, not `3`.
    expect(got).toEqual([1, 2, 2])
  })

  it('clears a stray `checked` on a list that is not a check list', () => {
    const ed = editor()
    ed.update(
      () => {
        const list = $createListNode('bullet')
        const item = $createListItemNode(true)
        item.append($createTextNode('a'))
        list.append(item)
        $getRoot().append(list)
      },
      { discrete: true },
    )
    const checked = ed.getEditorState().read(() => {
      const list = $getRoot().getFirstChild()
      if (!$isListNode(list)) throw new Error('expected a list')
      return list
        .getChildren()
        .flatMap((item) => ($isListItemNode(item) ? [item.getChecked()] : []))
    })
    expect(checked).toEqual([undefined])
  })
})

/** Render a list as `type[child, child]`, where a child is its text or a
 * nested list rendered the same way — enough to see where a sublist sits. */
function shape(node: LexicalNode): string {
  if ($isListNode(node)) {
    return `${node.getListType()}[${node.getChildren().map(shape).join(', ')}]`
  }
  if ($isListItemNode(node)) {
    const first = node.getFirstChild()
    if (first !== null && $isListNode(first)) return shape(first)
    return node.getTextContent()
  }
  return node.getType()
}

describe('$mergeLists — a sublist at the seam is spliced, not left doubled', () => {
  /** Two adjacent bullet lists, each carrying a nested list at the join: the
   * last item of the first holds one, the first item of the second holds one. */
  function $buildSeam(): void {
    const mk = (listType: ListType, ...texts: string[]) => {
      const list = $createListNode(listType)
      for (const text of texts) {
        const item = $createListItemNode()
        item.append($createTextNode(text))
        list.append(item)
      }
      return list
    }
    const holderA = $createListItemNode()
    holderA.append(mk('bullet', 'a1', 'a2'))
    const listA = mk('bullet', 'a')
    listA.append(holderA)

    const holderB = $createListItemNode()
    holderB.append(mk('bullet', 'b1'))
    const listB = $createListNode('bullet')
    listB.append(holderB)
    const tail = $createListItemNode()
    tail.append($createTextNode('b'))
    listB.append(tail)

    $getRoot().append(listA, listB)
  }

  it('merges the two sublists into one and drops the emptied item', () => {
    const ed = editor()
    ed.update($buildSeam, { discrete: true })
    const got = ed.getEditorState().read(() => $getRoot().getChildren().map(shape))
    // Without the splice this is `bullet[a, bullet[a1, a2], bullet[b1], b]` —
    // two sibling sublists in adjacent items, which is not a tree any markdown
    // can express.
    expect(got).toEqual(['bullet[a, bullet[a1, a2, b1], b]'])
  })

  it('still merges plain adjacent lists with no sublist at the seam', () => {
    const ed = editor()
    ed.update(
      () => {
        const mk = (...texts: string[]) => {
          const list = $createListNode('bullet')
          for (const text of texts) {
            const item = $createListItemNode()
            item.append($createTextNode(text))
            list.append(item)
          }
          return list
        }
        $getRoot().append(mk('a'), mk('b'))
      },
      { discrete: true },
    )
    const got = ed.getEditorState().read(() => $getRoot().getChildren().map(shape))
    expect(got).toEqual(['bullet[a, b]'])
  })
})

describe('importDOM — a list pasted as HTML', () => {
  /** Import an HTML fragment the way a rich paste does, and describe the roots. */
  function fromHtml(html: string): { shapes: string[]; allMarkdownLists: boolean } {
    const ed = editor()
    ed.update(
      () => {
        const dom = new DOMParser().parseFromString(html, 'text/html')
        $getRoot().append(...$generateNodesFromDOM(ed, dom))
      },
      { discrete: true },
    )
    return ed.getEditorState().read(() => {
      const children = $getRoot().getChildren()
      return {
        shapes: children.map(shape),
        allMarkdownLists: children.every($isMarkdownListNode),
      }
    })
  }

  it('imports `<ul>` as a bullet list', () => {
    expect(fromHtml('<ul><li>a</li><li>b</li></ul>')).toEqual({
      shapes: ['bullet[a, b]'],
      allMarkdownLists: true,
    })
  })

  it('imports `<ol>` as a number list', () => {
    expect(fromHtml('<ol><li>a</li><li>b</li></ol>')).toEqual({
      shapes: ['number[a, b]'],
      allMarkdownLists: true,
    })
  })

  it('carries an `<ol start>` onto the imported list and its item values', () => {
    const ed = editor()
    ed.update(
      () => {
        const dom = new DOMParser().parseFromString(
          '<ol start="3"><li>a</li><li>b</li></ol>',
          'text/html',
        )
        $getRoot().append(...$generateNodesFromDOM(ed, dom))
      },
      { discrete: true },
    )
    const got = ed.getEditorState().read(() => {
      const list = $getRoot().getFirstChild()
      if (!$isListNode(list)) throw new Error('expected a list')
      return {
        start: list.getStart(),
        values: list
          .getChildren()
          .flatMap((item) => ($isListItemNode(item) ? [item.getValue()] : [])),
      }
    })
    expect(got).toEqual({ start: 3, values: [3, 4] })
  })

  it('imports a nested `<ul>` as a nested list', () => {
    expect(fromHtml('<ul><li>a</li><li><ul><li>a1</li></ul></li></ul>').shapes).toEqual([
      'bullet[a, bullet[a1]]',
    ])
  })
})
