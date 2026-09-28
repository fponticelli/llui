/**
 * axe-core, injected from the pinned devDependency (never a CDN: a network
 * fetch mid-audit is flaky, unpinnable and offline-hostile — the same reason
 * `scripts/a11y-audit.ts` gives), run against a live document.
 *
 * The gate fails on `serious` and `critical` impact. Each finding is
 * reported with its rule, impact, help text, the offending selector and
 * axe's own failure summary, so a red case says what to fix and where.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { AxeResults, ImpactValue, RunOptions } from 'axe-core'
import type { Page } from 'playwright'

declare global {
  interface Window {
    /** axe-core's global, present only in a document `runAxe` injected `AXE_SOURCE` into. */
    axe?: { run: (context: Document, options: RunOptions) => Promise<AxeResults> }
  }
}

const require = createRequire(import.meta.url)
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

/** WCAG 2.0/2.1/2.2 A + AA, plus axe's best practices. */
export const AXE_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
] as const

export const GATED_IMPACTS: readonly ImpactValue[] = ['serious', 'critical']

export interface AxeFinding {
  readonly rule: string
  readonly impact: ImpactValue
  readonly help: string
  readonly target: string
  readonly summary: string
}

export interface AxeReport {
  readonly findings: readonly AxeFinding[]
  /** Vacuity: how many rules produced a pass on this document. */
  readonly passedRules: number
}

export async function runAxe(page: Page): Promise<AxeReport> {
  const injected = await page.evaluate(() => 'axe' in globalThis)
  if (!injected) await page.addScriptTag({ content: AXE_SOURCE })
  const options: RunOptions = {
    runOnly: { type: 'tag', values: [...AXE_TAGS] },
    resultTypes: ['violations'],
    // Each path document is audited as its OWN case; auditing the shell
    // must not re-audit (or half-audit, uninjected) the documents it frames.
    iframes: false,
  }
  return page.evaluate(
    async ({ options, gated }) => {
      const axe = window.axe
      if (axe === undefined) throw new Error('axe-core is not injected into this document')
      const results = await axe.run(document, options)
      const findings = results.violations
        .filter(({ impact }) => impact !== undefined && impact !== null && gated.includes(impact))
        .flatMap((violation) =>
          violation.nodes.map((node) => ({
            rule: violation.id,
            impact: violation.impact!,
            help: violation.help,
            target: node.target.map(String).join(' '),
            summary: (node.failureSummary ?? '').replace(/\s*\n\s*/g, ' '),
          })),
        )
      return { findings, passedRules: results.passes.length }
    },
    { options, gated: [...GATED_IMPACTS] },
  )
}

export function formatAxeFinding(finding: AxeFinding): string {
  return `axe ${finding.rule} (${finding.impact}) at ${finding.target}: ${finding.help} — ${finding.summary}`
}
