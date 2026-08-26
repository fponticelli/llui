#!/usr/bin/env node
// Build the LLui component registry into static JSON the CLI can fetch.
//
// Emits `site/public/r/registry.json` (the index, file contents STRIPPED so the
// listing stays small) plus one `site/public/r/<name>.json` per item with each
// file's content INLINED. `@llui/cli` reads either shape: inlined content for a
// remote registry, on-disk `path` for a local checkout — which is how the CLI's
// own tests run with no build step and no network.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.join(ROOT, 'registry', 'registry.json')
const OUT = path.join(ROOT, 'site', 'public', 'r')

const registry = JSON.parse(await readFile(SOURCE, 'utf8'))

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const index = { ...registry, items: [] }

for (const item of registry.items) {
  const files = []
  for (const file of item.files) {
    files.push({ ...file, content: await readFile(path.join(ROOT, file.path), 'utf8') })
  }
  await writeFile(
    path.join(OUT, `${item.name}.json`),
    JSON.stringify({ ...item, files }, null, 2) + '\n',
    'utf8',
  )
  // The index keeps the file LIST (names, types, targets) but not the bodies —
  // `llui list` only needs to name things, and inlining every component into the
  // index would make the common case the largest download.
  index.items.push({ ...item, files: item.files.map(({ content: _c, ...f }) => f) })
}

await writeFile(path.join(OUT, 'registry.json'), JSON.stringify(index, null, 2) + '\n', 'utf8')
console.log(`registry: wrote ${registry.items.length + 1} files to site/public/r`)
