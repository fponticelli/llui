#!/usr/bin/env node

import { chromium } from 'playwright'
import { createServer } from 'vite'
import { resolve, dirname } from 'node:path'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const ROOT = dirname(import.meta.dirname)
const APP_DIR = resolve(import.meta.dirname, 'app')
const BASELINE_PATH = resolve(import.meta.dirname, 'baseline-runtime.json')

const CPU_THROTTLE = 4
const N_WARMUP = 5
const N_RUNS = 10

const OPS = [
  { id: 'run', pre: 'clear', label: 'Create 1k rows' },
  { id: 'replace', pre: 'run', label: 'Replace 1k rows' },
  { id: 'update', pre: 'run', label: 'Update every 10th row' },
  { id: 'select', pre: 'run', label: 'Select one row' },
  { id: 'swap', pre: 'run', label: 'Swap rows 1 ↔ 998' },
  { id: 'remove', pre: 'run', label: 'Remove one row' },
  { id: 'add', pre: 'run', label: 'Append 1k to 1k rows' },
  { id: 'clear', pre: 'run', label: 'Clear all rows' },
  { id: 'runlots', pre: 'clear', label: 'Create 10k rows' },
]

async function main() {
  // Start Vite dev server
  const server = await createServer({
    root: APP_DIR,
    server: { port: 0 },
    resolve: {
      alias: { '@llui/core': resolve(ROOT, 'packages/core/src/index.ts') },
    },
    logLevel: 'silent',
  })
  await server.listen()
  const port = server.config.server.port ?? 5173
  const url = `http://localhost:${port}`

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()

  // Connect CDP for CPU throttling
  const cdp = await context.newCDPSession(page)

  await page.goto(url)
  await page.waitForFunction(() => window.__benchReady === true)

  async function runOp(op: string) {
    await page.evaluate((o) => window.__runOp(o), op)
    await page.waitForFunction(() => window.__benchDone === true, null, { timeout: 30000 })
    const duration = await page.evaluate(() => {
      const d = window.__benchDuration
      window.__benchDone = false
      return d
    })
    return duration
  }

  console.log()
  console.log(`=== Runtime Performance (Chromium, ${CPU_THROTTLE}× throttle, ${N_RUNS} runs) ===`)
  console.log()

  const results: Record<string, { min: number; median: number; p95: number }> = {}

  for (const op of OPS) {
    // Warmup at 1× (no throttle)
    for (let i = 0; i < N_WARMUP; i++) {
      if (op.pre) await runOp(op.pre)
      await runOp(op.id)
    }

    // Throttle for measurement
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })

    const times: number[] = []
    for (let i = 0; i < N_RUNS; i++) {
      if (op.pre) await runOp(op.pre)
      const t = await runOp(op.id)
      times.push(t)
    }

    // Remove throttle
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

    times.sort((a, b) => a - b)
    const min = times[0]!
    const median = times[Math.floor(times.length / 2)]!
    const p95 = times[Math.floor(times.length * 0.95)]!

    results[op.id] = { min, median, p95 }

    console.log(
      `  ${op.label.padEnd(30)} min=${min.toFixed(1)}ms  median=${median.toFixed(1)}ms  p95=${p95.toFixed(1)}ms`,
    )
  }

  console.log()

  // Compare to baseline
  if (existsSync(BASELINE_PATH)) {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    let regressions = false
    for (const [id, data] of Object.entries(results)) {
      const prev = baseline[id] as { median: number } | undefined
      if (!prev) continue
      const delta = data.median - prev.median
      const pct = ((delta / prev.median) * 100).toFixed(0)
      if (delta > prev.median * 0.15) {
        console.log(`  ⚠ ${id}: +${delta.toFixed(1)}ms (+${pct}%)`)
        regressions = true
      }
    }
    if (!regressions) console.log('  ✓ No regressions vs baseline')
    console.log()
  }

  if (process.argv.includes('--save')) {
    writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 2) + '\n')
    console.log(`  Baseline saved to ${BASELINE_PATH}`)
  }

  await browser.close()
  await server.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
