import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { extractClassCandidates } from '../lib/registry-classes.mjs'
import { compileCandidates, REGISTRY_TAILWIND_ENTRY } from '../lib/tailwind-compile.mjs'
import { parseSpec } from '../lib/registry-dependencies.mjs'

/**
 * Every registry item whose OWN recipes use a `tw-animate-css` class declares
 * `tw-animate-css` as a dependency — and no other item does.
 *
 * `animate-in` / `fade-in-0` / `zoom-in-95` / `slide-in-from-*` are not
 * Tailwind core; they are the enter/exit vocabulary of every shadcn overlay and
 * compile only when the consumer's stylesheet imports `tw-animate-css`. Until
 * this gate, no item declared it, so `llui add dialog` printed an Install line
 * without the package its skin cannot animate without, and only prose (the CLI
 * README, `llui init`'s stylesheet hint) mentioned it.
 *
 * The REQUIRED set is derived, never listed: every class each item's files emit
 * (the Tailwind guard's own extractor) is compiled twice with the real Tailwind
 * build — against the registry entry, and against the same entry WITHOUT its
 * `tw-animate-css` import — and a class that produces a rule only in the first
 * is a `tw-animate-css` class. The DECLARED set is read from
 * `registry/registry.json` (the source `llui add` reads in a checkout) and from
 * every served `site/public/r/*.json` (what it reads from llui.dev), and all
 * three must be equal. The declaration is written in the source rather than
 * injected by the build because a checkout's `llui add` reads the source
 * directly: an injected-only dependency would make the two registries disagree
 * about what to install.
 */

const ROOT = path.resolve(__dirname, '../..')
const PACKAGE = 'tw-animate-css'
const TW_ANIMATE_IMPORT = '@import "tw-animate-css";'

interface Item {
  name: string
  dependencies?: string[]
  files: { path: string }[]
}

function readJson<T>(rel: string): T {
  const parsed: unknown = JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'))
  return parsed as T
}

const declares = (item: Item): boolean =>
  (item.dependencies ?? []).some((spec) => parseSpec(spec).name === PACKAGE)

const source = readJson<{ items: Item[] }>('registry/registry.json')

let classesByItem: Map<string, string[]>
let twAnimateClasses: Set<string>

beforeAll(async () => {
  classesByItem = new Map(
    source.items.map((item) => [
      item.name,
      [
        ...new Set(
          item.files.flatMap((file) =>
            extractClassCandidates(file.path, readFileSync(path.join(ROOT, file.path), 'utf8')),
          ),
        ),
      ],
    ]),
  )
  const all = [...new Set([...classesByItem.values()].flat())].sort()
  expect(REGISTRY_TAILWIND_ENTRY).toContain(TW_ANIMATE_IMPORT)
  const without = REGISTRY_TAILWIND_ENTRY.replace(TW_ANIMATE_IMPORT, '')
  const withIt = await compileCandidates(all)
  const withoutIt = await compileCandidates(all, without)
  const deadWith = new Set(withIt.dead)
  twAnimateClasses = new Set(withoutIt.dead.filter((c) => !deadWith.has(c)))
})

describe(`${PACKAGE} is declared by exactly the items whose classes need it`, () => {
  it('derives a real tw-animate-css vocabulary from the compile', () => {
    // Vacuity: the derivation must find the overlay enter/exit utilities (the
    // registry writes them behind state variants, `data-[state=open]:animate-in`),
    // and nothing Tailwind core already provides.
    const utilities = new Set([...twAnimateClasses].map((c) => c.slice(c.lastIndexOf(':') + 1)))
    for (const utility of ['animate-in', 'animate-out', 'fade-in-0', 'zoom-in-95']) {
      expect(utilities.has(utility), utility).toBe(true)
    }
    const all = new Set([...classesByItem.values()].flat())
    for (const cls of ['transition-all', 'outline-none', 'rounded-md']) {
      expect(all.has(cls), cls).toBe(true)
      expect(twAnimateClasses.has(cls), cls).toBe(false)
    }
  })

  it('the source registry declares it on exactly the items that use it', () => {
    const required = source.items
      .filter((item) => (classesByItem.get(item.name) ?? []).some((c) => twAnimateClasses.has(c)))
      .map((item) => item.name)
      .sort()
    const declared = source.items
      .filter(declares)
      .map((item) => item.name)
      .sort()
    expect(required.length).toBeGreaterThan(5)
    expect(declared).toEqual(required)
  })

  it('declares it BARE, like every other non-@llui package, and the build relays it untouched', () => {
    const served = readJson<{ items: Item[] }>('site/public/r/registry.json')
    for (const item of source.items) {
      const specs = (item.dependencies ?? []).filter((s) => parseSpec(s).name === PACKAGE)
      expect(specs, item.name).toEqual(declares(item) ? [PACKAGE] : [])
      const built = readJson<Item>(`site/public/r/${item.name}.json`)
      const indexed = served.items.find((i) => i.name === item.name)
      expect(
        built.dependencies?.filter((s) => parseSpec(s).name === PACKAGE),
        item.name,
      ).toEqual(specs)
      expect(
        indexed?.dependencies?.filter((s) => parseSpec(s).name === PACKAGE),
        item.name,
      ).toEqual(specs)
    }
  })
})
