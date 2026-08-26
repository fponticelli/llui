import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
// @ts-expect-error -- plain-JS script helpers, consumed by the repo's own tooling
import { extractClassCandidates, isPureReExport } from '../lib/registry-classes.mjs'
// @ts-expect-error -- plain-JS script helpers, consumed by the repo's own tooling
import { appEntry, compileCandidates, selectorFor } from '../lib/tailwind-compile.mjs'

const ROOT = path.resolve(__dirname, '../..')
const REGISTRY = path.join(ROOT, 'registry/llui')
// The demo is in scope because it is the only in-repo consumer of the theme, and
// it is where the SECOND instance of this defect was found: `bg-surface-2` named
// a token that never existed in any version of theme.css, and had been rendering
// nothing for as long as it had been there.
const DEMO = path.join(ROOT, 'examples/components-demo/src')

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out.sort()
}

async function candidatesUnder(dir: string): Promise<Map<string, string[]>> {
  const byFile = new Map<string, string[]>()
  for (const file of await sourceFiles(dir)) {
    const source = await readFile(file, 'utf8')
    byFile.set(path.relative(dir, file), extractClassCandidates(file, source))
  }
  return byFile
}

const allCandidates = (): Promise<Map<string, string[]>> => candidatesUnder(REGISTRY)

describe('registry Tailwind classes', () => {
  it('emits at least one class candidate per ui component', async () => {
    // Guards the check itself: an extractor that silently stopped reading a
    // recipe position would make the compile assertion below vacuously pass.
    // Scoped to `ui/`: `lib/utils.ts` DEFINES `cn`/`mergeClass` and legitimately
    // emits no classes of its own.
    const byFile = await allCandidates()
    const ui = [...byFile].filter(([file]) => file.startsWith('ui'))
    expect(ui.length).toBeGreaterThan(10)
    for (const [file, candidates] of ui) {
      if (candidates.length > 0) continue
      // A pure re-export module (context-menu is the dropdown's recipes under
      // other names) legitimately declares none. That has to be PROVEN from the
      // module's shape — accepting any empty result would switch the guard off
      // the moment a real recipe became unreadable.
      const source = await readFile(path.join(REGISTRY, file), 'utf8')
      expect(
        isPureReExport(file, source),
        `${file} produced no class candidates and is not a pure re-export`,
      ).toBe(true)
    }
  })

  it('every class the registry emits produces real CSS', async () => {
    const byFile = await allCandidates()
    const all = [...new Set([...byFile.values()].flat())].sort()
    const { dead } = await compileCandidates(all)

    const blame = dead.map((c) => {
      const files = [...byFile].filter(([, list]) => list.includes(c)).map(([f]) => f)
      return `  ${c}  (${files.join(', ')})`
    })
    expect(
      dead,
      `These classes compile to NO CSS against packages/components/src/styles/theme.css:\n${blame.join('\n')}`,
    ).toEqual([])
  })

  it('detects a class that produces no CSS', async () => {
    // The check above is only worth its runtime if it can fail. A namespace
    // typo of exactly the shape that shipped before (`z-dialog` written against
    // `--z-*` instead of `--z-index-*`) must be reported.
    const { dead } = await compileCandidates(['bg-card', 'z-nonexistent-layer', 'duration-fast'])
    expect(dead).toEqual(['z-nonexistent-layer'])
  })

  it('every class the components demo emits produces real CSS', async () => {
    const byFile = await candidatesUnder(DEMO)
    const all = [...new Set([...byFile.values()].flat())].sort()
    // Compiled against the demo's OWN entry CSS, not the theme alone: app code
    // mixes utilities with hand-written classes (`.demo-section`), and both are
    // legitimately "defined". Only a class no rule anywhere defines is dead.
    const { dead } = await compileCandidates(all, appEntry(path.join(DEMO, 'main.css')))

    const blame = dead.map((c) => {
      const files = [...byFile].filter(([, list]) => list.includes(c)).map(([f]) => f)
      return `  ${c}  (${files.join(', ')})`
    })
    expect(dead, `These classes compile to NO CSS against the theme:\n${blame.join('\n')}`).toEqual(
      [],
    )
  })

  it('escapes selectors the way Tailwind does', async () => {
    expect(selectorFor('data-[state=open]:bg-muted')).toBe('.data-\\[state\\=open\\]\\:bg-muted')
    const { dead } = await compileCandidates(['bg-black/50', 'data-[state=open]:bg-muted'])
    expect(dead).toEqual([])
  })
})
