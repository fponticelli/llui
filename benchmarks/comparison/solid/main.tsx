/* @refresh reload */
import { createSignal, For } from 'solid-js'
import { render } from 'solid-js/web'
import { buildData, type Row } from '../shared'

declare global {
  interface Window {
    __benchReady: boolean
    __benchDone: boolean
    __benchDuration: number
    __runOp: (op: string) => void
  }
}

function App() {
  const [rows, setRows] = createSignal<Row[]>([])
  const [selected, setSelected] = createSignal<number | null>(null)

  ;(window as Record<string, unknown>).__ops = { setRows, setSelected }

  return (
    <table>
      <tbody>
        <For each={rows()}>
          {(row) => (
            <tr classList={{ selected: selected() === row.id }}>
              <td>{row.id}</td>
              <td>
                <span class="lbl" onClick={() => setSelected(row.id)}>
                  {row.label}
                </span>
              </td>
              <td>
                <button
                  class="remove"
                  onClick={() => setRows((r) => r.filter((x) => x.id !== row.id))}
                >
                  x
                </button>
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  )
}

render(() => <App />, document.body)

function timed(fn: () => void) {
  window.__benchDone = false
  const t0 = performance.now()
  fn()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.__benchDuration = performance.now() - t0
      window.__benchDone = true
    })
  })
}

const ops = (window as Record<string, unknown>).__ops as {
  setRows: (fn: (rows: Row[]) => Row[]) => void
  setSelected: (id: number | null) => void
}

window.__runOp = (op: string) => {
  switch (op) {
    case 'run': timed(() => ops.setRows(() => buildData(1000))); break
    case 'runlots': timed(() => ops.setRows(() => buildData(10000))); break
    case 'add': timed(() => ops.setRows((r) => [...r, ...buildData(1000)])); break
    case 'update': timed(() => ops.setRows((rows) => {
      const r = rows.slice()
      for (let i = 0; i < r.length; i += 10) r[i] = { ...r[i]!, label: r[i]!.label + ' !!!' }
      return r
    })); break
    case 'clear': timed(() => ops.setRows(() => [])); break
    case 'swap': timed(() => ops.setRows((rows) => {
      if (rows.length < 999) return rows
      const r = rows.slice()
      const tmp = r[1]!; r[1] = r[998]!; r[998] = tmp
      return r
    })); break
    case 'select': timed(() => {
      const lbl = document.querySelector('.lbl') as HTMLElement | null
      if (lbl) lbl.click()
    }); break
    case 'remove': timed(() => {
      const btn = document.querySelector('.remove') as HTMLElement | null
      if (btn) btn.click()
    }); break
    case 'replace': timed(() => ops.setRows(() => buildData(1000))); break
  }
}

window.__benchReady = true
