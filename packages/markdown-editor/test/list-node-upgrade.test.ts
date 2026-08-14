// The other half of #129: a `list`-typed node that never went through
// `$createListNode`.
//
// `MARKDOWN_LIST_NODES` registers the stock `ListNode` so a document written
// before `MarkdownListNode` existed still deserializes. But
// `$parseSerializedNodeImpl` (`LexicalUpdates.ts:433`) calls
// `nodeClass.importJSON` with NO replacement resolution, so that JSON — and any
// CRDT document created by an older build — produces a genuine stock `ListNode`,
// carrying `ListNode.$config().$transform` and its unconditional
// `mergeNextSiblingListIfSameType`. The #129 guarantee is void for exactly those
// documents, which are the ones the issue was reported from.
//
// `registerListNodeUpgrade` closes it: the first time such a node is marked
// dirty it is replaced by a `MarkdownListNode`. These tests pin the upgrade, the
// no-op guard that keeps it from looping through `replaceWithKlass`, and that
// the properties an upgrade must carry across survive it.

import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $createTextNode, $getRoot, type LexicalEditor } from 'lexical'
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode } from '@lexical/list'
import { GFM_NODES } from '../src/transformers/gfm.js'
import { $isMarkdownListNode, registerListNodeUpgrade } from '../src/nodes/list.js'
import { $insertMarkdownAtSelection } from '../src/paste.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { corePlugin } from '../src/plugins/core.js'

const transformers = buildTransformers([corePlugin()])

/** One serialized list block, exactly as a build before `MarkdownListNode`
 * wrote it: `type: 'list'`, and no `lluiListMarker` node state. */
interface OldListOptions {
  readonly listType?: string
  readonly start?: number
  readonly checked?: boolean
}

const oldList = (text: string, opts: OldListOptions = {}): unknown => ({
  children: [
    {
      children: [
        { detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'listitem',
      version: 1,
      value: 1,
      ...(opts.checked === undefined ? {} : { checked: opts.checked }),
    },
  ],
  direction: null,
  format: '',
  indent: 0,
  type: 'list',
  version: 1,
  listType: opts.listType ?? 'bullet',
  start: opts.start ?? 1,
  tag: opts.listType === 'number' ? 'ol' : 'ul',
})

const oldDoc = (...lists: unknown[]): string =>
  JSON.stringify({
    root: {
      children: lists,
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  })

function editor(): LexicalEditor {
  const ed = createHeadlessEditor({
    namespace: 'list-node-upgrade',
    nodes: [...GFM_NODES],
    onError: (e) => {
      throw e
    },
  })
  registerListNodeUpgrade(ed)
  return ed
}

/** Load a document an older build serialized. */
function loadOld(ed: LexicalEditor, json: string): void {
  ed.setEditorState(ed.parseEditorState(json))
}

/** Every root child as `type/md=<isMarkdownListNode>(text|text)`. */
function describeLists(ed: LexicalEditor): string[] {
  return ed.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((node) =>
        $isListNode(node)
          ? `${node.getType()}/md=${$isMarkdownListNode(node)}(${node
              .getTextContent()
              .replace(/\n+/g, '|')})`
          : node.getType(),
      ),
  )
}

/** Build a fresh bullet list the way the editor does — through
 * `$createListNode`, so the registered replacement makes it a `md-list`. */
function $appendBulletList(text: string): void {
  const list = $createListNode('bullet')
  const item = $createListItemNode()
  item.append($createTextNode(text))
  list.append(item)
  $getRoot().append(list)
}

describe('a stock `list` node from older JSON is upgraded on touch', () => {
  it('upgrades a list deserialized from pre-`md-list` JSON', () => {
    const ed = editor()
    loadOld(ed, oldDoc(oldList('a')))
    expect(describeLists(ed)).toEqual(['md-list/md=true(a)'])
  })

  it('still absorbs an adjacent list nobody spelled a marker for — as an `md-list`', () => {
    // Two markerless lists merging is the DESIGNED behaviour (`canJoinLists`:
    // an unspelled list joins anything of its type). What the upgrade changes
    // is which class survives: `md-list`, not the stock `list` the review saw.
    const ed = editor()
    loadOld(ed, oldDoc(oldList('stock')))
    ed.update(() => $appendBulletList('md'), { discrete: true })
    expect(describeLists(ed)).toEqual(['md-list/md=true(stock|md)'])
  })

  it('lets a marker change split a list pasted into an OLD document', () => {
    // The decisive case. A stock `ListNode` merges its next same-`listType`
    // sibling UNCONDITIONALLY, so it swallowed `- b` AND `* c` into one list.
    // Upgraded, the old list adopts `-` from the first (it had no marker of its
    // own) and then refuses `*` — CommonMark §5.3, which is all #129 asks for.
    const ed = editor()
    loadOld(ed, oldDoc(oldList('a')))
    ed.update(
      () => {
        $getRoot().selectEnd()
        $insertMarkdownAtSelection('- b\n\n* c', [...transformers])
      },
      { discrete: true },
    )
    expect(describeLists(ed)).toEqual(['md-list/md=true(a|b)', 'md-list/md=true(c)'])
  })

  it('upgrades every old list in a multi-list document', () => {
    const ed = editor()
    loadOld(ed, oldDoc(oldList('a'), oldList('b', { listType: 'number', start: 3 })))
    expect(describeLists(ed)).toEqual(['md-list/md=true(a)', 'md-list/md=true(b)'])
  })

  it('carries listType, start and item state across the upgrade', () => {
    const ed = editor()
    loadOld(ed, oldDoc(oldList('one', { listType: 'number', start: 7 })))
    const facts = ed.getEditorState().read(() => {
      const list = $getRoot().getFirstChild()
      if (!$isListNode(list)) throw new Error('expected a list')
      return {
        upgraded: $isMarkdownListNode(list),
        listType: list.getListType(),
        start: list.getStart(),
        tag: list.getTag(),
      }
    })
    expect(facts).toEqual({ upgraded: true, listType: 'number', start: 7, tag: 'ol' })
  })

  it('keeps a check list checked across the upgrade', () => {
    const ed = editor()
    loadOld(ed, oldDoc(oldList('done', { listType: 'check', checked: true })))
    const facts = ed.getEditorState().read(() => {
      const list = $getRoot().getFirstChild()
      if (!$isListNode(list)) throw new Error('expected a list')
      return {
        upgraded: $isMarkdownListNode(list),
        checked: list
          .getChildren()
          .map((item) => ($isListItemNode(item) ? item.getChecked() : null)),
      }
    })
    expect(facts).toEqual({ upgraded: true, checked: [true] })
  })

  it('leaves an already-upgraded list alone (the `replaceWithKlass` guard)', () => {
    // `registerNodeTransform` binds the listener to `replaceWithKlass` too
    // (`LexicalEditor.ts:1536`), so an unguarded upgrade would replace its own
    // output on every pass and trip Lexical's infinite-transform invariant.
    const ed = editor()
    expect(() => ed.update(() => $appendBulletList('fresh'), { discrete: true })).not.toThrow()
    expect(describeLists(ed)).toEqual(['md-list/md=true(fresh)'])
  })
})
