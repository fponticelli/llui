import { execSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const distDir = join(import.meta.dirname, 'dist/assets')

let totalRaw = 0
let totalGz = 0
let chunkCount = 0

for (const file of readdirSync(distDir)) {
  if (!file.endsWith('.js')) continue
  const path = join(distDir, file)
  const raw = statSync(path).size
  const gz = parseInt(execSync(`gzip -9c "${path}" | wc -c`).toString().trim(), 10)

  totalRaw += raw
  totalGz += gz
  chunkCount++

  console.log(`  ${file}: raw=${raw} B  gzip=${gz} B`)
}

console.log()
console.log(`  TOTAL: raw=${totalRaw} B  gzip=${totalGz} B  chunks=${chunkCount}`)
