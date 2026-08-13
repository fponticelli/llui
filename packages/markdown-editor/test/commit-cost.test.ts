// The measurement issue #74 asks for: how much does ONE editor commit cost the
// six overlay plugins? Counts the three things the issue names — update listeners
// registered, independent selection walks (`EditorState.read`) per commit, and
// forced layouts (`getBoundingClientRect`) per commit.
//
// The counters patch the shared prototypes, so they see every caller regardless
// of which plugin made the call, and every number is expressed RELATIVE to a
// core-only editor. That is what makes the assertions meaningful rather than
// brittle: the absolute totals include the host's own bookkeeping, which is not
// what this issue is about, and would drift with unrelated changes.
//
// Baseline on `main` (six private update listeners, one read each):
//   listeners at mount ......... core 3 → six 9   (+6)
//   reads per paragraph commit . core 6 → six 12  (+6)
//   forced layouts per caret move inside a code block ......... 1, every commit
//
// A discrete `editor.update` commits synchronously, so a window opened around one
// contains exactly the commit's listener work (the outbound serialize is on a
// 300ms timer, well outside it).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $getRoot, $isElementNode, type LexicalEditor } from 'lexical'
import { $isCodeNode } from '@lexical/code-core'
import { mountApp } from '@llui/dom'
import { markdownEditor } from '../src/editor.js'
import { corePlugin } from '../src/plugins/core.js'
import { codeLanguagePlugin } from '../src/plugins/code-language.js'
import { floatingToolbarPlugin } from '../src/plugins/floating-toolbar.js'
import { mentionPlugin } from '../src/plugins/mention.js'
import { slashPlugin } from '../src/plugins/slash.js'
import { tablePlugin } from '../src/plugins/table.js'
import { wikilinkPlugin } from '../src/plugins/wikilink.js'
import { moduleGraph } from './module-graph.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Counts {
  listeners: number
  reads: number
  layouts: number
}

/** Live counters installed on the shared prototypes for the whole file. */
const counts: Counts = { listeners: 0, reads: 0, layouts: 0 }
const restore: Array<() => void> = []

function patch<T extends object, K extends keyof T & string>(
  target: T,
  key: K,
  wrap: (original: T[K]) => T[K],
): void {
  const original = target[key]
  target[key] = wrap(original)
  restore.push(() => {
    target[key] = original
  })
}

// A throwaway headless editor is the only handle on the LexicalEditor /
// EditorState prototypes — neither class is exported.
const probe = createHeadlessEditor({
  namespace: 'probe',
  onError: () => {},
})
type EditorState = ReturnType<LexicalEditor['getEditorState']>
type EditorProto = { registerUpdateListener: LexicalEditor['registerUpdateListener'] }
// Counting only has to observe the CALL, so `read` is viewed through a signature
// that erases the callback's return type. Keeping the wrapper non-generic is what
// lets it forward `this` and the arguments verbatim with no cast.
type CountedRead = (callbackFn: () => unknown, options?: unknown) => unknown
type StateProto = { read: CountedRead }
const editorProto: EditorProto = Object.getPrototypeOf(probe)
const stateProto: StateProto = Object.getPrototypeOf(probe.getEditorState())

beforeEach(() => {
  patch(editorProto, 'registerUpdateListener', (original) => {
    return function registerUpdateListener(this: LexicalEditor, listener) {
      counts.listeners++
      return original.call(this, listener)
    }
  })
  patch(stateProto, 'read', (original) => {
    return function read(this: EditorState, callbackFn, options) {
      counts.reads++
      return original.call(this, callbackFn, options)
    }
  })
  patch(Element.prototype, 'getBoundingClientRect', (original) => {
    return function getBoundingClientRect(this: Element) {
      counts.layouts++
      return original.call(this)
    }
  })
  patch(Range.prototype, 'getBoundingClientRect', (original) => {
    return function getBoundingClientRect(this: Range) {
      counts.layouts++
      return original.call(this)
    }
  })
})

afterEach(() => {
  while (restore.length > 0) restore.pop()?.()
})

/** Zero the counters, run `fn`, and return what it cost. */
function measure(fn: () => void): Counts {
  counts.listeners = 0
  counts.reads = 0
  counts.layouts = 0
  fn()
  return { ...counts }
}

const ALL_SIX = (): ReturnType<typeof corePlugin>[] => [
  corePlugin(),
  codeLanguagePlugin(),
  floatingToolbarPlugin(),
  tablePlugin(),
  slashPlugin(),
  mentionPlugin(),
  wikilinkPlugin({ search: () => [] }),
]

let container: HTMLElement
const mounted: Array<ReturnType<typeof mountApp>> = []

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.dispose()
  document.body.innerHTML = ''
})

interface Mounted {
  editor: LexicalEditor
  mountCost: Counts
}

/** Mount an editor and hand back the live editor plus what mounting cost. */
async function mount(plugins: ReturnType<typeof ALL_SIX>, defaultValue: string): Promise<Mounted> {
  let editor!: LexicalEditor
  const mountCost = measure(() => {
    mounted.push(
      mountApp(
        container,
        markdownEditor({
          plugins,
          defaultValue,
          onReady: (e) => {
            editor = e
          },
        }),
      ),
    )
  })
  await wait(0)
  return { editor, mountCost }
}

const mountSix = (defaultValue: string) => mount(ALL_SIX(), defaultValue)
const mountCore = (defaultValue: string) => mount([corePlugin()], defaultValue)

/** Move the caret to the end of the document's first block. */
function moveCaretInParagraph(editor: LexicalEditor): void {
  editor.update(
    () => {
      const block = $getRoot().getFirstChild()
      if ($isElementNode(block)) block.selectEnd()
    },
    { discrete: true },
  )
}

describe('#74 per-commit cost of the six overlay plugins', () => {
  it('adds ONE update listener for all six, not one each', async () => {
    const core = await mountCore('hello')
    const six = await mountSix('hello')
    // Six private `registerUpdateListener` calls collapse to the single one the
    // shared commit hub registers on the first `onCommit` subscription.
    expect(six.mountCost.listeners - core.mountCost.listeners).toBe(1)
  })

  it('never registers the hub listener for an editor whose plugins do not subscribe', async () => {
    const core = await mountCore('hello')
    const bare = await mount([], 'hello')
    // EQUALITY, not `<=`: an inequality here is satisfiable by construction and
    // says nothing about the hub. `corePlugin` never calls `onCommit`, so adding
    // it must cost exactly zero update listeners — which is only true while the
    // hub stays unregistered until the first subscription. Registering it in
    // `createCommitHub` instead moves this by one.
    expect(core.mountCost.listeners).toBe(bare.mountCost.listeners)
  })

  it('walks the selection ONCE per commit, not once per plugin', async () => {
    const core = await mountCore('hello')
    const coreCost = measure(() => moveCaretInParagraph(core.editor))

    const six = await mountSix('hello')
    const sixCost = measure(() => moveCaretInParagraph(six.editor))

    // One shared `editorState.read` for all six, where there were six.
    expect(sixCost.reads - coreCost.reads).toBe(1)
  })

  it('forces NO layout when the caret merely moves inside a code block', async () => {
    const { editor } = await mountSix('```ts\nconst a = 1\nconst b = 2\n```\n')
    const selectCode = (where: 'start' | 'end') => () => {
      editor.update(
        () => {
          const code = $getRoot().getChildren().find($isCodeNode)
          if (!$isCodeNode(code)) return
          if (where === 'start') code.selectStart()
          else code.selectEnd()
        },
        { discrete: true },
      )
    }
    // Entering the block for the first time legitimately measures: the badge has
    // to be anchored somewhere.
    const entering = measure(selectCode('end'))
    expect(entering.layouts).toBeGreaterThan(0)

    // Every subsequent caret move within the SAME block dirties no node, so the
    // block's box cannot have moved. This is the per-commit forced layout the
    // issue is about; on `main` it happened on all of these.
    expect(measure(selectCode('start')).layouts).toBe(0)
    expect(measure(selectCode('end')).layouts).toBe(0)
    expect(measure(selectCode('start')).layouts).toBe(0)
  })

  // The issue names TWO plugins that still forced a layout per commit, and the
  // code-block probe above only exercises one of them: with no table in the
  // document the table plugin bails before measuring, so its own `selectionOnly`
  // gate can be deleted with that test still green. This is the other half.
  it('forces NO layout when the caret merely moves between cells of one table', async () => {
    const { editor } = await mountSix('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    // Cells of the one table, by document order — the caret hops between them.
    const selectCell = (index: number) => () => {
      editor.update(
        () => {
          const cell = $getRoot().getAllTextNodes().at(index)?.getParentOrThrow().getParentOrThrow()
          if ($isElementNode(cell)) cell.selectEnd()
        },
        { discrete: true },
      )
    }
    // Entering the table legitimately measures: the tools have to be anchored.
    expect(measure(selectCell(0)).layouts).toBeGreaterThan(0)

    // Moving between cells of the SAME table dirties no node, so the table's box
    // cannot have moved. On `main` every one of these forced a layout.
    expect(measure(selectCell(1)).layouts).toBe(0)
    expect(measure(selectCell(2)).layouts).toBe(0)
    expect(measure(selectCell(0)).layouts).toBe(0)
  })

  // Issue #75 turns each of these into its own subpath export so that
  // `@lexical/table` stops being a mandatory peer. Sharing a listener must not
  // undo that: the shared machinery lives in `@llui/lexical` (already a peer of
  // this package, imported by the editor itself), and each plugin reaches it
  // through a TYPE-ONLY import that the emit erases. So no plugin gained a
  // runtime edge at all, let alone one to a sibling plugin.
  //
  // Asserted on the MODULE GRAPH, not on the text of six files. Grepping the six
  // entry points proves nothing about the property #75 depends on: five of them
  // import `./overlay.js`, so a single value import added to that ONE shared
  // module puts `@lexical/table` (or `@llui/lexical`) into five plugins' runtime
  // graphs while every entry point's own text stays clean. The walk below follows
  // relative imports transitively, so a shared module is exactly as visible as
  // the entry itself.
  it('leaves every plugin independently loadable', () => {
    const six = ['code-language', 'floating-toolbar', 'table', 'slash', 'mention', 'wikilink']
    for (const name of six) {
      const graph = moduleGraph(`plugins/${name}.ts`)
      // No sibling plugin anywhere in the transitive graph.
      for (const other of six) {
        if (other === name) continue
        expect([name, graph.inputs.has(`plugins/${other}.ts`)]).toEqual([name, false])
      }
      // `@lexical/table` is reachable from the table plugin's graph and from no
      // other plugin's — the concrete statement of #75's peer-dependency goal.
      // Anything the hub had to learn about tables to serve the table plugin
      // would land in a shared module and show up in all six.
      expect([name, graph.externals.has('@lexical/table')]).toEqual([name, name === 'table'])
      // The positive proof that `import type { CommitFacts } from '@llui/lexical'`
      // is erased: the hub's package has NO runtime edge from any of the six.
      // Downgrading any of those to a value import fails right here.
      expect([name, graph.externals.has('@llui/lexical')]).toEqual([name, false])
    }
  })

  // A negative control for the walk itself. The gate above is a set of "must NOT
  // contain" assertions, and those pass vacuously if the walk silently resolves
  // nothing — so pin that it does reach past the entry file, into a shared module
  // and out to the real external packages.
  it('the loadability walk actually traverses the graph', () => {
    const graph = moduleGraph('plugins/table.ts')
    expect(graph.inputs.has('plugins/table.ts')).toBe(true)
    // `overlay.ts` is imported by the entry; `transformers/gfm.ts` only via a
    // further hop, so reaching it proves the walk is transitive, not one-level.
    expect(graph.inputs.has('plugins/overlay.ts')).toBe(true)
    expect(graph.inputs.has('transformers/gfm.ts')).toBe(true)
    expect(graph.externals.has('lexical')).toBe(true)
  })

  it('still measures when a commit actually dirties the code block', async () => {
    const { editor } = await mountSix('```ts\nconst a = 1\n```\n')
    editor.update(
      () => {
        const code = $getRoot().getChildren().find($isCodeNode)
        if ($isCodeNode(code)) code.selectEnd()
      },
      { discrete: true },
    )
    await wait(0)
    // A content change CAN move the block (it can reflow), so the gate must not
    // suppress the measurement here.
    const typing = measure(() => {
      editor.update(
        () => {
          const code = $getRoot().getChildren().find($isCodeNode)
          if (!$isCodeNode(code)) return
          const first = code.getFirstChild()
          if (first !== null) code.append(first)
        },
        { discrete: true },
      )
    })
    expect(typing.layouts).toBeGreaterThan(0)
  })
})
