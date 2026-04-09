import { component, div, h1, h2, article, onMount } from '@llui/dom'
import type { BenchmarksPageData } from '../../pages/benchmarks/+data'
import { siteLayout } from './site-layout'

type State = BenchmarksPageData & {
  menuOpen: boolean
}

type Msg = { type: 'toggleMenu' }

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

const FW_COLORS: Record<string, string> = {
  llui: '#6366f1',
  solid: '#2563eb',
  svelte: '#f97316',
  vanillajs: '#737373',
  react: '#06b6d4',
  elm: '#60a5fa',
}

function fmt(v: number, unit: string): string {
  if (unit === 'ms' || unit === 'MB' || unit === 'KB') return v.toFixed(1)
  return String(v)
}

function barChartSvg(
  benchId: string,
  label: string,
  unit: string,
  benchmarks: Record<string, Record<string, number>>,
): string {
  const barH = 14
  const gap = 4
  const labelW = 70
  const valueW = 80
  const chartW = 600
  const barAreaW = chartW - labelW - valueW

  const values = FRAMEWORKS.map((fw) => ({
    fw,
    val: benchmarks[fw]?.[benchId] ?? 0,
  })).filter((v) => v.val > 0)
  const max = Math.max(...values.map((v) => v.val))
  const svgH = values.length * (barH + gap) + gap

  let out = `<h3 class="bench-chart-title">${label}</h3>`
  out += `<svg class="bench-chart" viewBox="0 0 ${chartW} ${svgH}" width="100%" preserveAspectRatio="xMinYMid meet">`

  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    const y = gap + i * (barH + gap)
    const barW = Math.max(2, Math.round((v.val / max) * barAreaW))
    const color = FW_COLORS[v.fw] ?? '#94a3b8'
    const name = DISPLAY_NAMES[v.fw] ?? v.fw
    const isLlui = v.fw === 'llui'
    const delay = (i * 0.08).toFixed(2)
    const valLabel = `${fmt(v.val, unit)} ${unit}`

    out += `<text x="${labelW - 8}" y="${y + barH / 2 + 4}" text-anchor="end" class="bench-label${isLlui ? ' bench-llui' : ''}">${name}</text>`
    out += `<rect x="${labelW}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${color}" class="bench-bar" style="--bar-w:${barW}px;animation-delay:${delay}s"${isLlui ? '' : ' opacity="0.75"'}/>`
    out += `<text x="${labelW + barW + 8}" y="${y + barH / 2 + 4}" class="bench-value${isLlui ? ' bench-llui' : ''}">${valLabel}</text>`
  }

  out += '</svg>'
  return out
}

function chartsSvgHtml(
  benchmarks: { id: string; label: string }[],
  unit: string,
  data: Record<string, Record<string, number>>,
): string {
  return benchmarks
    .map(
      (b) =>
        `<div class="bench-chart-wrapper" data-bench-id="${b.id}">${barChartSvg(b.id, b.label, unit, data)}</div>`,
    )
    .join('')
}

function allChartsHtml(data: Record<string, Record<string, number>>): string {
  let html = ''
  html += '<h2>Timings (ms)</h2>'
  html += chartsSvgHtml(TIMING_BENCHMARKS, 'ms', data)
  html += '<h2>Memory (MB)</h2>'
  html += chartsSvgHtml(MEMORY_BENCHMARKS, 'MB', data)
  html += '<h2>Bundle Size (KB)</h2>'
  html += chartsSvgHtml(SIZE_BENCHMARKS, 'KB', data)
  return html
}

export const BenchmarksPage = component<State, Msg, never, BenchmarksPageData>({
  name: 'BenchmarksPage',
  init: (data) => [{ ...data, menuOpen: false }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'toggleMenu':
        return [{ ...state, menuOpen: !state.menuOpen }, []]
    }
  },
  view: ({ send, text }) => {
    // IntersectionObserver sets data-visible directly on chart wrappers.
    // Use requestAnimationFrame to ensure innerHTML bindings have been applied.
    onMount((container) => {
      let observer: IntersectionObserver | null = null

      const setup = () => {
        const wrappers = container.querySelectorAll('.bench-chart-wrapper')
        if (wrappers.length === 0) return

        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                ;(entry.target as HTMLElement).dataset.visible = 'true'
                observer!.unobserve(entry.target)
              }
            }
          },
          { threshold: 0.2 },
        )

        for (const wrapper of wrappers) {
          observer.observe(wrapper)
        }
      }

      requestAnimationFrame(setup)
      return () => observer?.disconnect()
    })

    return [
      siteLayout<State, Msg>({
        slug: 'benchmarks',
        menuOpen: false,
        text,
        send,
        content: [
          article({ class: 'site-content' }, [
            h1({ class: 'page-title' }, [text((s: State) => s.title)]),
            div({ class: 'prose' }, [
              div({
                innerHTML:
                  '<p>Results from <a href="https://github.com/krausest/js-framework-benchmark">js-framework-benchmark</a> (krausest). All frameworks measured under identical conditions.</p>',
              }),
              // Charts rendered from benchmark data
              div({
                class: 'bench-charts-section',
                innerHTML: (s: State) => allChartsHtml(s.benchmarks),
              }),
              // Raw data tables and methodology from markdown prose
              div({ class: 'bench-raw-data' }, [
                h2([text('Raw Data & Methodology')]),
                div({ innerHTML: (s: State) => s.html }, []),
              ]),
            ]),
          ]),
        ],
      }),
    ]
  },
})
