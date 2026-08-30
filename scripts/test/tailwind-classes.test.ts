import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  extractClassCandidates,
  extractHtmlClassCandidates,
  isPureReExport,
} from '../lib/registry-classes.mjs'
import {
  appEntry,
  compileCandidates,
  markerName,
  markerReferences,
  selectorFor,
} from '../lib/tailwind-compile.mjs'

const ROOT = path.resolve(__dirname, '../..')
const REGISTRY = path.join(ROOT, 'registry/llui')
// Both in-repo consumers of the theme. `components-demo` is where the SECOND
// instance of the dead-class defect was found (`bg-surface-2` named a token that
// never existed in any version of theme.css); `registry-demo` was outside this
// check entirely until the icon work, so its own classes went unverified.
//
// Named by their ROOT so both halves of an app are reachable: `src/` (TypeScript
// recipes) and `index.html` (the entry point, unread by anything until #251 —
// three dead classes sat on its `<body>` and `<p>` for a release).
const DEMOS = [
  path.join(ROOT, 'examples/components-demo'),
  path.join(ROOT, 'examples/registry-demo'),
]

/**
 * Modules that legitimately declare NO class recipe, with the reason.
 *
 * `icons.ts` renders the Lucide glyphs shadcn bakes into its components, and
 * deliberately carries no size class of its own — every recipe sizes them with
 * `[&_svg:not([class*='size-'])]:size-4`, which applies only when the icon has
 * not sized itself. A size here would silently beat every recipe.
 *
 * The exemption is CHECKED, not asserted: the test requires these files to have
 * exactly zero candidates, so adding a recipe to one fails until it is removed
 * from this list.
 */
const RECIPE_FREE = new Set(['ui/icons.ts'])

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

/**
 * Every class an APP emits: its TypeScript recipes under `src/`, plus the
 * `class="…"` attributes on its HTML entry point.
 *
 * ONE function, shared by the real-demo assertion and the fixture below, because
 * the merge of `index.html` into the compiled set is itself a thing that can
 * silently stop happening. A mutation deleting that merge survived every
 * assertion in this file while the extractor's own unit tests stayed green —
 * proving the extractor reads HTML says nothing about whether the compile step
 * is handed what it read.
 */
async function appCandidates(appRoot: string): Promise<Map<string, string[]>> {
  const byFile = await candidatesUnder(path.join(appRoot, 'src'))
  const html = path.join(appRoot, 'index.html')
  // Keyed under its own name so a failure blames `index.html`, not a `.ts`.
  byFile.set('index.html', extractHtmlClassCandidates(html, await readFile(html, 'utf8')))
  return byFile
}

/** The dead classes among an app's candidates, compiled against its OWN entry CSS. */
async function deadIn(byFile: Map<string, string[]>, cssEntry: string): Promise<string[]> {
  const all = [...new Set([...byFile.values()].flat())].filter((c) => markerName(c) === null).sort()
  // Compiled against the app's OWN entry CSS, not the theme alone: app code
  // mixes utilities with hand-written classes (`.demo-section`), and both are
  // legitimately "defined". Only a class no rule anywhere defines is dead.
  const { dead } = await compileCandidates(all, appEntry(cssEntry))
  return dead
}

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
      if (RECIPE_FREE.has(file)) {
        expect(candidates, `${file} is listed as recipe-free but declares classes`).toEqual([])
        continue
      }
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

  it('every group-…/name: variant has a matching marker', async () => {
    // `group/name` and `peer/name` emit NO rule — they exist only to be
    // referenced by a `group-…/name:` variant on a descendant, so compiling
    // cannot check them and they are excluded from the dead-class assertion.
    //
    // The check runs from the REFERENCE side, not the declaration side, because
    // only that direction is always a bug: a `group-data-[x]/typo:` with no
    // `group/typo` anywhere is CSS that can never match. The reverse — a marker
    // nobody references — is legitimate and upstream does it deliberately
    // (`group/calendar`, `group/item-group` are hooks for the CONSUMER's own
    // classes), so flagging it would fail on a faithful port.
    const byFile = await allCandidates()
    const dangling: string[] = []
    for (const [file, candidates] of byFile) {
      const declared = new Set(candidates.map(markerName).filter((n: string | null) => n !== null))
      for (const candidate of candidates) {
        for (const name of markerReferences(candidate)) {
          if (!declared.has(name))
            dangling.push(`${file}: ${candidate} (no group/${name} declared)`)
        }
      }
    }
    expect(
      dangling,
      `These variants reference a marker their file never declares:\n${dangling.join('\n')}`,
    ).toEqual([])
  })

  it('every class the registry emits produces real CSS', async () => {
    const byFile = await allCandidates()
    const all = [...new Set([...byFile.values()].flat())]
      .filter((c) => markerName(c) === null)
      .sort()
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

  it.each(DEMOS)('every class %s emits produces real CSS', async (DEMO: string) => {
    const byFile = await appCandidates(DEMO)
    const dead = await deadIn(byFile, path.join(DEMO, 'src/main.css'))
    const blame = dead.map((c) => {
      const files = [...byFile].filter(([, list]) => list.includes(c)).map(([f]) => f)
      return `  ${c}  (${files.join(', ')})`
    })
    expect(dead, `These classes compile to NO CSS against the theme:\n${blame.join('\n')}`).toEqual(
      [],
    )
  })

  it('reports a dead class that exists ONLY in an app index.html', async () => {
    // The assertion above is only worth its runtime if a dead class in the HTML
    // half can reach it. A fixture app, run through the SAME `deadIn` the demos
    // use, is what makes that checkable: `bg-surface-muted` and `text-text` are
    // two of the three classes that really sat in `components-demo/index.html`,
    // and `bg-background` / `mx-auto` beside them are live, so the fixture pins
    // both directions at once.
    const app = await mkdtemp(path.join(tmpdir(), 'llui-html-classes-'))
    try {
      await mkdir(path.join(app, 'src'))
      // The demos' own entry, so `bg-background` resolves the way it does there.
      await writeFile(
        path.join(app, 'src/main.css'),
        ['@import "tailwindcss";', '@import "@llui/components/styles/theme.css";'].join('\n'),
      )
      await writeFile(
        path.join(app, 'index.html'),
        '<body class="bg-background bg-surface-muted"><p class="mx-auto text-text"></p></body>',
      )
      const dead = await deadIn(await appCandidates(app), path.join(app, 'src/main.css'))
      expect(dead).toEqual(['bg-surface-muted', 'text-text'])
    } finally {
      await rm(app, { recursive: true, force: true })
    }
  })

  it.each(DEMOS)('reads class candidates out of %s/index.html', async (DEMO: string) => {
    // Vacuity guard, the same one `emits at least one class candidate per ui
    // component` provides for the TS side: an extractor that silently stopped
    // reading `class="…"` would make the compile assertion above pass over an
    // empty set. Both entry points carry classes on `<body>` today.
    const html = path.join(DEMO, 'index.html')
    const candidates = await readFile(html, 'utf8').then((s) => extractHtmlClassCandidates(html, s))
    expect(candidates.length).toBeGreaterThan(5)
    expect(candidates).toContain('bg-background')
  })

  it('reads only quoted class attributes, and not comments or script bodies', () => {
    const html = [
      '<!doctype html>',
      '<!-- bg-surface-muted lived here; <p class="from-comment"> must not count -->',
      '<body class="bg-background text-foreground">',
      "  <p class='mt-1 text-muted-foreground'>hi</p>",
      '  <span data-class="not-a-class" classy="nope">x</span>',
      '  <script>const s = \'<div class="from-script">\'</script>',
      // A CSS attribute selector is the `<style>` half of the same trap. The
      // space after `[` is legal CSS (the grammar allows whitespace there) and
      // is what makes the text indistinguishable from a real class attribute —
      // without it the leading-`\s` boundary alone would already reject it, and
      // this fixture would say nothing about the `<style>` strip.
      '  <style>[ class="from-style" ] { color: red }</style>',
      '</body>',
    ].join('\n')
    expect(extractHtmlClassCandidates('index.html', html)).toEqual([
      'bg-background',
      'mt-1',
      'text-foreground',
      'text-muted-foreground',
    ])
  })

  it('escapes selectors the way Tailwind does', async () => {
    expect(selectorFor('data-[state=open]:bg-muted')).toBe('.data-\\[state\\=open\\]\\:bg-muted')
    const { dead } = await compileCandidates(['bg-black/50', 'data-[state=open]:bg-muted'])
    expect(dead).toEqual([])
  })
})
