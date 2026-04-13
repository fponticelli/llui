import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'
import { lintIdiomatic } from '../packages/lint-idiomatic/dist/index.js'

const EXAMPLES_DIR = resolve(import.meta.dirname!, '../examples')

function findTsFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      findTsFiles(full, files)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      files.push(full)
    }
  }
  return files
}

const byExample: Record<string, { files: number; violations: Record<string, number> }> = {}

for (const example of readdirSync(EXAMPLES_DIR)) {
  const exampleDir = join(EXAMPLES_DIR, example)
  if (!statSync(exampleDir).isDirectory()) continue
  const files = findTsFiles(exampleDir)
  const violations: Record<string, number> = {}
  for (const f of files) {
    const source = readFileSync(f, 'utf-8')
    const result = lintIdiomatic(source, f)
    for (const v of result.violations) {
      violations[v.rule] = (violations[v.rule] ?? 0) + 1
    }
  }
  byExample[example] = { files: files.length, violations }
}

console.log('Example              files  violations')
console.log('─'.repeat(70))
let totalViolations = 0
for (const [name, data] of Object.entries(byExample)) {
  const total = Object.values(data.violations).reduce((a, b) => a + b, 0)
  totalViolations += total
  const summary =
    total === 0
      ? '✓ clean'
      : Object.entries(data.violations)
          .map(([r, n]) => `${r}:${n}`)
          .join(', ')
  console.log(`${name.padEnd(20)} ${String(data.files).padStart(5)}  ${summary}`)
}
console.log('─'.repeat(70))
console.log(`Total violations: ${totalViolations}`)
