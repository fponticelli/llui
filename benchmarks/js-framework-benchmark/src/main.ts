import {
  component,
  mountApp,
  div,
  h1,
  table,
  tbody,
  text,
  eachDirect,
  type RowFactory,
  type RowCtx,
} from '@llui/dom'
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

// Direct-construction row factory — what the compiler will emit for the row
// template `tr([td(text(id)), td(a(text(label))), td(a(span)), td()])`. Builds
// the DOM with direct ops and wires the two dynamic text slots by node reference;
// `produce(ctx)` reads the row ctx `{ item }`. The two `col-md-1` cells mirror the
// authored template: cell 0 holds the id (read back by the delegated click
// handler), cell 2 holds the remove link.
const diceRow: RowFactory = (doc) => {
  const tr = doc.createElement('tr')
  const td1 = doc.createElement('td')
  td1.setAttribute('class', 'col-md-1')
  const tId = doc.createTextNode('')
  td1.appendChild(tId)
  tr.appendChild(td1)

  const td2 = doc.createElement('td')
  td2.setAttribute('class', 'col-md-4')
  const a2 = doc.createElement('a')
  const tLabel = doc.createTextNode('')
  a2.appendChild(tLabel)
  td2.appendChild(a2)
  tr.appendChild(td2)

  const td3 = doc.createElement('td')
  td3.setAttribute('class', 'col-md-1')
  const a3 = doc.createElement('a')
  const sp = doc.createElement('span')
  sp.setAttribute('class', 'glyphicon glyphicon-remove')
  sp.setAttribute('aria-hidden', 'true')
  a3.appendChild(sp)
  td3.appendChild(a3)
  tr.appendChild(td3)

  const td4 = doc.createElement('td')
  td4.setAttribute('class', 'col-md-6')
  tr.appendChild(td4)

  return {
    nodes: [tr],
    bindings: [
      {
        deps: ['item.id'],
        produce: (ctx) => String((ctx as RowCtx<Row>).item.id),
        commit: (v) => {
          tId.data = v as string
        },
      },
      {
        deps: ['item.label'],
        produce: (ctx) => (ctx as RowCtx<Row>).item.label,
        commit: (v) => {
          tLabel.data = v == null ? '' : String(v)
        },
      },
    ],
  }
}

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
        (() => {
          // Selection highlight is applied imperatively (single delegated click +
          // a tracked `selectedEl`) rather than a per-row reactive class binding:
          // krausest's "select row" must toggle 'danger' on exactly two rows
          // (old + new) in O(1), not re-evaluate every row's class on every
          // selection change. The reducer still tracks `selected` for state /
          // agent consistency. (The legacy `selector` primitive is gone with the
          // legacy runtime; this is the idiomatic signal-runtime equivalent.)
          let selectedEl: HTMLElement | null = null
          // Single delegated click listener for all rows, attached to the live
          // <tbody> via the `onClick` prop. Element helpers now return a lazy
          // Mountable (materialized where placed), so we can no longer grab the
          // built node and `addEventListener` on it — the prop is the seam for
          // imperative DOM wiring.
          return tbody(
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
            // Direct-construction rows (Phase 1 prototype: what the compiler will
            // emit for this row template). `eachDirect` keeps the keyed reconcile
            // but builds each row with direct DOM ops + binding specs wired by node
            // reference — no per-row authoring-helper / Mountable / populate /
            // pathHandle overhead. The first cell IS the row id (the delegated click
            // handler reads it back from there).
            [eachDirect(state.at('rows'), (r: Row) => r.id, diceRow)],
          )
        })(),
      ]),
    ]),
  ],
})

mountApp(document.getElementById('main')!, App)
