import { component, mountApp, div, h1, table, tbody, tr, td, a, span, text, each } from '@llui/dom'
import { actionButton } from './action-button.js'

// ── Data generation (matches krausest spec exactly) ──

const adjectives = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
]
const colors = [
  'red',
  'yellow',
  'blue',
  'green',
  'pink',
  'brown',
  'purple',
  'brown',
  'white',
  'black',
  'orange',
]
const nouns = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
]

const random = (max: number) => Math.round(Math.random() * 1000) % max

type Row = { id: number; label: string }

let nextId = 1

// Selection highlight is applied imperatively (single delegated click + a tracked
// `selectedEl`) rather than a per-row reactive class binding: krausest's "select
// row" must toggle 'danger' on exactly two rows (old + new) in O(1), not
// re-evaluate every row's class on every selection change. `selectedEl` lives at
// module scope (one app instance) so the `view` can stay a concise arrow — which
// keeps its `each` directly lowerable by the compiler to the direct-construction
// fast path (`signalEachDirect`).
let selectedEl: HTMLElement | null = null

function buildData(count: number): Row[] {
  const data: Row[] = []
  for (let i = 0; i < count; i++) {
    data.push({
      id: nextId++,
      label: `${adjectives[random(adjectives.length)]} ${colors[random(colors.length)]} ${nouns[random(nouns.length)]}`,
    })
  }
  return data
}

// ── Component ────────────────────────────────────────

type State = { rows: Row[]; selected: number }
type Msg =
  /** @intent("Replace rows with 1,000 freshly generated entries") */
  | { type: 'run' }
  /** @intent("Replace rows with 10,000 freshly generated entries") */
  | { type: 'runlots' }
  /** @intent("Append 1,000 more rows to the existing list") */
  | { type: 'add' }
  /** @intent("Mutate every 10th row's label by appending '!!!'") */
  | { type: 'update' }
  /** @intent("Clear all rows and reset selection") */
  | { type: 'clear' }
  /** @intent("Swap rows at indices 1 and 998") */
  | { type: 'swaprows' }
  /**
   * @intent("Mark the given row as selected; clears any prior selection")
   * @example({"type":"select","id":42})
   */
  | { type: 'select'; id: number }
  /**
   * @intent("Remove the row with the given id from the list")
   * @example({"type":"remove","id":42})
   */
  | { type: 'remove'; id: number }

const App = component<State, Msg, never>({
  name: 'JFB',
  init: () => [{ rows: [], selected: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'run':
        return [{ ...state, rows: buildData(1000), selected: 0 }, []]
      case 'runlots':
        return [{ ...state, rows: buildData(10000), selected: 0 }, []]
      case 'add':
        return [{ ...state, rows: [...state.rows, ...buildData(1000)] }, []]
      case 'update': {
        const rows = state.rows.slice()
        for (let i = 0; i < rows.length; i += 10) {
          const r = rows[i]!
          rows[i] = { ...r, label: r.label + ' !!!' }
        }
        return [{ ...state, rows }, []]
      }
      case 'clear':
        return [{ rows: [], selected: 0 }, []]
      case 'swaprows': {
        if (state.rows.length < 999) return [state, []]
        const rows = state.rows.slice()
        const tmp = rows[1]!
        rows[1] = rows[998]!
        rows[998] = tmp
        return [{ ...state, rows }, []]
      }
      case 'select':
        return [{ ...state, selected: msg.id }, []]
      case 'remove':
        return [{ ...state, rows: state.rows.filter((r) => r.id !== msg.id) }, []]
    }
  },
  view: ({ state, send }) => [
    div({ class: 'container' }, [
      div({ class: 'jumbotron' }, [
        div({ class: 'row' }, [
          div({ class: 'col-md-6' }, [h1([text('LLui-keyed')])]),
          div({ class: 'col-md-6' }, [
            div({ class: 'row' }, [
              actionButton('run', 'Create 1,000 rows', send),
              actionButton('runlots', 'Create 10,000 rows', send),
              actionButton('add', 'Append 1,000 rows', send),
              actionButton('update', 'Update every 10th row', send),
              actionButton('clear', 'Clear', send),
              actionButton('swaprows', 'Swap Rows', send),
            ]),
          ]),
        ]),
      ]),
      table({ class: 'table table-hover table-striped test-data' }, [
        // A single delegated click listener on the live <tbody> (the `onClick`
        // prop) drives both select + remove in O(1) via `selectedEl`. With the
        // tbody + each authored DIRECTLY here (no IIFE wrapper), the compiler
        // lowers this static-skeleton row to the direct-construction fast path
        // (`signalEachDirect`). The first cell IS the row id — the handler reads
        // it back from there, so no per-row id capture is needed.
        tbody(
          {
            id: 'tbody',
            onClick: (e) => {
              const target = e.target as Element
              const trEl = target.closest('tr') as HTMLElement | null
              if (!trEl) return
              const idText = trEl.querySelector('td.col-md-1')?.textContent
              const id = idText ? Number(idText) : NaN
              if (Number.isNaN(id)) return
              if (target.closest('td.col-md-4')) {
                if (selectedEl && selectedEl !== trEl) selectedEl.className = ''
                trEl.className = 'danger'
                selectedEl = trEl
                send({ type: 'select', id })
              } else if (target.closest('td.col-md-1 a')) {
                if (selectedEl === trEl) selectedEl = null
                send({ type: 'remove', id })
              }
            },
          },
          [
            each(state.at('rows'), {
              key: (r: Row) => r.id,
              render: (item) => [
                tr([
                  td({ class: 'col-md-1' }, [text(item.map((r) => String(r.id)))]),
                  td({ class: 'col-md-4' }, [a([text(item.at('label'))])]),
                  td({ class: 'col-md-1' }, [
                    a([span({ class: 'glyphicon glyphicon-remove', 'aria-hidden': 'true' })]),
                  ]),
                  td({ class: 'col-md-6' }),
                ]),
              ],
            }),
          ],
        ),
      ]),
    ]),
  ],
})

mountApp(document.getElementById('main')!, App)
