// Mechanism-pinning tests for the `nodeWidget` seam.
//
// These assert the EXACT Lexical reconciler behaviours the seam is built on, so
// an upgrade that moves one fails loudly here rather than silently dropping
// widgets in a running app. Verified against lexical 0.48.0 — bump this comment
// (and re-verify the citations in `src/nodewidget.ts`) when the peer range moves.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp } from '@llui/dom'
import {
  $getRoot,
  $getNodeByKey,
  $createParagraphNode,
  $createTextNode,
  createEditor,
  type LexicalEditor,
  type NodeKey,
  ParagraphNode,
  TextNode,
} from 'lexical'
import {
  createWidgetRuntime,
  nodeWidget,
  isNodeWidgetHost,
  WIDGET_ATTR,
  WIDGET_CLASS,
  type NodeWidget,
} from '../src/nodewidget.js'
import { lexicalForeign } from '../src/foreign.js'

const LEXICAL_VERSION = '0.48.0'

interface Harness {
  editor: LexicalEditor
  root: HTMLElement
  dispose: () => void
}

/** A bare editor wired to a jsdom root with the widget render config. Every
 * `editor.update` uses `{ discrete: true }` so the reconcile — and therefore
 * `$decorateDOM` — runs SYNCHRONOUSLY, which is the whole point of the seam. */
function makeEditor(widgets: readonly NodeWidget[]): Harness {
  const runtime = createWidgetRuntime(widgets)
  const root = document.createElement('div')
  root.contentEditable = 'true'
  document.body.appendChild(root)
  const editor = createEditor({
    namespace: `nw-${Math.random().toString(36).slice(2)}`,
    onError: (e) => {
      throw e
    },
    dom: runtime.domConfig,
  })
  const disposeWidgets = runtime.attach(editor)
  editor.setRootElement(root)
  return {
    editor,
    root,
    dispose: () => {
      editor.setRootElement(null)
      disposeWidgets()
      root.remove()
    },
  }
}

const widgetHosts = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`[${WIDGET_ATTR}]`))

let harness: Harness | null = null
afterEach(() => {
  harness?.dispose()
  harness = null
  document.body.innerHTML = ''
})

describe(`nodeWidget (lexical ${LEXICAL_VERSION})`, () => {
  it('attaches a tail widget on create and detaches when source goes null', () => {
    const disposed: string[] = []
    let renders = 0
    const widget = nodeWidget<TextNode, string>({
      id: 'w',
      klass: TextNode,
      source: ({ node }) => (node.hasFormat('code') ? node.getTextContent() : null),
      render: (host, text) => {
        renders++
        host.textContent = ` = ${text}`
      },
      dispose: (_host, { key }) => disposed.push(key),
    })
    harness = makeEditor([widget])
    const { editor, root } = harness

    let key: NodeKey = ''
    editor.update(
      () => {
        const p = $createParagraphNode()
        const t = $createTextNode('1+2')
        t.setFormat('code')
        key = t.getKey()
        p.append(t)
        $getRoot().clear().append(p)
      },
      { discrete: true },
    )

    const hosts = widgetHosts(root)
    expect(hosts).toHaveLength(1)
    expect(hosts[0]!.getAttribute(WIDGET_ATTR)).toBe('w')
    expect(hosts[0]!.classList.contains(WIDGET_CLASS)).toBe(true)
    expect(hosts[0]!.contentEditable).toBe('false')
    expect(hosts[0]!.textContent).toBe(' = 1+2')
    expect(isNodeWidgetHost(hosts[0]!)).toBe(true)
    expect(renders).toBe(1)

    // Remove the code format → source null → widget detached + disposed.
    editor.update(
      () => {
        ;($getNodeByKey(key) as TextNode).setFormat(0)
      },
      { discrete: true },
    )
    expect(widgetHosts(root)).toHaveLength(0)
    expect(disposed).toEqual([key])
  })

  it('re-renders only when source changes across a text reconcile, keeping the same host', () => {
    let renders = 0
    const widget = nodeWidget<TextNode, string>({
      id: 'w',
      klass: TextNode,
      source: ({ node }) => node.getTextContent(),
      render: (host, text) => {
        renders++
        host.textContent = `[${text}]`
      },
    })
    harness = makeEditor([widget])
    const { editor, root } = harness

    let key: NodeKey = ''
    editor.update(
      () => {
        const p = $createParagraphNode()
        const t = $createTextNode('a')
        key = t.getKey()
        p.append(t)
        $getRoot().clear().append(p)
      },
      { discrete: true },
    )
    const host1 = widgetHosts(root)[0]!
    expect(renders).toBe(1)

    // A reconcile that does NOT change the source (dirty the paragraph, same text).
    editor.update(
      () => {
        ;($getNodeByKey(key) as TextNode).getParentOrThrow().markDirty()
      },
      { discrete: true },
    )
    expect(widgetHosts(root)[0]).toBe(host1)
    expect(renders).toBe(1) // gated by equals

    // A reconcile that DOES change the source: same host element, one more render.
    editor.update(
      () => {
        ;($getNodeByKey(key) as TextNode).setTextContent('ab')
      },
      { discrete: true },
    )
    expect(widgetHosts(root)[0]).toBe(host1)
    expect(host1.textContent).toBe('[ab]')
    expect(renders).toBe(2)
  })

  it('survives an OUTER-TAG change (SPAN→STRONG) synchronously in the same commit', () => {
    let renders = 0
    const widget = nodeWidget<TextNode, string>({
      id: 'w',
      klass: TextNode,
      source: ({ node }) => node.getTextContent(),
      render: (host, text) => {
        renders++
        host.textContent = `<${text}>`
      },
    })
    harness = makeEditor([widget])
    const { editor, root } = harness

    let key: NodeKey = ''
    editor.update(
      () => {
        const p = $createParagraphNode()
        const t = $createTextNode('x')
        key = t.getKey()
        p.append(t)
        $getRoot().clear().append(p)
      },
      { discrete: true },
    )
    const hostBefore = editor.getElementByKey(key)!
    expect(hostBefore.tagName).toBe('SPAN')
    const widgetEl = widgetHosts(root)[0]!
    expect(widgetEl.textContent).toBe('<x>')

    // Bold flips the element SPAN→STRONG: TextNode.updateDOM returns true, so the
    // reconciler REPLACES the element via $createNode (which re-runs $decorateDOM
    // at LexicalReconciler.ts:818). No await: the assertion runs immediately after
    // the synchronous commit.
    editor.update(
      () => {
        ;($getNodeByKey(key) as TextNode).setFormat('bold')
      },
      { discrete: true },
    )
    const hostAfter = editor.getElementByKey(key)!
    expect(hostAfter.tagName).toBe('STRONG')
    expect(hostAfter).not.toBe(hostBefore) // element WAS replaced

    // The SAME widget element survived, re-parented onto the new host, and was
    // NOT re-rendered (source unchanged) — so its internal DOM/state persists.
    const hosts = widgetHosts(root)
    expect(hosts).toHaveLength(1)
    expect(hosts[0]).toBe(widgetEl)
    expect(hosts[0]!.parentElement).toBe(hostAfter)
    expect(renders).toBe(1)
    expect(root.contains(widgetEl)).toBe(true)
  })

  it('defeats the textContent="" empty-out fast path via the declared slot boundary', () => {
    // A block (paragraph) host with a tail widget. Deleting every managed child
    // takes it N→0, which without a boundary hits `dom.textContent = ''` and wipes
    // the widget. The $getDOMSlot override sets slot.before, defeating the fast path.
    const widget = nodeWidget<ParagraphNode, number>({
      id: 'blk',
      klass: ParagraphNode,
      tag: 'div',
      source: ({ node }) => node.getChildrenSize(),
      render: (host, size) => {
        host.textContent = `n=${size}`
      },
    })
    harness = makeEditor([widget])
    const { editor, root } = harness

    let pKey: NodeKey = ''
    let tKey: NodeKey = ''
    editor.update(
      () => {
        const p = $createParagraphNode()
        const t = $createTextNode('hello')
        pKey = p.getKey()
        tKey = t.getKey()
        p.append(t)
        $getRoot().clear().append(p)
      },
      { discrete: true },
    )
    const widgetEl = widgetHosts(root)[0]!
    expect(widgetEl.parentElement).toBe(editor.getElementByKey(pKey))

    editor.update(
      () => {
        $getNodeByKey(tKey)!.remove()
      },
      { discrete: true },
    )
    // The paragraph is now empty, but the widget host survived the N→0 transition.
    const pDom = editor.getElementByKey(pKey)!
    const hosts = widgetHosts(root)
    expect(hosts).toHaveLength(1)
    expect(hosts[0]).toBe(widgetEl)
    expect(widgetEl.parentElement).toBe(pDom)
    expect(widgetEl.textContent).toBe('n=0')
  })

  it('does not skew resolveChildIndex (caret placement) with a tail widget', () => {
    const widget = nodeWidget<ParagraphNode, boolean>({
      id: 'blk',
      klass: ParagraphNode,
      tag: 'div',
      source: () => true,
      render: (host) => {
        host.textContent = 'W'
      },
    })
    harness = makeEditor([widget])
    const { editor, root } = harness

    let pKey: NodeKey = ''
    editor.update(
      () => {
        const p = $createParagraphNode()
        pKey = p.getKey()
        // Distinct formats so normalization does NOT merge them (two managed
        // children), then the tail widget makes three raw DOM children.
        const a = $createTextNode('a')
        const b = $createTextNode('b')
        b.setFormat('bold')
        p.append(a, b)
        $getRoot().clear().append(p)
      },
      { discrete: true },
    )
    const pDom = editor.getElementByKey(pKey)!
    // Raw DOM has 3 element children: <span>a</span><strong>b</strong><widget>.
    expect(pDom.childNodes.length).toBe(3)
    expect(isNodeWidgetHost(pDom.lastChild as Node)).toBe(true)

    editor.getEditorState().read(
      () => {
        const p = $getNodeByKey(pKey) as ParagraphNode
        const slot = p.getDOMSlot(pDom)
        // A DOM offset past every managed child must still map to child index 2
        // (the lexical children count), NOT 3 — the tail widget is not counted.
        const [, idx] = slot.resolveChildIndex(p, pDom, pDom, pDom.childNodes.length)
        expect(idx).toBe(2)
      },
      { editor },
    )
  })

  it('never mutates the document (widget text is not in the serialized content)', () => {
    const widget = nodeWidget<TextNode, string>({
      id: 'w',
      klass: TextNode,
      source: ({ node }) => (node.hasFormat('code') ? node.getTextContent() : null),
      render: (host, text) => {
        host.textContent = ` RESULT(${text})`
      },
    })
    harness = makeEditor([widget])
    const { editor, root } = harness

    editor.update(
      () => {
        const p = $createParagraphNode()
        const t = $createTextNode('1+2')
        t.setFormat('code')
        p.append(t)
        $getRoot().clear().append(p)
      },
      { discrete: true },
    )
    expect(widgetHosts(root)[0]!.textContent).toContain('RESULT')

    const { text, nodeCount } = editor.getEditorState().read(() => ({
      text: $getRoot().getTextContent(),
      nodeCount: $getRoot().getAllTextNodes().length,
    }))
    expect(text).toBe('1+2') // NOT '1+2 RESULT(1+2)'
    expect(text).not.toContain('RESULT')
    expect(nodeCount).toBe(1) // no widget node was inserted into the document
  })

  it('supports a head and a tail widget on the same node (record keyed by id)', () => {
    const head = nodeWidget<ParagraphNode, boolean>({
      id: 'head',
      klass: ParagraphNode,
      tag: 'span',
      placement: 'head',
      source: () => true,
      render: (h) => {
        h.textContent = 'H'
      },
    })
    const tail = nodeWidget<ParagraphNode, boolean>({
      id: 'tail',
      klass: ParagraphNode,
      tag: 'span',
      placement: 'tail',
      source: () => true,
      render: (h) => {
        h.textContent = 'T'
      },
    })
    harness = makeEditor([head, tail])
    const { editor, root } = harness

    let pKey: NodeKey = ''
    editor.update(
      () => {
        const p = $createParagraphNode()
        pKey = p.getKey()
        p.append($createTextNode('mid'))
        $getRoot().clear().append(p)
      },
      { discrete: true },
    )
    const pDom = editor.getElementByKey(pKey)!
    const kids = Array.from(pDom.children) as HTMLElement[]
    expect(kids).toHaveLength(3)
    expect(kids[0]!.getAttribute(WIDGET_ATTR)).toBe('head')
    expect(kids[0]!.textContent).toBe('H')
    expect(kids[2]!.getAttribute(WIDGET_ATTR)).toBe('tail')
    expect(kids[2]!.textContent).toBe('T')
    expect(kids[1]!.textContent).toBe('mid') // managed child is between the boundaries
  })

  it('decorateHost styles the host node in the same pass and survives a replacement', () => {
    const widget = nodeWidget<TextNode, string>({
      id: 'w',
      klass: TextNode,
      source: ({ node }) => (node.getTextContent().length > 0 ? node.getTextContent() : null),
      render: (host, text) => {
        host.textContent = `=${text}`
      },
      decorateHost: (dom, source) => {
        dom.classList.toggle('has-formula', source !== null)
      },
    })
    harness = makeEditor([widget])
    const { editor } = harness

    let key: NodeKey = ''
    editor.update(
      () => {
        const p = $createParagraphNode()
        const t = $createTextNode('z')
        key = t.getKey()
        p.append(t)
        $getRoot().clear().append(p)
      },
      { discrete: true },
    )
    expect(editor.getElementByKey(key)!.classList.contains('has-formula')).toBe(true)

    // After a SPAN→STRONG replacement, decorateHost runs on the fresh element too
    // (it has none of the old classes) — so the source highlight survives.
    editor.update(
      () => {
        ;($getNodeByKey(key) as TextNode).setFormat('bold')
      },
      { discrete: true },
    )
    const after = editor.getElementByKey(key)!
    expect(after.tagName).toBe('STRONG')
    expect(after.classList.contains('has-formula')).toBe(true)
  })

  // ── Caveat (a): does a `code`-formatted run stay a single TextNode? ──────────
  // If it did NOT, a consumer's `source` would attach to a fragment and evaluate a
  // truncated expression. $normalizeTextNode merges adjacent simple TextNodes with
  // equal format/mode/style during reconciliation.
  it('CAVEAT(a): adjacent code-formatted text nodes normalize to a single node', () => {
    harness = makeEditor([])
    const { editor } = harness

    let firstKey: NodeKey = ''
    editor.update(
      () => {
        const p = $createParagraphNode()
        const a = $createTextNode('=1+')
        a.setFormat('code')
        firstKey = a.getKey()
        p.append(a)
        $getRoot().clear().append(p)
      },
      { discrete: true },
    )

    // Append a SECOND code-formatted sibling, then dirty the first so the
    // reconcile normalizes them.
    editor.update(
      () => {
        const b = $createTextNode('2')
        b.setFormat('code')
        const a = $getNodeByKey(firstKey) as TextNode
        a.insertAfter(b)
        a.markDirty()
      },
      { discrete: true },
    )

    const { count, text } = editor.getEditorState().read(() => {
      const texts = $getRoot().getAllTextNodes()
      return { count: texts.length, text: texts.map((t) => t.getTextContent()).join('|') }
    })
    // If this ever becomes >1, the inline-formula consumer would evaluate a
    // truncated expression — report loudly (see src/nodewidget.ts header).
    expect(count).toBe(1)
    expect(text).toBe('=1+2')
  })

  // ── Caveat (b): are :818 and :1900 really the only $decorateDOM call sites? ──
  // A full reconcile ($fullReconcile, e.g. after setEditable) rebuilds every node
  // via $createNode → :818, so widgets must reappear. This exercises the path that
  // is NOT the incremental :1900 site.
  it('CAVEAT(b): widgets survive a full reconcile (setEditable → $fullReconcile)', () => {
    const widget = nodeWidget<TextNode, string>({
      id: 'w',
      klass: TextNode,
      source: ({ node }) => node.getTextContent(),
      render: (host, text) => {
        host.textContent = `=${text}`
      },
    })
    harness = makeEditor([widget])
    const { editor, root } = harness

    let key: NodeKey = ''
    editor.update(
      () => {
        const p = $createParagraphNode()
        const t = $createTextNode('q')
        key = t.getKey()
        p.append(t)
        $getRoot().clear().append(p)
      },
      { discrete: true },
    )
    expect(widgetHosts(root)).toHaveLength(1)
    const domBefore = editor.getElementByKey(key)!

    // Re-attaching the editor to a FRESH root forces $fullReconcile, which
    // rebuilds every node's DOM from scratch through $createNode (the :818
    // $decorateDOM call site). This is the path that is NOT the incremental
    // :1900 site.
    const root2 = document.createElement('div')
    root2.contentEditable = 'true'
    document.body.appendChild(root2)
    editor.setRootElement(root2)

    // The node's DOM element was genuinely rebuilt in the new root (new element)…
    const domAfter = editor.getElementByKey(key)!
    expect(domAfter).not.toBe(domBefore)
    expect(root2.contains(domAfter)).toBe(true)
    // …and the widget was re-decorated onto it in the same pass — proving
    // $decorateDOM fires on the full-reconcile create path, not only the
    // incremental :1900 site. (render is gated by equals, so its count is
    // irrelevant here.)
    const hosts = widgetHosts(root2)
    expect(hosts).toHaveLength(1)
    expect(hosts[0]!.textContent).toBe('=q')
    expect(hosts[0]!.parentElement).toBe(domAfter)
  })
})

// ── Integration: the lexicalForeign plumbing composes plugin + option widgets ──
describe(`lexicalForeign widget plumbing (lexical ${LEXICAL_VERSION})`, () => {
  interface AppState {
    readonly: boolean
  }
  type AppMsg = { type: 'noop' }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

  it('renders widgets contributed by a plugin, without touching the serialized doc', async () => {
    let editor!: LexicalEditor
    const widget = nodeWidget<TextNode, string>({
      id: 'plug',
      klass: TextNode,
      source: ({ node }) => (node.hasFormat('code') ? node.getTextContent() : null),
      render: (host, text) => {
        host.textContent = ` => ${text}`
      },
    })

    const def = component<AppState, AppMsg, never>({
      name: 'WidgetHost',
      init: () => ({ readonly: false }),
      update: (s) => s,
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'widget-plumbing',
          readonly: state.at('readonly'),
          serialize: (e) => e.getEditorState().read(() => $getRoot().getTextContent()),
          deserialize: (_e, _v) => {
            $getRoot().clear().append($createParagraphNode())
          },
          plugins: [{ name: 'formula', widgets: [widget] }],
          onReady: (e) => {
            editor = e
          },
        }),
      ],
    })
    app = mountApp(container, def)

    editor.update(
      () => {
        const p = $createParagraphNode()
        const t = $createTextNode('9*9')
        t.setFormat('code')
        p.append(t)
        $getRoot().clear().append(p)
      },
      { discrete: true },
    )
    await wait(0)

    const host = container.querySelector(`[${WIDGET_ATTR}="plug"]`)
    expect(host).not.toBeNull()
    expect(host!.textContent).toBe(' => 9*9')
    const docText = editor.getEditorState().read(() => $getRoot().getTextContent())
    expect(docText).toBe('9*9')
  })

  it('mounts exactly as before when no widgets are registered (no render config)', async () => {
    let editor!: LexicalEditor
    const def = component<AppState, AppMsg, never>({
      name: 'NoWidget',
      init: () => ({ readonly: false }),
      update: (s) => s,
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'no-widget',
          readonly: state.at('readonly'),
          serialize: (e) => e.getEditorState().read(() => $getRoot().getTextContent()),
          deserialize: (_e, _v) => {
            $getRoot()
              .clear()
              .append($createParagraphNode().append($createTextNode('plain')))
          },
          onReady: (e) => {
            editor = e
          },
        }),
      ],
    })
    app = mountApp(container, def)
    await wait(0)

    expect(container.querySelectorAll(`[${WIDGET_ATTR}]`)).toHaveLength(0)
    const docText = editor.getEditorState().read(() => $getRoot().getTextContent())
    expect(docText).toBe('plain')
  })
})
