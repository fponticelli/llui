import { chromium } from 'playwright'
import { createServer } from 'vite'
import { resolve, dirname } from 'node:path'

const ROOT = dirname(dirname(import.meta.dirname))
const HERE = import.meta.dirname

const CPU_THROTTLE = 4
const N_WARMUP = 5
const N_RUNS = parseInt(process.env.BENCH_RUNS ?? '25', 10)

const OPS = [
  { id: 'run', pre: 'clear', label: 'Create 1k' },
  { id: 'replace', pre: 'run', label: 'Replace 1k' },
  { id: 'update', pre: 'run', label: 'Update 10th' },
  { id: 'select', pre: 'run', label: 'Select row' },
  { id: 'swap', pre: 'run', label: 'Swap 1↔998' },
  { id: 'remove', pre: 'run', label: 'Remove row' },
  { id: 'add', pre: 'run', label: 'Append 1k' },
  { id: 'clear', pre: 'run', label: 'Clear all' },
  { id: 'runlots', pre: 'clear', label: 'Create 10k' },
]

interface FrameworkConfig {
  name: string
  root: string
  plugins?: () => Promise<unknown[]>
}

const frameworks: FrameworkConfig[] = [
  {
    name: 'llui',
    root: resolve(HERE, '../../benchmarks/app'),
    plugins: async () => {
      const { default: llui } = await import(resolve(ROOT, 'packages/vite-plugin/src/index.ts'))
      return [llui()]
    },
  },
  {
    name: 'vanillajs',
    root: resolve(HERE, 'vanillajs'),
  },
  {
    name: 'react',
    root: resolve(HERE, 'react'),
    plugins: async () => {
      const { default: react } = await import('@vitejs/plugin-react')
      return [react()]
    },
  },
  {
    name: 'solid',
    root: resolve(HERE, 'solid'),
    plugins: async () => {
      const solidPlugin = await import('vite-plugin-solid')
      return [solidPlugin.default()]
    },
  },
  {
    name: 'svelte',
    root: resolve(HERE, 'svelte'),
    plugins: async () => {
      const { svelte } = await import('@sveltejs/vite-plugin-svelte')
      return [svelte()]
    },
  },
]

// Filter to only requested frameworks
const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const toRun =
  requested.length > 0 ? frameworks.filter((f) => requested.includes(f.name)) : frameworks

async function main() {
  const browser = await chromium.launch({ headless: true })
  const allResults: Record<string, Record<string, { min: number; median: number }>> = {}

  for (const fw of toRun) {
    let plugins: unknown[] = []
    try {
      plugins = fw.plugins ? ((await fw.plugins()) as unknown[]) : []
    } catch (e) {
      console.log(`  ⚠ ${fw.name}: plugin not installed, skipping (${(e as Error).message})`)
      continue
    }

    const server = await createServer({
      root: fw.root,
      server: { port: 0 },
      plugins,
      resolve: {
        alias: {
          '@llui/core': resolve(ROOT, 'packages/core/src/index.ts'),
          '../shared': resolve(HERE, 'shared.ts'),
        },
      },
      logLevel: 'silent',
    })
    await server.listen()
    const port = server.config.server.port ?? 5173
    const url = `http://localhost:${port}`

    const context = await browser.newContext()
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)

    // Use the framework's own index.html or fallback to shared
    const indexPath = resolve(fw.root, 'index.html')
    const { existsSync } = await import('node:fs')
    if (!existsSync(indexPath)) {
      // Copy shared index.html — actually just navigate to the root
    }

    await page.goto(url)
    await page.waitForFunction(() => window.__benchReady === true, null, { timeout: 10000 })

    async function runOp(op: string) {
      await page.evaluate((o) => window.__runOp(o), op)
      await page.waitForFunction(() => window.__benchDone === true, null, { timeout: 30000 })
      return page.evaluate(() => {
        const d = window.__benchDuration
        window.__benchDone = false
        return d
      })
    }

    const results: Record<string, { min: number; median: number }> = {}

    for (const op of OPS) {
      for (let i = 0; i < N_WARMUP; i++) {
        if (op.pre) await runOp(op.pre)
        await runOp(op.id)
      }

      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })

      const times: number[] = []
      for (let i = 0; i < N_RUNS; i++) {
        if (op.pre) await runOp(op.pre)
        times.push(await runOp(op.id))
      }

      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

      times.sort((a, b) => a - b)
      results[op.id] = {
        min: times[0]!,
        median: times[Math.floor(times.length / 2)]!,
      }
    }

    allResults[fw.name] = results
    await context.close()
    await server.close()
  }

  await browser.close()

  // Print comparison table
  console.log()
  console.log(`=== Performance Comparison (Chromium, ${CPU_THROTTLE}× throttle, median ms) ===`)
  console.log()

  const names = Object.keys(allResults)
  const header = 'Operation'.padEnd(16) + names.map((n) => n.padStart(12)).join('')
  console.log(header)
  console.log('-'.repeat(header.length))

  for (const op of OPS) {
    let line = op.label.padEnd(16)
    for (const name of names) {
      const r = allResults[name]?.[op.id]
      line += r ? r.median.toFixed(1).padStart(12) : '         N/A'
    }
    console.log(line)
  }

  console.log()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
