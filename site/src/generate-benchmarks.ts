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

// Also copy to public for client-side access
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
    const lluiVal = val('llui', b.id)
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

const FW_COLORS: Record<string, string> = {
  llui: '#6366f1',
  solid: '#2563eb',
  svelte: '#f97316',
  vanillajs: '#737373',
  react: '#06b6d4',
  elm: '#60a5fa',
}

function generateSvgCharts(benchmarks: { id: string; label: string }[], unit: string): string {
  const fws = ['llui', 'solid', 'svelte', 'vanillajs', 'react', 'elm']
  const barH = 28
  const gap = 6
  const labelW = 70
  const valueW = 80
  const chartW = 600
  const barAreaW = chartW - labelW - valueW
  let md = ''

  for (const b of benchmarks) {
    const values = fws
      .map((fw) => ({ fw, val: val(fw, b.id) }))
      .filter((v) => v.val > 0)
    if (values.length === 0) continue
    const max = Math.max(...values.map((v) => v.val))
    const svgH = values.length * (barH + gap) + gap

    md += `**${b.label}**\n\n`
    md += `<svg class="bench-chart" viewBox="0 0 ${chartW} ${svgH}" width="100%" preserveAspectRatio="xMinYMid meet">\n`

    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      const y = gap + i * (barH + gap)
      const barW = Math.max(2, Math.round((v.val / max) * barAreaW))
      const color = FW_COLORS[v.fw] ?? '#94a3b8'
      const name = DISPLAY_NAMES[v.fw] ?? v.fw
      const isLlui = v.fw === 'llui'
      const delay = (i * 0.08).toFixed(2)
      const label = `${fmt(v.val, unit)} ${unit}`

      md += `  <text x="${labelW - 8}" y="${y + barH / 2 + 5}" text-anchor="end" class="bench-label${isLlui ? ' bench-llui' : ''}">${name}</text>\n`
      md += `  <rect x="${labelW}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${color}" class="bench-bar" style="--bar-w:${barW}px;animation-delay:${delay}s"${isLlui ? ' opacity="1"' : ' opacity="0.75"'}/>\n`
      md += `  <text x="${labelW + barW + 8}" y="${y + barH / 2 + 5}" class="bench-value${isLlui ? ' bench-llui' : ''}">${label}</text>\n`
    }

    md += `</svg>\n\n`
  }

  return md
}

function generateMemoryChart(benchmarks: { id: string; label: string }[]): string {
  return generateSvgCharts(benchmarks, 'MB')
}

function generateBundleChart(benchmarks: { id: string; label: string }[]): string {
  return generateSvgCharts(benchmarks, 'KB')
}

// Generate the page content
let content = `---
title: Benchmarks
description: js-framework-benchmark results — LLui vs Solid, Svelte, React, vanilla JS
---

<style>
@keyframes bar-grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
.bench-chart { max-width: 640px; margin: 0.5rem 0 1.5rem; overflow: visible; }
.bench-bar { transform-origin: left center; animation: bar-grow 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
.bench-label { font: 13px/1 system-ui, sans-serif; fill: var(--fg, #24292f); }
.bench-value { font: 12px/1 system-ui, sans-serif; fill: var(--fg-muted, #656d76); }
.bench-llui { font-weight: 600; }
</style>

Results from [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) (krausest). All frameworks measured under identical conditions.

## Timings (ms)

${generateSvgCharts(TIMING_BENCHMARKS, 'ms')}

<details>
<summary>Raw data</summary>

${generateTable(TIMING_BENCHMARKS, 'ms')}

### Relative to LLui

${generateRelativeTable(TIMING_BENCHMARKS)}

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

${generateMemoryChart(MEMORY_BENCHMARKS)}

<details>
<summary>Raw data</summary>

${generateTable(MEMORY_BENCHMARKS, 'MB')}

</details>

## Bundle Size (KB)

${generateBundleChart(SIZE_BENCHMARKS)}

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
