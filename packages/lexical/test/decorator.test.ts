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
  readOnly: boolean
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
      init: () => ({ readOnly: false }),
      update: (s) => s,
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'decorator',
          nodes: [LLuiDecoratorNode],
          readOnly: state.at('readOnly'),
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
})
