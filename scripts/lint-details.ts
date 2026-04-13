import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'
import { lintIdiomatic } from '../packages/lint-idiomatic/dist/index.js'

const EXAMPLES_DIR = resolve(import.meta.dirname!, '../examples')
const ruleFilter = process.argv[2]

function findTsFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) findTsFiles(full, files)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) files.push(full)
  }
  return files
}

for (const f of findTsFiles(EXAMPLES_DIR)) {
  const source = readFileSync(f, 'utf-8')
  const result = lintIdiomatic(source, f)
  const matching = ruleFilter
    ? result.violations.filter((v) => v.rule === ruleFilter)
    : result.violations
  if (matching.length === 0) continue
  const rel = f.replace(EXAMPLES_DIR, 'examples')
  for (const v of matching) {
    console.log(`${rel}:${v.line}:${v.column}  [${v.rule}]  ${v.message}`)
    if (v.suggestion) console.log(`  → ${v.suggestion}`)
  }
}
