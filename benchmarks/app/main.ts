import { component, mountApp, tr, td, button, span, text, each } from '@llui/core'

declare global {
  interface Window {
    __benchReady: boolean
    __benchDone: boolean
    __benchDuration: number
    __runOp: (op: string) => void
  }
}

type Row = { id: number; label: string }

let nextId = 1
const adjectives = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'nice', 'quick']
const nouns = ['table', 'chair', 'house', 'mouse', 'car', 'bike', 'tree', 'bird', 'fish']

function buildData(count: number): Row[] {
  const data: Row[] = []
  for (let i = 0; i < count; i++) {
    data.push({
      id: nextId++,
      label: adjectives[nextId % adjectives.length]! + ' ' + nouns[nextId % nouns.length]!,
    })
  }
  return data
}

type State = { rows: Row[]; selected: number | null }
type Msg =
  | { type: 'run' }
  | { type: 'runlots' }
  | { type: 'add' }
  | { type: 'update' }
  | { type: 'clear' }
  | { type: 'swap' }
  | { type: 'select'; id: number }
  | { type: 'remove'; id: number }
  | { type: 'replace' }

let appSend: (msg: Msg) => void
let appFlush: () => void

const App = component<State, Msg, never>({
  name: 'Benchmark',
  init: () => [{ rows: [], selected: null }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'run':
        return [{ ...state, rows: buildData(1000) }, []]
      case 'runlots':
        return [{ ...state, rows: buildData(10000) }, []]
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
        return [{ rows: [], selected: null }, []]
      case 'swap': {
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
      case 'replace':
        return [{ ...state, rows: buildData(1000) }, []]
    }
  },
  view: (_state, send) => {
    appSend = send
    return each<State, Row>({
      items: (s) => s.rows,
      key: (r) => r.id,
      render: (item) => [
        tr({}, [
          td({}, [text(item((r) => String(r.id)))]),
          td({}, [
            span(
              { class: 'lbl', onClick: () => send({ type: 'select', id: item((r) => r.id)() }) },
              [text(item((r) => r.label))],
            ),
          ]),
          td({}, [
            button(
              { class: 'remove', onClick: () => send({ type: 'remove', id: item((r) => r.id)() }) },
              [text('x')],
            ),
          ]),
        ]),
      ],
    })
  },
  __dirty: (o, n) =>
    (Object.is(o.rows, n.rows) ? 0 : 0b01) |
    (Object.is(o.selected, n.selected) ? 0 : 0b10),
})

const container = document.getElementById('tbody')!
const handle = mountApp(container, App)
appFlush = handle.flush

const ops: Record<string, Msg> = {
  run: { type: 'run' },
  runlots: { type: 'runlots' },
  add: { type: 'add' },
  update: { type: 'update' },
  clear: { type: 'clear' },
  swap: { type: 'swap' },
  replace: { type: 'replace' },
}

window.__runOp = (op: string) => {
  window.__benchDone = false

  // select and remove target the first row
  if (op === 'select') {
    const lbl = document.querySelector('.lbl') as HTMLElement | null
    if (!lbl) { window.__benchDone = true; window.__benchDuration = 0; return }
    const t0 = performance.now()
    lbl.click()
    appFlush()
    requestAnimationFrame(() => { requestAnimationFrame(() => {
      window.__benchDuration = performance.now() - t0
      window.__benchDone = true
    }) })
    return
  }

  if (op === 'remove') {
    const btn = document.querySelector('.remove') as HTMLElement | null
    if (!btn) { window.__benchDone = true; window.__benchDuration = 0; return }
    const t0 = performance.now()
    btn.click()
    appFlush()
    requestAnimationFrame(() => { requestAnimationFrame(() => {
      window.__benchDuration = performance.now() - t0
      window.__benchDone = true
    }) })
    return
  }

  const msg = ops[op]
  if (!msg) throw new Error(`Unknown op: ${op}`)
  const t0 = performance.now()
  appSend(msg)
  appFlush()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.__benchDuration = performance.now() - t0
      window.__benchDone = true
    })
  })
}

window.__benchReady = true
