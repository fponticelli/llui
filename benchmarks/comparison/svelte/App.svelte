<script lang="ts">
  import { buildData, type Row } from '../shared'

  let rows: Row[] = $state([])
  let selected: number | null = $state(null)

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
      case 'run': timed(() => { rows = buildData(1000) }); break
      case 'runlots': timed(() => { rows = buildData(10000) }); break
      case 'add': timed(() => { rows = [...rows, ...buildData(1000)] }); break
      case 'update': timed(() => {
        const r = rows.slice()
        for (let i = 0; i < r.length; i += 10) r[i] = { ...r[i]!, label: r[i]!.label + ' !!!' }
        rows = r
      }); break
      case 'clear': timed(() => { rows = [] }); break
      case 'swap': timed(() => {
        if (rows.length < 999) return
        const r = rows.slice()
        const tmp = r[1]!; r[1] = r[998]!; r[998] = tmp
        rows = r
      }); break
      case 'select': timed(() => {
        const lbl = document.querySelector('.lbl') as HTMLElement | null
        if (lbl) lbl.click()
      }); break
      case 'remove': timed(() => {
        const btn = document.querySelector('.remove') as HTMLElement | null
        if (btn) btn.click()
      }); break
      case 'replace': timed(() => { rows = buildData(1000) }); break
    }
  }

  window.__benchReady = true
</script>

<table>
  <tbody>
    {#each rows as row (row.id)}
      <tr class:selected={selected === row.id}>
        <td>{row.id}</td>
        <td>
          <span class="lbl" onclick={() => selected = row.id}>{row.label}</span>
        </td>
        <td>
          <button class="remove" onclick={() => rows = rows.filter(r => r.id !== row.id)}>x</button>
        </td>
      </tr>
    {/each}
  </tbody>
</table>
