/**
 * The carrier schema: container shape, construction, accessors and liveness.
 *
 * The ordering ALGORITHM is specified by `test/order.test.ts`; what this file
 * pins is the schema's side of it — that a child is a carrier map, that
 * `orderedChildren` is a pure projection of replicated state, and that the
 * container identities the mapping registry addresses survive a move.
 */

import { describe, expect, it } from 'vitest'
import { LoroDoc, LoroMap, LoroText } from 'loro-crdt'

import {
  childCount,
  containerId,
  containerIsLive,
  createElementChild,
  createTextChild,
  DECORATOR_TYPE,
  elementChildren,
  elementProps,
  elementType,
  initDoc,
  isDecoratorElement,
  isElementContainer,
  isTextContainer,
  KEY_BRIDGE_TYPE,
  KEY_DATA,
  KEY_KIND,
  KEY_POS,
  KEY_UUID,
  LORO_TEXT_FORMATS,
  newUuid,
  orderedChildren,
  ROOT_CONTAINER,
  TEXT_MARK_EXPAND,
  type ElementContainer,
} from '../src/index.js'
import {
  appendElement,
  appendText,
  childAt,
  childContainers,
  childTypes,
  moveChild,
  removeChildAt,
} from './children.js'

const freshDoc = (): { doc: LoroDoc; root: ElementContainer } => {
  const doc = new LoroDoc()
  doc.setPeerId(1n)
  const root = initDoc(doc, LORO_TEXT_FORMATS)
  return { doc, root }
}

describe('index units', () => {
  // The whole binding assumes Loro text offsets are the same unit as Lexical
  // offsets. loro-crdt's declarations do not state this, so pin it: an astral
  // character must count as TWO positions, like a JavaScript string index.
  it('addresses LoroText in UTF-16 code units, matching Lexical offsets', () => {
    const doc = new LoroDoc()
    const text = doc.getText('t')
    text.insert(0, '😀ab')
    expect(text.length).toBe('😀ab'.length)

    // UTF-16 index 3 sits between 'a' and 'b'; a unicode index 3 would be after 'b'.
    text.insert(3, 'Z')
    expect(text.toString()).toBe('😀aZb')
  })

  it('marks by UTF-16 offsets too', () => {
    const doc = new LoroDoc()
    doc.configTextStyle({ bold: { expand: TEXT_MARK_EXPAND } })
    const text = doc.getText('t')
    text.insert(0, '😀ab')
    // Bold exactly the emoji: offsets 0..2 in UTF-16.
    text.mark({ start: 0, end: 2 }, 'bold', true)
    doc.commit()
    const delta = text.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]
    expect(delta[0]?.insert).toBe('😀')
    expect(delta[0]?.attributes?.bold).toBe(true)
    expect(delta[1]?.insert).toBe('ab')
  })
})

describe('initDoc', () => {
  it('returns the root element container under the well-known name', () => {
    const { doc, root } = freshDoc()
    expect(root.id).toBe(doc.getMap(ROOT_CONTAINER).id)
  })

  it('configures every known format with the uniform expand rule', () => {
    // configTextStyle is write-only, so assert it took effect behaviourally:
    // under expand='after' a local insert at a mark's end boundary joins it.
    for (const format of LORO_TEXT_FORMATS) {
      const doc = new LoroDoc()
      initDoc(doc, LORO_TEXT_FORMATS)
      const text = doc.getText('t')
      text.insert(0, 'abc')
      text.mark({ start: 0, end: 3 }, format, true)
      text.insert(3, 'X')
      doc.commit()
      const delta = text.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]
      expect(delta).toHaveLength(1)
      expect(delta[0]?.insert).toBe('abcX')
      expect(delta[0]?.attributes?.[format]).toBe(true)
    }
  })

  it('writes nothing on a second call, so a rebind emits no spurious update', () => {
    const { doc, root } = freshDoc()
    appendElement(root, 'paragraph')
    doc.commit()
    const before = doc.version()

    initDoc(doc, LORO_TEXT_FORMATS)
    doc.commit()

    expect(doc.version().compare(before)).toBe(0)
  })
})

describe('concurrent initialization', () => {
  // Two peers can each open an empty document before hearing from the other. If
  // the root's children map were created with a plain setContainer, each would
  // mint a DIFFERENT container and the map slot's last-writer-wins would discard
  // one peer's entire document. ensureMergeable* makes both land on the same id.
  it('two peers initializing independently converge on one children map', () => {
    const a = new LoroDoc()
    a.setPeerId(1n)
    const rootA = initDoc(a, LORO_TEXT_FORMATS)
    const b = new LoroDoc()
    b.setPeerId(2n)
    const rootB = initDoc(b, LORO_TEXT_FORMATS)

    expect(elementChildren(rootA).id).toBe(elementChildren(rootB).id)

    // Each peer adds a block while still isolated, then they sync.
    appendElement(rootA, 'paragraph')
    a.commit()
    appendElement(rootB, 'heading')
    b.commit()
    a.import(b.export({ mode: 'update' }))
    b.import(a.export({ mode: 'update' }))

    // Neither peer's block was lost, and both agree on the order.
    const typesA = childTypes(rootA)
    const typesB = childTypes(rootB)
    expect(typesA).toEqual(typesB)
    expect([...typesA].sort()).toEqual(['heading', 'paragraph'])
  })
})

describe('createElementChild', () => {
  it('creates the carrier keys and the element keys on ONE map', () => {
    const { root } = freshDoc()
    const uuid = newUuid()
    const element = createElementChild(elementChildren(root), uuid, 'm', 'paragraph')

    // The carrier IS the element container — no extra indirection.
    expect(element.get(KEY_UUID)).toBe(uuid)
    expect(element.get(KEY_POS)).toBe('m')
    expect(element.get(KEY_KIND)).toBe('element')
    expect(elementType(element)).toBe('paragraph')
    expect(elementProps(element)).toBeInstanceOf(LoroMap)
    expect(childCount(element)).toBe(0)
  })

  it('returns an ATTACHED handle, so its ContainerID is usable immediately', () => {
    const { root } = freshDoc()
    const element = createElementChild(elementChildren(root), newUuid(), 'm', 'paragraph')
    expect(element.isAttached()).toBe(true)
    expect(containerId(element)).toMatch(/^cid:/)
  })

  it('files the carrier in the children map under its own uuid', () => {
    const { root } = freshDoc()
    const uuid = newUuid()
    createElementChild(elementChildren(root), uuid, 'm', 'paragraph')
    expect(elementChildren(root).keys()).toEqual([uuid])
  })
})

describe('createTextChild', () => {
  it('returns the carrier’s attached LoroText', () => {
    const { root } = freshDoc()
    const uuid = newUuid()
    const text = createTextChild(elementChildren(root), uuid, 'm')

    expect(text).toBeInstanceOf(LoroText)
    expect(text.isAttached()).toBe(true)

    const carrier = elementChildren(root).get(uuid)
    expect(carrier).toBeInstanceOf(LoroMap)
    expect((carrier as LoroMap).get(KEY_KIND)).toBe('text')
  })

  it('exposes the text run as a child of its parent element', () => {
    const { root } = freshDoc()
    const paragraph = appendElement(root, 'paragraph')
    const text = appendText(paragraph)
    text.insert(0, 'hello')

    expect(childCount(paragraph)).toBe(1)
    expect(childAt(paragraph, 0)).toBeInstanceOf(LoroText)
    expect((childAt(paragraph, 0) as LoroText).toString()).toBe('hello')
  })
})

describe('orderedChildren', () => {
  it('renders by (pos, uuid), not by insertion or map-key order', () => {
    const { root } = freshDoc()
    const children = elementChildren(root)
    // Insert out of order; the uuids are chosen to sort OPPOSITE to the pos.
    createElementChild(children, 'ccc', 'z', 'quote')
    createElementChild(children, 'bbb', 'm', 'heading')
    createElementChild(children, 'aaa', 'a', 'paragraph')

    expect(childTypes(root)).toEqual(['paragraph', 'heading', 'quote'])
  })

  it('breaks a pos tie by uuid, so every peer renders the same sequence', () => {
    const { root } = freshDoc()
    const children = elementChildren(root)
    createElementChild(children, 'zzz', 'm', 'quote')
    createElementChild(children, 'aaa', 'm', 'paragraph')

    expect(childTypes(root)).toEqual(['paragraph', 'quote'])
  })

  it('SKIPS a carrier whose keys have not fully landed rather than throwing', () => {
    // A remote update can be applied while a carrier is still materializing.
    // A half-built child must not crash a render; it appears on the next event.
    const { root } = freshDoc()
    const children = elementChildren(root)
    appendElement(root, 'paragraph')

    // No 'pos' yet.
    const noPos = children.setContainer(newUuid(), new LoroMap())
    noPos.set(KEY_KIND, 'element')
    // 'pos' but no 'kind'.
    const noKind = children.setContainer(newUuid(), new LoroMap())
    noKind.set(KEY_POS, 'z')
    // An element carrier whose 'type' has not arrived.
    const noType = children.setContainer(newUuid(), new LoroMap())
    noType.set(KEY_POS, 'z')
    noType.set(KEY_KIND, 'element')
    // A text carrier whose LoroText has not arrived.
    const noText = children.setContainer(newUuid(), new LoroMap())
    noText.set(KEY_POS, 'z')
    noText.set(KEY_KIND, 'text')

    expect(childTypes(root)).toEqual(['paragraph'])
  })

  it('is a pure function of replicated state — it never consults isDeleted()', () => {
    // A deleted carrier is simply absent from keys() on every peer. Nothing here
    // may branch on local liveness, or two peers could project differently.
    const { root } = freshDoc()
    appendElement(root, 'paragraph')
    const heading = appendElement(root, 'heading')
    appendElement(root, 'quote')

    removeChildAt(root, 1)

    expect(childTypes(root)).toEqual(['paragraph', 'quote'])
    expect(heading.isDeleted()).toBe(true)
  })
})

describe('accessors', () => {
  it('read type, props and children off an attached element', () => {
    const { root } = freshDoc()
    const paragraph = appendElement(root, 'paragraph')
    elementProps(paragraph).set('textFormat', 0)

    expect(elementType(paragraph)).toBe('paragraph')
    expect(elementProps(paragraph).get('textFormat')).toBe(0)
    expect(childCount(paragraph)).toBe(0)
    expect(elementType(root)).toBe('root')
  })

  it('throws a located error when a required key is missing', () => {
    const doc = new LoroDoc()
    doc.setPeerId(1n)
    const broken = doc.getMap('broken') as ElementContainer
    expect(() => elementType(broken)).toThrow(/has no 'type' string/)
    expect(() => elementProps(broken)).toThrow(/has no 'props' map/)
    expect(() => elementChildren(broken)).toThrow(/has no 'children' map/)
  })

  it('narrows child containers by kind', () => {
    const { root } = freshDoc()
    const paragraph = appendElement(root, 'paragraph')
    const text = appendText(paragraph)
    const nested = appendElement(paragraph, 'link')

    expect(isTextContainer(text)).toBe(true)
    expect(isElementContainer(text)).toBe(false)
    expect(isElementContainer(nested)).toBe(true)
    expect(isTextContainer(nested)).toBe(false)
  })

  it('recognises a decorator element by its type', () => {
    const { root } = freshDoc()
    const decorator = appendElement(root, DECORATOR_TYPE)
    elementProps(decorator).set(KEY_BRIDGE_TYPE, 'chart')
    elementProps(decorator).set(KEY_DATA, '{"series":[]}')

    expect(isDecoratorElement(decorator)).toBe(true)
    expect(isDecoratorElement(appendElement(root, 'paragraph'))).toBe(false)
    expect(elementProps(decorator).get(KEY_BRIDGE_TYPE)).toBe('chart')
  })
})

describe('containerId', () => {
  it('returns the stable id of an attached container', () => {
    const { root } = freshDoc()
    const paragraph = appendElement(root, 'paragraph')
    expect(containerId(paragraph)).toBe(paragraph.id)
    expect(containerId(paragraph)).toMatch(/^cid:/)
  })

  it('REFUSES a detached container rather than minting a meaningless address', () => {
    // A detached container has no replicated identity; letting one into the
    // mapping is how you get an entry that never matches a remote event.
    expect(() => containerId(new LoroMap())).toThrow(/DETACHED/)
    expect(() => containerId(new LoroText())).toThrow(/DETACHED/)
  })
})

describe('containerIsLive', () => {
  it('reports a deleted container as dead even though the handle still reads', () => {
    const { doc, root } = freshDoc()
    const paragraph = appendElement(root, 'paragraph')
    const text = appendText(paragraph)
    const elementId = containerId(paragraph)
    const textId = containerId(text)
    doc.commit()

    expect(containerIsLive(doc, elementId)).toBe(true)
    expect(containerIsLive(doc, textId)).toBe(true)

    removeChildAt(root, 0)
    doc.commit()

    // getContainerById still hands back a usable handle — isDeleted() is the
    // only real test, and it must see the whole subtree, not just the root.
    expect(containerIsLive(doc, elementId)).toBe(false)
    expect(containerIsLive(doc, textId)).toBe(false)
  })
})

describe('a same-parent move preserves container identity', () => {
  // This is the reason the schema orders by a `pos` register instead of by list
  // position. If a move minted a new ContainerID, the moved subtree would be
  // rebuilt with fresh NodeKeys and any LLuiDecoratorNode inside it would be
  // disposed and remounted on every drag.
  it('keeps every ContainerID stable when a child moves', () => {
    const { doc, root } = freshDoc()
    const first = appendElement(root, 'paragraph')
    const second = appendElement(root, 'heading')
    const third = appendElement(root, 'quote')
    const nested = appendText(third)
    doc.commit()

    const ids = [first.id, second.id, third.id]
    const nestedId = nested.id

    moveChild(root, 2, 0)
    doc.commit()

    expect(childTypes(root)).toEqual(['quote', 'paragraph', 'heading'])
    // Same containers, new order — no id was recycled, and the moved subtree
    // was not touched at all.
    expect(childContainers(root).map((child) => (child as ElementContainer).id)).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ])
    expect(nested.id).toBe(nestedId)
    expect(containerIsLive(doc, nestedId)).toBe(true)
  })

  it('costs ONE register write, whatever the subtree weighs', () => {
    const { doc, root } = freshDoc()
    appendElement(root, 'paragraph')
    const heavy = appendElement(root, 'quote')
    for (let i = 0; i < 50; i++) appendText(appendElement(heavy, 'paragraph'))
    doc.commit()

    const beforeMove = doc.oplogVersion()
    moveChild(root, 1, 0)
    doc.commit()
    const move = doc.export({ mode: 'update', from: beforeMove })

    expect(childTypes(root)).toEqual(['quote', 'paragraph'])
    // The move on the wire is bounded by the pos key, NOT by the 101 containers
    // underneath it — that ratio is the whole point of ordering by a register.
    expect(move.byteLength).toBeLessThan(200)
    expect(move.byteLength * 20).toBeLessThan(doc.export({ mode: 'snapshot' }).byteLength)
  })

  it('survives a peer editing INTO the moved subtree concurrently', () => {
    // The property the whole design exists for: because nothing is deleted or
    // recreated, a concurrent edit inside the moved block is not lost.
    const a = new LoroDoc()
    a.setPeerId(1n)
    const rootA = initDoc(a, LORO_TEXT_FORMATS)
    appendElement(rootA, 'paragraph')
    const quote = appendElement(rootA, 'quote')
    const text = appendText(quote)
    text.insert(0, 'hello')
    a.commit()

    const b = new LoroDoc()
    b.setPeerId(2n)
    const rootB = initDoc(b, LORO_TEXT_FORMATS)
    b.import(a.export({ mode: 'snapshot' }))

    // A moves the quote to the front; B types into it, each unaware.
    moveChild(rootA, 1, 0)
    a.commit()
    const remote = b.getContainerById(text.id) as LoroText
    remote.insert(5, ' world')
    b.commit()

    a.import(b.export({ mode: 'update' }))
    b.import(a.export({ mode: 'update' }))

    for (const root of [rootA, rootB]) {
      expect(childTypes(root)).toEqual(['quote', 'paragraph'])
      const moved = childAt(root, 0) as ElementContainer
      expect((childAt(moved, 0) as LoroText).toString()).toBe('hello world')
    }
  })
})
