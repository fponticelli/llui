import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  lintSignalSource,
  transformSignalComponentSource,
  type TestTransformOptions,
} from '../parsed.js'

const THIS_FILE = fileURLToPath(import.meta.url)
const HELPERS = ['component', 'derived', 'div', 'each', 'input', 'tagSend', 'text'] as const
type Helper = (typeof HELPERS)[number]
type Calls = Readonly<Record<Helper, string>>

const directCalls: Calls = {
  component: 'component',
  derived: 'derived',
  div: 'div',
  each: 'each',
  input: 'input',
  tagSend: 'tagSend',
  text: 'text',
}
const aliasedCalls: Calls = {
  component: 'makeComponent',
  derived: 'combine',
  div: 'box',
  each: 'repeat',
  input: 'field',
  tagSend: 'tag',
  text: 'txt',
}
const namespaceCalls: Calls = {
  component: 'ui.component',
  derived: 'ui.derived',
  div: 'ui.div',
  each: 'ui.each',
  input: 'ui.input',
  tagSend: 'ui.tagSend',
  text: 'ui.text',
}

interface ImportShape {
  readonly name: string
  readonly imports: string
  readonly calls: Calls
}

const trustedShapes: readonly ImportShape[] = [
  {
    name: 'canonical package import',
    imports: `import { ${HELPERS.join(', ')} } from '@llui/dom'`,
    calls: directCalls,
  },
  {
    name: 'aliased package import',
    imports:
      "import { component as makeComponent, derived as combine, div as box, each as repeat, input as field, tagSend as tag, text as txt } from '@llui/dom'",
    calls: aliasedCalls,
  },
  {
    name: 'namespace package import',
    imports: "import * as ui from '@llui/dom'",
    calls: namespaceCalls,
  },
  {
    name: 'barrel re-export',
    imports: `import { ${HELPERS.join(', ')} } from '../fixtures/helper-bindings-forwarding-barrel.js'`,
    calls: directCalls,
  },
  {
    name: 'relative @llui/dom source import',
    imports: `import { ${HELPERS.join(', ')} } from '../../../dom/src/index.js'`,
    calls: directCalls,
  },
]

const unrelatedShape: ImportShape = {
  name: 'unrelated same-named imports',
  imports: `import { ${HELPERS.join(', ')} } from '../fixtures/helper-bindings-unrelated.js'`,
  calls: directCalls,
}

const sourceForRule: Readonly<Record<string, (calls: Calls) => string>> = {
  'peek-in-slot': (h) =>
    `${h.each}(state.at('rows'), { render: (item) => [${h.text}(item.at('name').peek())] })`,
  'operator-on-signal': (h) =>
    `${h.each}(state.at('rows'), { render: (item) => [${h.text}(item.at('n') + 1)] })`,
  'pure-derive-body': (h) =>
    `${h.derived}([state.at('n')], (n) => { fetch('/side-effect'); return n })`,
  'at-after-map': (h) => `${h.derived}([state.at('item')], (item) => item).at('name')`,
  'no-node-construction-in-body': (h) =>
    `state.at('item').map((item) => ${h.div}([${h.text}(item)]))`,
  'empty-props': (h) => `${h.div}({}, [])`,
  'controlled-input': (h) => `${h.input}({ value: state.at('name') }, [])`,
  a11y: (h) => `${h.div}({ onClick: () => undefined }, [])`,
  convention: (h) => `${h.div}({ tabIndex: 0 }, [])`,
  'event-handler-casing': (h) => `${h.div}({ onclick: () => undefined }, [])`,
  'attr-name': (h) => `${h.div}({ className: 'card' }, [])`,
  'async-update': (h) =>
    `${h.component}({ init: async () => ({}), update: (state) => state, view: () => [] })`,
  'exhaustive-update': (h) => `
type Msg = { type: 'one' } | { type: 'two' }
${h.component}<object, Msg>({
  init: () => ({}),
  update: (state, msg) => {
    switch (msg.type) {
      case 'one': return state
    }
    return state
  },
  view: () => [],
})`,
  'tag-send-drift': (h) => `${h.tagSend}(send, ['open'], () => send({ type: 'close' }))`,
}

describe('HelperBindings blast radius — every helper-sensitive signal rule (#146)', () => {
  for (const [rule, body] of Object.entries(sourceForRule)) {
    describe(rule, () => {
      for (const shape of trustedShapes) {
        it(`recognizes the helper through a ${shape.name}`, () => {
          const source = `${shape.imports}\n${body(shape.calls)}`
          expect(
            lintSignalSource(source, THIS_FILE).map((diagnostic) => diagnostic.rule),
          ).toContain(rule)
        })
      }

      it('does NOT recognize an unrelated same-named import', () => {
        const source = `${unrelatedShape.imports}\n${body(unrelatedShape.calls)}`
        expect(
          lintSignalSource(source, THIS_FILE).map((diagnostic) => diagnostic.rule),
        ).not.toContain(rule)
      })
    })
  }
})

function componentSource(shape: ImportShape): string {
  const h = shape.calls
  return `${shape.imports}
type State = { n: number; rows: readonly { id: string }[] }
type Msg = { type: 'inc' }
export const App = ${h.component}<State, Msg>({
  init: () => ({ n: 0, rows: [] }),
  update: (state) => state,
  view: ({ state }) => [
    ${h.div}([${h.text}(state.at('n'))]),
    ${h.each}(state.at('rows'), {
      key: (row) => row.id,
      render: (row) => [${h.text}(row.at('id'))],
    }),
  ],
})`
}

describe('HelperBindings blast radius — signal lowering (#146)', () => {
  const opts: TestTransformOptions = { fileName: THIS_FILE }

  for (const shape of trustedShapes) {
    it(`lowers helpers reached through a ${shape.name}`, () => {
      const source = componentSource(shape)
      const output = transformSignalComponentSource(source, opts)
      expect(output).not.toBe(source)
      expect(output).toContain('el("div"')
      expect(output).toContain('signalText(')
      expect(output).toContain('signalEach')
    })
  }

  it('leaves an unrelated same-named component and helpers verbatim', () => {
    const source = componentSource(unrelatedShape)
    expect(transformSignalComponentSource(source, opts)).toBe(source)
  })
})
