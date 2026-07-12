import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, onMount, span, text, type Signal } from '@llui/dom'
import {
  $getRoot,
  $getNodeByKey,
  $createParagraphNode,
  type LexicalEditor,
  type NodeKey,
} from 'lexical'
import { lexicalForeign } from '../src/foreign.js'
import { decoratorBridge } from '../src/plugin.js'
import {
  LLuiDecoratorNode,
  $createLLuiDecoratorNode,
  registerDecoratorBridges,
} from '../src/decorator.js'

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

describe('LLuiDecoratorNode bridge', () => {
  it('mounts an LLui sub-view into the decorator and disposes it on removal', async () => {
    const lifecycle: string[] = []
    let editor!: LexicalEditor

    const calloutBridge = decoratorBridge<{ label: string }, { label: string }, AppMsg, never>(
      'callout',
      (data) =>
        component<{ label: string }, AppMsg, never>({
          name: 'Callout',
          init: () => ({ label: data.label }),
          update: (s) => s,
          view: ({ state }) => [
            onMount(() => {
              lifecycle.push('mount')
              return () => lifecycle.push('cleanup')
            }),
            span({ 'data-callout': '' }, [text(state.at('label') as Signal<string>)]),
          ],
        }),
    )

    const def = component<AppState, AppMsg, never>({
      name: 'Host',
      init: () => ({ readonly: false }),
      update: (s) => s,
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'decorator',
          nodes: [LLuiDecoratorNode],
          readonly: state.at('readonly'),
          serialize: (e) => e.getEditorState().read(() => $getRoot().getTextContent()),
          deserialize: (_e, _v) => {
            $getRoot().clear().append($createParagraphNode())
          },
          plugins: [
            {
              name: 'callout-plugin',
              register: (e) => registerDecoratorBridges(e, [calloutBridge]),
            },
          ],
          onReady: (e) => {
            editor = e
          },
        }),
      ],
    })
    app = mountApp(container, def)

    let nodeKey: NodeKey = ''
    editor.update(
      () => {
        const node = $createLLuiDecoratorNode('callout', { label: 'Heads up' })
        nodeKey = node.getKey()
        $getRoot().clear().append(node).append($createParagraphNode())
      },
      { discrete: true },
    )
    await wait(0)

    const host = container.querySelector('[data-llui-decorator="callout"]')
    expect(host).not.toBeNull()
    expect(host?.textContent).toContain('Heads up')
    expect(container.querySelector('[data-callout]')).not.toBeNull()
    expect(lifecycle).toContain('mount')

    // Removing the node disposes the sub-app.
    editor.update(
      () => {
        $getNodeByKey(nodeKey)?.remove()
      },
      { discrete: true },
    )
    await wait(0)
    expect(lifecycle).toContain('cleanup')
  })

  it('disposing one registration leaves a composed registration’s mounts alive', async () => {
    const lifecycle: string[] = []
    let editor!: LexicalEditor
    let disposeA!: () => void
    let disposeB!: () => void

    const bridge = (type: string) =>
      decoratorBridge<{ label: string }, { label: string }, AppMsg, never>(type, (data) =>
        component<{ label: string }, AppMsg, never>({
          name: `Sub-${type}`,
          init: () => ({ label: data.label }),
          update: (s) => s,
          view: ({ state }) => [
            onMount(() => {
              lifecycle.push(`${type}-mount`)
              return () => lifecycle.push(`${type}-cleanup`)
            }),
            span({ 'data-sub': type }, [text(state.at('label') as Signal<string>)]),
          ],
        }),
      )

    const def = component<AppState, AppMsg, never>({
      name: 'ComposedHost',
      init: () => ({ readonly: false }),
      update: (s) => s,
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'composed',
          nodes: [LLuiDecoratorNode],
          readonly: state.at('readonly'),
          serialize: (e) => e.getEditorState().read(() => $getRoot().getTextContent()),
          deserialize: () => {
            $getRoot().clear().append($createParagraphNode())
          },
          onReady: (e) => {
            editor = e
            // Two independent registrations on the SAME editor (composition).
            disposeA = registerDecoratorBridges(e, [bridge('alpha')])
            disposeB = registerDecoratorBridges(e, [bridge('beta')])
          },
        }),
      ],
    })
    app = mountApp(container, def)

    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createLLuiDecoratorNode('alpha', { label: 'A' }))
          .append($createLLuiDecoratorNode('beta', { label: 'B' }))
          .append($createParagraphNode())
      },
      { discrete: true },
    )
    await wait(0)
    expect(lifecycle).toContain('alpha-mount')
    expect(lifecycle).toContain('beta-mount')
    expect(container.querySelector('[data-sub="alpha"]')).not.toBeNull()
    expect(container.querySelector('[data-sub="beta"]')).not.toBeNull()

    // Disposing registration A tears down ONLY its own mounts; B survives.
    disposeA()
    expect(lifecycle).toContain('alpha-cleanup')
    expect(lifecycle).not.toContain('beta-cleanup')
    // The beta bridge still decorates: re-decoration keeps mounting it.
    expect(container.querySelector('[data-sub="beta"]')).not.toBeNull()

    disposeB()
    expect(lifecycle).toContain('beta-cleanup')
  })
})
