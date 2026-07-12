import { describe, it, expect, afterEach } from 'vitest'
import { registerRichText } from '@lexical/rich-text'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  createEditor,
  UNDO_COMMAND,
  type LexicalEditor,
} from 'lexical'
import { Doc as YDoc } from 'yjs'
import { yjsCollab } from '../src/index.js'
import { TestHub, TestProvider, flush } from './network.js'

afterEach(() => {
  document.body.innerHTML = ''
})

/** A real (non-headless) editor attached to a contentEditable host, so the
 * collab binding's cursor sync has a root element to position against. */
function makeEditor(): LexicalEditor {
  const host = document.createElement('div')
  host.contentEditable = 'true'
  document.body.appendChild(host)
  const editor = createEditor({
    namespace: 'collab-test',
    onError: (err) => {
      throw err
    },
  })
  editor.setRootElement(host)
  registerRichText(editor)
  return editor
}

function readText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent())
}

function setParagraph(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode(text)))
    },
    { discrete: true },
  )
}

function appendParagraph(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createTextNode(text)))
    },
    { discrete: true },
  )
}

/** Wire a peer: DOM editor + rich-text + collab binding over the hub. */
function peer(
  hub: TestHub,
  opts: { id: string; shouldBootstrap?: boolean; seed?: (e: LexicalEditor) => void; name?: string },
): { editor: LexicalEditor; doc: YDoc; provider: TestProvider; dispose: () => void } {
  const editor = makeEditor()
  const doc = new YDoc()
  const provider = new TestProvider(doc, hub)
  const collab = yjsCollab({
    id: opts.id,
    doc,
    provider,
    shouldBootstrap: opts.shouldBootstrap ?? false,
    seed: opts.seed,
    user: opts.name ? { name: opts.name, color: '#f00' } : undefined,
  })
  const dispose = collab.register(editor)
  return { editor, doc, provider, dispose }
}

const seedText = (text: string) => (): void => {
  $getRoot().append($createParagraphNode().append($createTextNode(text)))
}

describe('yjsCollab — convergence', () => {
  it('the bootstrapping peer seeds and a joining peer adopts it', async () => {
    const hub = new TestHub()
    const a = peer(hub, { id: 'room', shouldBootstrap: true, seed: seedText('hello') })
    await flush()
    expect(readText(a.editor)).toBe('hello')

    const b = peer(hub, { id: 'room', shouldBootstrap: false })
    await flush()
    // B adopted the shared document via sync (it did not bootstrap).
    expect(readText(b.editor)).toBe('hello')

    a.dispose()
    b.dispose()
  })

  it('edits on one peer propagate to the other', async () => {
    const hub = new TestHub()
    const a = peer(hub, { id: 'room', shouldBootstrap: true, seed: seedText('start') })
    const b = peer(hub, { id: 'room' })
    await flush()
    expect(readText(b.editor)).toBe('start')

    setParagraph(a.editor, 'edited by A')
    await flush()
    expect(readText(b.editor)).toBe('edited by A')

    setParagraph(b.editor, 'and back by B')
    await flush()
    expect(readText(a.editor)).toBe('and back by B')

    a.dispose()
    b.dispose()
  })

  it('only the designated peer seeds — no duplication when both could', async () => {
    const hub = new TestHub()
    const a = peer(hub, { id: 'room', shouldBootstrap: true, seed: seedText('once') })
    await flush()
    // Second peer ALSO has shouldBootstrap but the shared doc is no longer empty.
    const b = peer(hub, { id: 'room', shouldBootstrap: true, seed: seedText('once') })
    await flush()
    expect(readText(a.editor)).toBe('once')
    expect(readText(b.editor)).toBe('once')

    a.dispose()
    b.dispose()
  })
})

describe('yjsCollab — scoped undo', () => {
  it('a peer undo reverts only its own edit, not the remote peer’s', async () => {
    const hub = new TestHub()
    const a = peer(hub, { id: 'room', shouldBootstrap: true, seed: seedText('base') })
    const b = peer(hub, { id: 'room' })
    await flush()

    appendParagraph(a.editor, 'A-edit')
    await flush()
    appendParagraph(b.editor, 'B-edit')
    await flush()
    expect(readText(a.editor)).toContain('A-edit')
    expect(readText(a.editor)).toContain('B-edit')

    // A undoes — only A's contribution disappears; B's survives on both peers.
    a.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await flush()
    expect(readText(a.editor)).not.toContain('A-edit')
    expect(readText(a.editor)).toContain('B-edit')
    expect(readText(b.editor)).not.toContain('A-edit')
    expect(readText(b.editor)).toContain('B-edit')

    a.dispose()
    b.dispose()
  })

  it('drives CAN_UNDO after a local edit', async () => {
    const hub = new TestHub()
    const a = peer(hub, { id: 'room', shouldBootstrap: true, seed: seedText('') })
    let canUndo = false
    a.editor.registerCommand(
      CAN_UNDO_COMMAND,
      (payload: boolean) => {
        canUndo = payload
        return false
      },
      COMMAND_PRIORITY_LOW,
    )
    await flush()
    setParagraph(a.editor, 'typed')
    await flush()
    expect(canUndo).toBe(true)
    a.dispose()
  })
})

describe('yjsCollab — presence', () => {
  it('reports remote peers via onPeers as they join and leave', async () => {
    const hub = new TestHub()
    let aPeers = -1
    const editorA = makeEditor()
    const docA = new YDoc()
    const providerA = new TestProvider(docA, hub)
    const collabA = yjsCollab({
      id: 'room',
      doc: docA,
      provider: providerA,
      shouldBootstrap: true,
      user: { name: 'Ada', color: '#0a0' },
      onPeers: (n) => {
        aPeers = n
      },
    })
    const disposeA = collabA.register(editorA)
    await flush()

    const b = peer(hub, { id: 'room', name: 'Babbage' })
    await flush()
    expect(aPeers).toBe(1)

    b.dispose()
    await flush()
    expect(aPeers).toBe(0)

    disposeA()
  })
})

describe('yjsCollab — already-synced bootstrap', () => {
  it('seeds immediately when the provider is already synced at register time', async () => {
    const hub = new TestHub()
    const editor = makeEditor()
    const doc = new YDoc()
    const provider = new TestProvider(doc, hub)
    // The provider completes its handshake BEFORE register wires the sync
    // listener, so 'sync' will never fire again — the old gate would leave the
    // empty shared doc un-seeded.
    provider.connect()
    expect(provider.synced).toBe(true)

    const collab = yjsCollab({
      id: 'room',
      doc,
      provider,
      shouldBootstrap: true,
      seed: seedText('ready'),
    })
    const dispose = collab.register(editor)
    await flush()
    expect(readText(editor)).toBe('ready')
    dispose()
  })
})

describe('yjsCollab — document ownership', () => {
  it('destroys an internally-created doc and drops it from the docMap', () => {
    const hub = new TestHub()
    const docMap = new Map<string, YDoc>()
    const collab = yjsCollab({
      id: 'owned',
      docMap,
      providerFactory: (id, dm) => new TestProvider(dm.get(id)!, hub),
    })
    // yjsCollab created the doc and registered it.
    expect(docMap.get('owned')).toBe(collab.doc)
    let destroyed = false
    collab.doc.on('destroy', () => {
      destroyed = true
    })

    const dispose = collab.register(makeEditor())
    dispose()
    collab.destroy()

    expect(destroyed).toBe(true)
    expect(docMap.has('owned')).toBe(false)
  })

  it('leaves a caller-supplied doc untouched on destroy', () => {
    const hub = new TestHub()
    const doc = new YDoc()
    const docMap = new Map<string, YDoc>([['given', doc]])
    const collab = yjsCollab({
      id: 'given',
      doc,
      docMap,
      provider: new TestProvider(doc, hub),
    })
    let destroyed = false
    doc.on('destroy', () => {
      destroyed = true
    })

    const dispose = collab.register(makeEditor())
    dispose()
    collab.destroy()

    expect(destroyed).toBe(false)
    expect(docMap.get('given')).toBe(doc)
  })
})

describe('yjsCollab — config guards', () => {
  it('rejects both provider and providerFactory', () => {
    const doc = new YDoc()
    const hub = new TestHub()
    expect(() =>
      yjsCollab({
        id: 'x',
        doc,
        provider: new TestProvider(doc, hub),
        providerFactory: () => new TestProvider(doc, hub),
      }),
    ).toThrow(/not both/)
  })

  it('requires a provider or factory', () => {
    expect(() => yjsCollab({ id: 'x' })).toThrow(/required/)
  })
})
