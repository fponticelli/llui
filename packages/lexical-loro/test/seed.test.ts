/**
 * Bootstrap: seeding an empty shared document vs adopting a populated one.
 *
 * Getting this backwards is the single most destructive bug available to a
 * collaborative binding: a second peer that "seeds" a document which already
 * has content wipes everyone's work. Both orders are therefore tested
 * explicitly, including the ambiguous case where two peers boot concurrently.
 */

import { describe, expect, it } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
  type NodeKey,
} from 'lexical'
import { LoroDoc } from 'loro-crdt'
import { LLuiDecoratorNode } from '@llui/lexical'

import {
  ContainerNodeMap,
  bootstrapDocument,
  initDoc,
  LORO_TEXT_FORMATS,
  type BootstrapOutcome,
  type BootstrapTarget,
  type ElementContainer,
} from '../src/index.js'

const NODES = [HeadingNode, QuoteNode, LLuiDecoratorNode]

/** A boot-time peer: an empty editor over a doc that may or may not be empty. */
class Booting {
  readonly doc = new LoroDoc()
  readonly root: ElementContainer
  readonly editor: LexicalEditor
  readonly mapping = new ContainerNodeMap()

  constructor(peerId: bigint) {
    this.doc.setPeerId(peerId)
    this.root = initDoc(this.doc, LORO_TEXT_FORMATS)
    this.doc.commit()
    this.editor = createHeadlessEditor({
      namespace: `boot-${peerId}`,
      nodes: NODES,
      onError: (error: Error) => {
        throw error
      },
    })
  }

  target(seed: (editor: LexicalEditor) => void, shouldBootstrap = true): BootstrapTarget {
    return {
      doc: this.doc,
      root: this.root,
      mapping: this.mapping,
      editor: this.editor,
      seed,
      shouldBootstrap,
    }
  }

  text(): string[] {
    const out: string[] = []
    this.editor.getEditorState().read(() => {
      for (const child of $getRoot().getChildren()) out.push(child.getTextContent())
    })
    return out
  }

  keys(): NodeKey[] {
    const out: NodeKey[] = []
    this.editor.getEditorState().read(() => {
      for (const child of $getRoot().getChildren()) out.push(child.getKey())
    })
    return out
  }
}

const seedWith = (text: string) => (): void => {
  const root = $getRoot()
  root.clear()
  root.append($createParagraphNode().append($createTextNode(text)))
}

describe('bootstrapDocument', () => {
  it('SEEDS an empty shared document from the local default', () => {
    const peer = new Booting(1n)
    const outcome: BootstrapOutcome = bootstrapDocument(peer.target(seedWith('default')))
    expect(outcome).toBe('seeded')
    expect(peer.text()).toEqual(['default'])
    // The seed must have reached the CRDT, not just the editor.
    expect(JSON.stringify(peer.doc.toJSON())).toContain('default')
  })

  it('ADOPTS a populated shared document and never runs the seed', () => {
    const first = new Booting(1n)
    bootstrapDocument(first.target(seedWith('the real document')))

    const second = new Booting(2n)
    second.doc.import(first.doc.export({ mode: 'snapshot' }))
    let seedRan = false
    const outcome = bootstrapDocument(
      second.target(() => {
        seedRan = true
        seedWith('WOULD CLOBBER')()
      }),
    )

    expect(outcome).toBe('adopted')
    expect(seedRan).toBe(false)
    expect(second.text()).toEqual(['the real document'])
    // …and the shared document is untouched by the joining peer.
    expect(JSON.stringify(second.doc.toJSON())).not.toContain('WOULD CLOBBER')
  })

  it('is idempotent: a second call adopts rather than re-seeding', () => {
    const peer = new Booting(1n)
    expect(bootstrapDocument(peer.target(seedWith('once')))).toBe('seeded')
    const keys = peer.keys()
    expect(bootstrapDocument(peer.target(seedWith('twice')))).toBe('adopted')
    expect(peer.text()).toEqual(['once'])
    // Adoption of an unchanged document must not churn NodeKeys either.
    expect(peer.keys()).toEqual(keys)
  })

  it('declines to seed when shouldBootstrap is false, leaving the editor empty', () => {
    const peer = new Booting(1n)
    const outcome = bootstrapDocument(peer.target(seedWith('nope'), false))
    expect(outcome).toBe('waiting')
    expect(peer.text()).toEqual([])
    expect(JSON.stringify(peer.doc.toJSON())).not.toContain('nope')
  })

  it('a non-bootstrapping peer still ADOPTS a populated document', () => {
    const first = new Booting(1n)
    bootstrapDocument(first.target(seedWith('shared')))
    const second = new Booting(2n)
    second.doc.import(first.doc.export({ mode: 'snapshot' }))
    expect(bootstrapDocument(second.target(seedWith('nope'), false))).toBe('adopted')
    expect(second.text()).toEqual(['shared'])
  })

  it('two peers that seed concurrently still CONVERGE (both keep both blocks)', () => {
    // Nothing can decide who wins without a coordinator, so the requirement is
    // convergence, not deduplication — `initDoc`'s `ensureMergeable*` containers
    // are what stop one peer's whole document from being LWW-dropped here.
    const a = new Booting(1n)
    const b = new Booting(2n)
    expect(bootstrapDocument(a.target(seedWith('from a')))).toBe('seeded')
    expect(bootstrapDocument(b.target(seedWith('from b')))).toBe('seeded')

    a.doc.import(b.doc.export({ mode: 'update' }))
    b.doc.import(a.doc.export({ mode: 'update' }))

    expect(JSON.stringify(a.doc.toJSON())).toBe(JSON.stringify(b.doc.toJSON()))
    const merged = JSON.stringify(a.doc.toJSON())
    expect(merged).toContain('from a')
    expect(merged).toContain('from b')
  })
})
