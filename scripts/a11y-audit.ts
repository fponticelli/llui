/**
 * Accessibility audit — runs axe-core against the components demo via Playwright.
 * Usage: npx tsx scripts/a11y-audit.ts
 */
import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { resolve, extname } from 'path'

const DEMO_DIR = resolve(import.meta.dirname!, '..', 'examples', 'components-demo', 'dist')
const AXE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
}

// Simple static file server
function serve(dir: string, port: number): Promise<ReturnType<typeof createServer>> {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      let path = req.url?.split('?')[0] ?? '/'
      if (path === '/') path = '/index.html'
      const file = resolve(dir, '.' + path)
      if (!existsSync(file)) {
        res.writeHead(404)
        res.end()
        return
      }
      const ext = extname(file)
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' })
      res.end(readFileSync(file))
    })
    server.listen(port, () => ok(server))
  })
}

async function main() {
  const server = await serve(DEMO_DIR, 4173)
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  await page.goto('http://localhost:4173', { waitUntil: 'networkidle' })

  // Inject axe-core
  await page.addScriptTag({ url: AXE_CDN })
  await page.waitForFunction(
    () => typeof (globalThis as Record<string, unknown>).axe !== 'undefined',
  )

  // Run axe
  const results = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axe = (globalThis as any).axe
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
    })
    return {
      violations: result.violations.map(
        (v: {
          id: string
          impact: string
          description: string
          helpUrl: string
          nodes: { html: string; failureSummary: string }[]
        }) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          helpUrl: v.helpUrl,
          count: v.nodes.length,
          examples: v.nodes.slice(0, 3).map((n: { html: string; failureSummary: string }) => ({
            html: n.html.slice(0, 200),
            summary: n.failureSummary,
          })),
        }),
      ),
      passes: result.passes.length,
      incomplete: result.incomplete.length,
    }
  })

  await browser.close()
  server.close()

  // Report
  console.log(`\n=== Accessibility Audit ===\n`)
  console.log(`Passed: ${results.passes} rules`)
  console.log(`Incomplete: ${results.incomplete} rules`)
  console.log(`Violations: ${results.violations.length} rules\n`)

  if (results.violations.length === 0) {
    console.log('No violations found!')
    return
  }

  for (const v of results.violations) {
    const icon =
      v.impact === 'critical'
        ? '🔴'
        : v.impact === 'serious'
          ? '🟠'
          : v.impact === 'moderate'
            ? '🟡'
            : '⚪'
    console.log(`${icon} ${v.id} (${v.impact}) — ${v.count} instance(s)`)
    console.log(`  ${v.description}`)
    console.log(`  ${v.helpUrl}`)
    for (const ex of v.examples) {
      console.log(`  → ${ex.html}`)
      console.log(`    ${ex.summary}`)
    }
    console.log()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
