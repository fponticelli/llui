/**
 * Generate benchmark content page from jfb-baseline.json.
 * Run as part of the build: `tsx src/generate-benchmarks.ts`
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const projectRoot = resolve(root, '..')

const data = JSON.parse(
  readFileSync(resolve(projectRoot, 'benchmarks/jfb-baseline.json'), 'utf-8'),
) as Record<string, Record<string, number>>

// Copy to public for client-side access
writeFileSync(resolve(root, 'public/benchmark-data.json'), JSON.stringify(data, null, 2))

const TIMING_BENCHMARKS = [
  { id: '01_run1k', label: 'Create 1k' },
  { id: '02_replace1k', label: 'Replace 1k' },
  { id: '03_update10th1k_x16', label: 'Update 10th' },
  { id: '04_select1k', label: 'Select' },
  { id: '05_swap1k', label: 'Swap' },
  { id: '06_remove-one-1k', label: 'Remove' },
  { id: '07_create10k', label: 'Create 10k' },
  { id: '08_create1k-after1k_x2', label: 'Append 1k' },
  { id: '09_clear1k_x8', label: 'Clear' },
]

const MEMORY_BENCHMARKS = [
  { id: '21_ready-memory', label: 'Ready' },
  { id: '22_run-memory', label: 'Run 1k' },
  { id: '25_run-clear-memory', label: 'Clear' },
]

const SIZE_BENCHMARKS = [
  { id: '41_size-uncompressed', label: 'Uncompressed' },
  { id: '42_size-compressed', label: 'Gzipped' },
]

const FRAMEWORKS = ['llui', 'solid', 'svelte', 'vanillajs', 'react', 'elm']
const DISPLAY_NAMES: Record<string, string> = {
  llui: 'LLui',
  solid: 'Solid',
  svelte: 'Svelte',
  vanillajs: 'vanilla',
  react: 'React',
  elm: 'Elm',
}

function val(fw: string, id: string): number {
  return data[fw]?.[id] ?? 0
}

function fmt(v: number, unit: string): string {
  if (unit === 'ms') return v.toFixed(1)
  if (unit === 'MB') return v.toFixed(1)
  if (unit === 'KB') return v.toFixed(1)
  return String(v)
}

function delta(llui: number, other: number): string {
  if (other === 0) return ''
  const pct = ((other - llui) / llui) * 100
  if (Math.abs(pct) < 1) return '='
  return pct > 0 ? `+${pct.toFixed(0)}%` : `${pct.toFixed(0)}%`
}

function isWin(llui: number, other: number): boolean {
  return llui < other * 0.97 // LLui is >3% faster
}

function generateTable(benchmarks: { id: string; label: string }[], unit: string): string {
  const fws = FRAMEWORKS.filter((fw) => benchmarks.every((b) => val(fw, b.id) > 0))
  const headers = ['Operation', ...fws.map((fw) => DISPLAY_NAMES[fw] ?? fw)]
  let md = `| ${headers.join(' | ')} |\n`
  md += `|${headers.map(() => '---:').join('|')}|\n`

  for (const b of benchmarks) {
    const _lluiVal = val('llui', b.id)
    const cells = fws.map((fw) => {
      const v = val(fw, b.id)
      const s = `${fmt(v, unit)} ${unit}`
      if (fw === 'llui') return `**${s}**`
      return s
    })
    md += `| ${b.label} | ${cells.join(' | ')} |\n`
  }

  return md
}

function generateRelativeTable(benchmarks: { id: string; label: string }[]): string {
  const fws = FRAMEWORKS.filter((fw) => fw !== 'llui' && benchmarks.every((b) => val(fw, b.id) > 0))
  const headers = ['Operation', ...fws.map((fw) => `vs ${DISPLAY_NAMES[fw] ?? fw}`)]
  let md = `| ${headers.join(' | ')} |\n`
  md += `|${headers.map(() => '---:').join('|')}|\n`

  for (const b of benchmarks) {
    const lluiVal = val('llui', b.id)
    const cells = fws.map((fw) => {
      const v = val(fw, b.id)
      const d = delta(lluiVal, v)
      const win = isWin(lluiVal, v)
      return win ? `**${d}**` : d
    })
    md += `| ${b.label} | ${cells.join(' | ')} |\n`
  }

  return md
}

// Generate the page content — charts are rendered by the BenchmarksPage component
const content = `---
title: Benchmarks
description: js-framework-benchmark results — LLui vs Solid, Svelte, React, vanilla JS
---

Results from [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) (krausest). All frameworks measured under identical conditions.

## Timings (ms)

<details>
<summary>Raw data</summary>

${generateTable(TIMING_BENCHMARKS, 'ms')}

### Relative to LLui

${generateRelativeTable(TIMING_BENCHMARKS)}

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

<details>
<summary>Raw data</summary>

${generateTable(MEMORY_BENCHMARKS, 'MB')}

</details>

## Bundle Size (KB)

<details>
<summary>Raw data</summary>

${generateTable(SIZE_BENCHMARKS, 'KB')}

</details>

## Methodology

- **Tool:** [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) by Stefan Krause
- **Browser:** Chrome (headful), CPU throttling 4x
- **Iterations:** 15 per benchmark, median reported
- **Machine:** MacBook Pro M5 Max, 128 GB RAM
- **LLui version:** Latest from \`opt\` branch with all compiler optimizations enabled
- **Data source:** [\`benchmarks/jfb-baseline.json\`](/benchmark-data.json) — raw JSON

Numbers fluctuate ±5% between runs. Differences <5% should be considered noise.
`

writeFileSync(resolve(root, 'content/benchmarks.md'), content)
console.log('Generated benchmarks.md')
