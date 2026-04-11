import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { lintIdiomatic } from '../packages/lint-idiomatic/dist/index.js'

const dir = resolve(import.meta.dirname!, '../evaluation/examples')
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))

let total = 0
for (const f of files) {
  const source = readFileSync(join(dir, f), 'utf-8')
  const r = lintIdiomatic(source, f)
  total += r.violations.length
  const status = r.violations.length === 0 ? '✓' : '✗'
  const rules = r.violations.length
    ? `[${[...new Set(r.violations.map((v) => v.rule))].join(', ')}]`
    : ''
  console.log(`${status} ${f.padEnd(35)} ${r.violations.length} ${rules}`)
}
console.log(`\nTotal violations: ${total}`)
