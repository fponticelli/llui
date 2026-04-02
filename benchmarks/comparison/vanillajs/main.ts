import { buildData, type Row } from '../shared'

declare global {
  interface Window {
    __benchReady: boolean
    __benchDone: boolean
    __benchDuration: number
    __runOp: (op: string) => void
  }
}

const tbody = document.getElementById('tbody')!
let rows: Row[] = []
let selected: number | null = null

function render() {
  tbody.textContent = ''
  for (const row of rows) {
    const tr = document.createElement('tr')
    if (row.id === selected) tr.className = 'selected'

    const td1 = document.createElement('td')
    td1.textContent = String(row.id)
    tr.appendChild(td1)

    const td2 = document.createElement('td')
    const lbl = document.createElement('span')
    lbl.className = 'lbl'
    lbl.textContent = row.label
    lbl.onclick = () => { selected = row.id; render() }
    td2.appendChild(lbl)
    tr.appendChild(td2)

    const td3 = document.createElement('td')
    const btn = document.createElement('button')
    btn.className = 'remove'
    btn.textContent = 'x'
    btn.onclick = () => { rows = rows.filter(r => r.id !== row.id); render() }
    td3.appendChild(btn)
    tr.appendChild(td3)

    tbody.appendChild(tr)
  }
}

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
  switch (op) {
    case 'run': timed(() => { rows = buildData(1000); render() }); break
    case 'runlots': timed(() => { rows = buildData(10000); render() }); break
    case 'add': timed(() => { rows = [...rows, ...buildData(1000)]; render() }); break
    case 'update': timed(() => {
      rows = rows.slice()
      for (let i = 0; i < rows.length; i += 10) rows[i] = { ...rows[i]!, label: rows[i]!.label + ' !!!' }
      render()
    }); break
    case 'clear': timed(() => { rows = []; render() }); break
    case 'swap': timed(() => {
      if (rows.length < 999) return
      rows = rows.slice()
      const tmp = rows[1]!; rows[1] = rows[998]!; rows[998] = tmp
      render()
    }); break
    case 'select': timed(() => {
      const lbl = document.querySelector('.lbl') as HTMLElement | null
      if (lbl) lbl.click()
    }); break
    case 'remove': timed(() => {
      const btn = document.querySelector('.remove') as HTMLElement | null
      if (btn) btn.click()
    }); break
    case 'replace': timed(() => { rows = buildData(1000); render() }); break
  }
}

window.__benchReady = true
