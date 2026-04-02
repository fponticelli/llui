import { createRoot } from 'react-dom/client'
import { useState, useCallback, memo } from 'react'
import { buildData, type Row } from '../shared'

declare global {
  interface Window {
    __benchReady: boolean
    __benchDone: boolean
    __benchDuration: number
    __runOp: (op: string) => void
  }
}

const RowComponent = memo(function RowComponent({
  row,
  isSelected,
  onSelect,
  onRemove,
}: {
  row: Row
  isSelected: boolean
  onSelect: (id: number) => void
  onRemove: (id: number) => void
}) {
  return (
    <tr className={isSelected ? 'selected' : ''}>
      <td>{row.id}</td>
      <td>
        <span className="lbl" onClick={() => onSelect(row.id)}>
          {row.label}
        </span>
      </td>
      <td>
        <button className="remove" onClick={() => onRemove(row.id)}>
          x
        </button>
      </td>
    </tr>
  )
})

let externalSetState: ((fn: (s: { rows: Row[]; selected: number | null }) => { rows: Row[]; selected: number | null }) => void) | null = null

function App() {
  const [state, setState] = useState<{ rows: Row[]; selected: number | null }>({
    rows: [],
    selected: null,
  })
  externalSetState = setState

  const onSelect = useCallback(
    (id: number) => setState((s) => ({ ...s, selected: id })),
    [],
  )
  const onRemove = useCallback(
    (id: number) => setState((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== id) })),
    [],
  )

  return (
    <tbody id="tbody">
      {state.rows.map((row) => (
        <RowComponent
          key={row.id}
          row={row}
          isSelected={row.id === state.selected}
          onSelect={onSelect}
          onRemove={onRemove}
        />
      ))}
    </tbody>
  )
}

const table = document.createElement('table')
document.body.appendChild(table)
const root = createRoot(table)
root.render(<App />)

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

window.__runOp = (op: string) => {
  if (!externalSetState) return
  const set = externalSetState
  switch (op) {
    case 'run': timed(() => set(() => ({ rows: buildData(1000), selected: null }))); break
    case 'runlots': timed(() => set(() => ({ rows: buildData(10000), selected: null }))); break
    case 'add': timed(() => set((s) => ({ ...s, rows: [...s.rows, ...buildData(1000)] }))); break
    case 'update': timed(() => set((s) => {
      const rows = s.rows.slice()
      for (let i = 0; i < rows.length; i += 10) rows[i] = { ...rows[i]!, label: rows[i]!.label + ' !!!' }
      return { ...s, rows }
    })); break
    case 'clear': timed(() => set(() => ({ rows: [], selected: null }))); break
    case 'swap': timed(() => set((s) => {
      if (s.rows.length < 999) return s
      const rows = s.rows.slice()
      const tmp = rows[1]!; rows[1] = rows[998]!; rows[998] = tmp
      return { ...s, rows }
    })); break
    case 'select': timed(() => {
      const lbl = document.querySelector('.lbl') as HTMLElement | null
      if (lbl) lbl.click()
    }); break
    case 'remove': timed(() => {
      const btn = document.querySelector('.remove') as HTMLElement | null
      if (btn) btn.click()
    }); break
    case 'replace': timed(() => set(() => ({ rows: buildData(1000), selected: null }))); break
  }
}

window.__benchReady = true
