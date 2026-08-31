#!/usr/bin/env node

// Publish @llui/components' CSS exports as an exact set. A plain glob copy
// leaves deleted or renamed modules in dist/styles, where npm will keep
// shipping them. Validate every source/export relationship before reconciling
// the CSS artifacts so a malformed manifest cannot produce a partial set.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COMPONENTS = path.join(ROOT, 'packages/components')
const SOURCE = path.join(COMPONENTS, 'src/styles')
const PUBLISHED = path.join(COMPONENTS, 'dist/styles')

/** @type {unknown} */
const parsed = JSON.parse(readFileSync(path.join(COMPONENTS, 'package.json'), 'utf8'))
const manifest = /** @type {{ exports?: Record<string, unknown> }} */ (parsed)
if (manifest.exports === undefined) throw new Error('@llui/components has no exports map')

const declared = Object.entries(manifest.exports)
  .filter(
    ([key, target]) =>
      key.startsWith('./styles/') && typeof target === 'string' && target.endsWith('.css'),
  )
  .map(([key, target]) => {
    const file = key.slice('./styles/'.length)
    if (!/^[a-z0-9-]+\.css$/.test(file))
      throw new Error(`invalid public stylesheet filename: ${file}`)
    const expected = `./dist/styles/${file}`
    if (target !== expected)
      throw new Error(`stylesheet export ${key} must target ${expected}, got ${String(target)}`)
    return file
  })
  .sort()

if (declared.length === 0) throw new Error('@llui/components exports no public stylesheets')

const sourceFiles = readdirSync(SOURCE)
  .filter((file) => file.endsWith('.css'))
  .sort()
if (JSON.stringify(sourceFiles) !== JSON.stringify(declared)) {
  throw new Error(
    `public stylesheet source/export mismatch\nsource: ${sourceFiles.join(', ')}\nexports: ${declared.join(', ')}`,
  )
}

/** @type {Array<[string, string]>} */
const contents = declared.map((file) => [file, readFileSync(path.join(SOURCE, file), 'utf8')])
mkdirSync(PUBLISHED, { recursive: true })
for (const file of readdirSync(PUBLISHED)) {
  if (file.endsWith('.css')) rmSync(path.join(PUBLISHED, file), { force: true })
}
for (const [file, content] of contents) writeFileSync(path.join(PUBLISHED, file), content)

console.log(
  `components: published ${declared.length} stylesheets to packages/components/dist/styles`,
)
