/**
 * Synchronous timing benchmark — measures pure JS framework cost
 * without rAF/paint overhead. LLui only.
 *
 * Usage: tsx benchmarks/sync-timing.ts
 */

import { chromium } from 'playwright'
import { createServer } from 'vite'
import { resolve, dirname } from 'node:path'

const ROOT = dirname(import.meta.dirname)
const APP_DIR = resolve(ROOT, 'benchmarks/js-framework-benchmark')

const N_WARMUP = 5
const N_RUNS = parseInt(process.env.BENCH_RUNS ?? '50', 10)

const OPS = [
  { id: 'run', pre: 'clear', label: 'Create 1k' },
  { id: 'run', pre: 'run', label: 'Replace 1k' },
  { id: 'update', pre: 'run', label: 'Update 10th' },
  { id: 'select', pre: 'run', label: 'Select row' },
  { id: 'swaprows', pre: 'run', label: 'Swap 1↔998' },
  { id: 'remove', pre: 'run', label: 'Remove row' },
  { id: 'add', pre: 'run', label: 'Append 1k' },
  { id: 'clear', pre: 'run', label: 'Clear all' },
  { id: 'runlots', pre: 'clear', label: 'Create 10k' },
]

async function main() {
  const { default: llui } = await import(resolve(ROOT, 'packages/vite-plugin/src/index.ts'))
  const server = await createServer({
    root: APP_DIR,
    server: { port: 0 },
    plugins: [llui()],
    resolve: {
      alias: { '@llui/core': resolve(ROOT, 'packages/core/src/index.ts') },
    },
    logLevel: 'silent',
  })
  await server.listen()
  const port = server.config.server.port ?? 5173

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newContext().then((c) => c.newPage())

  await page.goto(`http://localhost:${port}/`)
  await page.waitForTimeout(2000)

  // Inject synchronous timing harness
  await page.evaluate(() => {
    // @ts-expect-error global
    window.__syncOp = (op: string) => {
      const t0 = performance.now()
      if (op === 'select') {
        const lbl = document.querySelector('td.col-md-4 a') as HTMLElement | null
        if (lbl) lbl.click()
      } else if (op === 'remove') {
        const btn = document.querySelector('.glyphicon-remove') as HTMLElement | null
        if (btn) btn.click()
      } else {
        const btn = document.getElementById(op) as HTMLElement | null
        if (btn) btn.click()
      }
      // LLui's button handler calls flush() — DOM is updated synchronously
      return performance.now() - t0
    }
  })

  async function runOp(op: string): Promise<number> {
    return page.evaluate((o) => (window as Record<string, unknown>).__syncOp(o) as number, op)
  }

  console.log()
  console.log(`=== Synchronous JS Timing (no rAF, ${N_RUNS} runs) ===`)
  console.log()

  for (const op of OPS) {
    // Warmup
    for (let i = 0; i < N_WARMUP; i++) {
      if (op.pre) await runOp(op.pre)
      await runOp(op.id)
    }

    const times: number[] = []
    for (let i = 0; i < N_RUNS; i++) {
      if (op.pre) await runOp(op.pre)
      times.push(await runOp(op.id))
    }

    times.sort((a, b) => a - b)
    const min = times[0]!
    const median = times[Math.floor(times.length / 2)]!
    const p95 = times[Math.floor(times.length * 0.95)]!

    console.log(
      `  ${op.label.padEnd(16)} min=${min.toFixed(2)}ms  median=${median.toFixed(2)}ms  p95=${p95.toFixed(2)}ms`,
    )
  }

  console.log()
  await browser.close()
  await server.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
