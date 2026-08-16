import type { BenchmarkProvenance } from './benchmark-baseline'

function text(value: unknown, fallback = 'not recorded'): string {
  return typeof value === 'string' && value !== '' ? value : fallback
}

function positiveInteger(value: unknown): string {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? String(value)
    : 'not recorded'
}

function shortCommit(value: unknown): string {
  const commit = text(value)
  return commit === 'not recorded' ? commit : `\`${commit.slice(0, 12)}\``
}

export function formatBenchmarkMethodology(provenance: BenchmarkProvenance): string {
  const browser = text(provenance.browser)
  const browserMode =
    typeof provenance.headless === 'boolean'
      ? `${browser} (${provenance.headless ? 'headless' : 'headful'})`
      : browser

  const lines = [
    `- **Browser:** ${browserMode}, CPU throttling 4×`,
    `- **Sampling:** ${positiveInteger(provenance.runs)} passes; CPU ${positiveInteger(provenance.cpuIterations)}, memory ${positiveInteger(provenance.memoryIterations)}, size ${positiveInteger(provenance.sizeIterations)} iterations per pass; median-of-medians reported`,
    `- **Machine:** ${text(provenance.machine)}`,
    `- **LLui commit:** ${shortCommit(provenance.gitCommit)}`,
    `- **JFB commit:** ${shortCommit(provenance.jfbCommit)}`,
    `- **Captured:** ${text(provenance.savedAt)}`,
  ]
  if (provenance.status === 'legacy') {
    lines.push(`- **Legacy capture:** ${text(provenance.note)}`)
  }
  return lines.join('\n')
}
