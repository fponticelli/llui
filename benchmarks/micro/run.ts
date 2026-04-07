/**
 * Run micro-benchmarks in a real browser via Playwright.
 *
 * Usage:
 *   npx tsx benchmarks/micro/run.ts                    # run all .html files
 *   npx tsx benchmarks/micro/run.ts check-vs-apply     # run a specific one
 */
import { chromium } from 'playwright'
import { readFileSync, readdirSync } from 'fs'
import { resolve, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const target = process.argv[2]

async function run(file: string) {
  const name = basename(file, '.html')
  console.log(`\n=== ${name} ===\n`)

  const html = readFileSync(file, 'utf-8')

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  // Load the benchmark HTML directly (no server needed)
  await page.setContent(html, { waitUntil: 'domcontentloaded' })

  // Wait for results
  await page.waitForSelector('#json-results', { timeout: 120_000 })
  const json = await page.$eval('#json-results', (el) => el.textContent ?? '{}')
  const results = JSON.parse(json) as Record<string, number>

  // Print formatted table
  const keys = Object.keys(results)
  const maxKeyLen = Math.max(...keys.map((k) => k.length))
  for (const [key, value] of Object.entries(results)) {
    console.log(`  ${key.padEnd(maxKeyLen)}  ${(value as number).toFixed(3)} ms`)
  }

  await browser.close()
  return results
}

// Discover files
const files = target
  ? [resolve(__dirname, `${target}.html`)]
  : readdirSync(__dirname)
      .filter((f) => f.endsWith('.html'))
      .map((f) => resolve(__dirname, f))

for (const file of files) {
  await run(file)
}
