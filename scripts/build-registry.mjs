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

/**
 * One entry in a registry item's `files` array. The registry format is a
 * deliberate SUBSET of shadcn's `registry-item.json` and unknown keys are
 * carried through verbatim, so the shape is open.
 * @typedef {{ path: string, content?: string } & Record<string, unknown>} RegistryFile
 */

/**
 * One registry item (a component and the files `llui add` copies for it).
 * @typedef {{ name: string, files: RegistryFile[] } & Record<string, unknown>} RegistryItem
 */

/**
 * `registry/registry.json` — the index plus every item.
 * @typedef {{ items: RegistryItem[] } & Record<string, unknown>} Registry
 */

/** @type {unknown} */
const parsedRegistry = JSON.parse(await readFile(SOURCE, 'utf8'))
const registry = /** @type {Registry} */ (parsedRegistry)

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

/** @type {RegistryItem[]} */
const indexItems = []
const index = { ...registry, items: indexItems }

for (const item of registry.items) {
  /** @type {RegistryFile[]} */
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
