import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  INTERNAL_TAG,
  MIN_TAG_MENTIONS,
  freeTypeNames,
  globalTypeNames,
  misplacedInternalTags,
  stripInternalPackages,
  walkTs,
} from '../lib/dist-type-bindings.mjs'

// Guard for #253: `stripInternal` deleted `packages/lexical/src/nodewidget.ts`'s
// `import { … } from 'lexical'` from the emitted `.d.ts`, because the module's
// 80-line `//` header mentioned the internal JSDoc tag in PROSE and TypeScript's
// test for that tag is a raw substring search over every leading comment range.
//
// The DIST arm of this guard runs in `pnpm check:dist` (it needs a build, which
// CI guarantees by ordering `Dist integrity` after `Build`). This file tests the
// ANALYZERS — which need no build — and owns the SOURCE arm's corpus sweep,
// which is buildless too.
//
// Read `scripts/lib/dist-type-bindings.mjs`'s header before changing either
// arm: it records why the dist arm is structural rather than a `tsc` run (a
// `tsc` run is GREEN under this repo's `skipLibCheck: true`), and why the two
// arms cannot be collapsed into one.

const ROOT = join(import.meta.dirname, '../..')

// Cheap stand-in for the real global set in the unit tests below; the corpus
// sweep is the dist arm's job and lives in `check:dist`.
const GLOBALS = new Set(['string', 'number', 'boolean', 'Array', 'Promise'])

const free = (src: string) =>
  freeTypeNames(ROOT, 'probe.d.ts', src, GLOBALS).free.map((f: { name: string }) => f.name)

describe('dist arm: every referenced type name is bound', () => {
  it('reports a name whose import was deleted — #253 reduced', () => {
    // Exactly what the emitted nodewidget.d.ts looked like: references, no import.
    expect(free('export interface Bar { f: Foo }\n')).toEqual(['Foo'])
  })

  it('is silent when the import survives', () => {
    expect(free("import type { Foo } from './foo.js'\nexport interface Bar { f: Foo }\n")).toEqual(
      [],
    )
  })

  it('accepts every binder form a .d.ts can use', () => {
    expect(
      free(`
        import Def from 'a'
        import * as NS from 'b'
        import { X as Y } from 'c'
        type Alias = string
        declare class K {}
        declare enum E { A }
        declare function f(): void
        declare const v: number
        export interface Uses<T> {
          a: Def; b: NS.Thing; c: Y; d: Alias; e: K; g: E; h: typeof f; i: typeof v; j: T
        }
      `),
    ).toEqual([])
  })

  it('resolves a qualified name through its LEFTMOST identifier', () => {
    // `NS.Deep.Thing` needs `NS` bound and says nothing about `Deep`/`Thing`.
    expect(free('export interface P { a: NS.Deep.Thing }\n')).toEqual(['NS'])
    expect(free("import * as NS from 'x'\nexport interface P { a: NS.Deep.Thing }\n")).toEqual([])
  })

  // KNOWN LIMIT, not a feature. An inline import type binds nothing, so this arm
  // has nothing to check and says nothing — including when the SPECIFIER does not
  // resolve, which is the commonest way a published `.d.ts` breaks a consumer
  // after an unbound name. `@llui/vite-plugin` ships exactly that today
  // (`import("rolldown").TransformPluginContext` x6, unresolvable under Bundler,
  // NodeNext and Node10 alike), and this arm is green on it. The
  // `examples/markdown-editor` type-check that originally surfaced #253 DID catch
  // that class, so this guard is NOT a superset of the canary it replaced.
  // Closing it means resolving specifiers; tracked as #257.
  it('says nothing about an inline import type, resolvable or not (KNOWN LIMIT)', () => {
    expect(free("export interface P { a: import('lexical').LexicalNode }\n")).toEqual([])
    expect(free("export interface P { a: import('no-such-module-anywhere').Nope }\n")).toEqual([])
  })

  it('checks heritage clauses, not just member types', () => {
    expect(free('export interface P extends Base {}\n')).toEqual(['Base'])
  })

  it('treats ambient globals as bound', () => {
    expect(free('export interface P { a: Promise<string> }\n')).toEqual([])
  })

  it('reports each distinct free name once', () => {
    expect(free('export interface P { a: Foo; b: Foo; c: Bar }\n').sort()).toEqual(['Bar', 'Foo'])
  })
})

describe('source arm: the internal tag is an annotation, never prose', () => {
  const tags = (src: string) =>
    misplacedInternalTags(ROOT, 'probe.ts', src).map((t: { kind: string }) => t.kind)

  it('reports the tag in a // header — #253 exactly', () => {
    expect(
      tags(
        `// A module header.\n//\n// It mentions ${INTERNAL_TAG} in PROSE.\n\nimport type { Foo } from './foo.js'\nexport interface Bar { f: Foo }\n`,
      ),
    ).toEqual(['line-comment'])
  })

  it('STILL reports it when the header is moved below the imports', () => {
    // This is the fix issue #253 itself suggested, and it is worse than the bug:
    // measured against tsc, the header then attaches to `Bar` and stripInternal
    // deletes that exported interface outright. Nothing in that file references
    // `Bar`, so the emitted `.d.ts` is perfectly WELL-BOUND and merely missing
    // an export — the dist arm sees nothing and only this arm catches it. (When
    // the deleted declaration does still have a surviving reference, as
    // `WidgetPlacement` does in nodewidget.ts, both arms fire; that is luck, not
    // coverage, which is why this arm is not redundant.)
    expect(
      tags(
        `import type { Foo } from './foo.js'\n\n// A module header.\n// It mentions ${INTERNAL_TAG} in PROSE.\n\nexport interface Bar { f: Foo }\n`,
      ),
    ).toEqual(['line-comment'])
  })

  it('allows a genuine JSDoc annotation in both spellings the repo uses', () => {
    // `/** @internal Runtime-only … */` (tea-driver.ts) and a ` * @internal`
    // line inside a longer block (dom-env.ts, mapping.ts, nodewidget.ts).
    expect(
      tags(`/** ${INTERNAL_TAG} Runtime-only controls. */\nexport interface P { a: string }\n`),
    ).toEqual([])
    expect(
      tags(
        `/**\n * Assert the bijection holds.\n *\n * ${INTERNAL_TAG}\n */\nexport interface P { a: string }\n`,
      ),
    ).toEqual([])
    expect(
      tags(`export interface P {\n  /** ${INTERNAL_TAG} */ readonly __spec: string\n}\n`),
    ).toEqual([])
  })

  it('reports the tag written as prose INSIDE a JSDoc block', () => {
    expect(
      tags(
        `/**\n * Lexical marks this ${INTERNAL_TAG}, so the shape may change.\n */\nexport interface P { a: string }\n`,
      ),
    ).toEqual(['jsdoc-prose'])
  })

  it('is silent on a file that never mentions the tag', () => {
    expect(tags('// An ordinary header.\nexport interface P { a: string }\n')).toEqual([])
  })
})

describe('the repo corpus', () => {
  const packages: string[] = stripInternalPackages(ROOT)

  it('finds the stripInternal packages', () => {
    // Exact set: a package silently losing the setting changes what ships, and
    // a floor could not tell that from the walk over-collecting.
    expect([...packages].sort()).toEqual([
      'dom',
      'lexical',
      'lexical-collab',
      'lexical-loro',
      'markdown-editor',
    ])
  })

  it('has no misplaced internal tag in any stripInternal package', () => {
    let scanned = 0
    let mentioning = 0
    const problems: string[] = []
    for (const pkg of packages) {
      for (const file of walkTs(join(ROOT, 'packages', pkg, 'src'))) {
        scanned++
        const text = readFileSync(file, 'utf8')
        if (!text.includes(INTERNAL_TAG)) continue
        mentioning++
        for (const t of misplacedInternalTags(ROOT, file, text) as { line: number }[])
          problems.push(`${file.replace(ROOT + '/', '')}:${t.line}`)
      }
    }
    // Vacuity, both directions: the walk must have found the corpus, AND it must
    // have found files that genuinely spell the tag — otherwise a scan that
    // stopped matching would report a clean sheet.
    expect(scanned).toBeGreaterThan(50)
    // Imported, not hardcoded: this is the SAME floor `check-dist.mjs` applies to
    // its pre-filter, and the constant's contract is that both consumers move
    // together. Hardcoding it here lets the gate be raised while this silently
    // keeps the old number.
    expect(mentioning).toBeGreaterThanOrEqual(MIN_TAG_MENTIONS)
    expect(problems).toEqual([])
  })
})

describe('the globals probe', () => {
  it('resolves the lib and node globals it is relied on for', () => {
    const globals: Set<string> = globalTypeNames(ROOT)
    // Without these the dist arm reports every ordinary reference as free.
    for (const n of ['Array', 'Promise', 'Record', 'HTMLElement', 'Node', 'Buffer', 'Uint8Array'])
      expect(globals.has(n), `global ${n}`).toBe(true)
    expect(globals.size).toBeGreaterThan(500)
    // And it must not be a rubber stamp that would swallow a real free name.
    expect(globals.has('LexicalNode')).toBe(false)
  })
})
