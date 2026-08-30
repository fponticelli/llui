import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  INTERNAL_TAG,
  MIN_TAG_MENTIONS,
  PROBE_SIDE_EFFECT_TARGET,
  SEMANTIC_ALLOWED,
  semanticAllowanceIndex,
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
// The DIST and SEMANTIC arms run in `pnpm check:dist` (both need a build, which
// CI guarantees by ordering `Dist integrity` after `Build`). This file tests the
// ANALYZERS — which need no build — and owns the SOURCE arm's corpus sweep plus
// the semantic arm's allowlist SHAPE, both buildless.
//
// Read `scripts/lib/dist-type-bindings.mjs`'s header before changing any arm: it
// records what each one can and cannot see, why the structural dist arm survives
// the semantic one that subsumes its reports, and the allowlist discipline.

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

  // KNOWN LIMIT OF THIS ARM, and no longer a hole in the GATE. An inline import
  // type binds nothing, so this arm has nothing to check and says nothing —
  // including when the SPECIFIER does not resolve, which is the commonest way a
  // published `.d.ts` breaks a consumer after an unbound name. `@llui/vite-plugin`
  // shipped exactly that (`import("rolldown").X` x6, unresolvable under Bundler,
  // NodeNext and Node10 alike) with this arm green on it. #257 fixed those and
  // added the SEMANTIC arm — one program over every publishable `.d.ts` with
  // `skipLibCheck: false` — which covers this class; it needs a build, so like
  // the dist arm it runs in `pnpm check:dist` rather than here. This arm stays
  // deliberately narrow: it carries no allowlist, which the semantic arm does.
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
      for (const file of walkTs(join(ROOT, 'packages', pkg, 'src')) as string[]) {
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

// The SEMANTIC arm itself needs a build, so it runs in `pnpm check:dist` (which
// CI orders after `Build`) alongside the dist arm. What IS buildless is its
// allowlist's SHAPE, and that is the half a later edit gets wrong: the keying
// discipline is what stops one entry from switching a whole check off.
describe('semantic arm: the allowlist keying discipline', () => {
  it('keys every entry by file AND code, with a reason', () => {
    const seen = new Set<string>()
    for (const a of SEMANTIC_ALLOWED) {
      // A bare code excuses every occurrence in the repo — the shape
      // `scripts/test/registry-attrs.test.ts` measured as switching a check off.
      expect(typeof a.code, `code of ${a.file}`).toBe('number')
      expect(a.file, 'an allowance must name one emitted file').toMatch(
        /^packages\/[^/]+\/dist\/.+\.d\.ts$/,
      )
      // A reason is what makes an obsolete entry recognizable as obsolete.
      expect(a.reason.length, `reason for ${a.file}`).toBeGreaterThan(40)
      const key = `${a.file}: ${a.code}`
      expect(seen.has(key), `duplicate allowance ${key}`).toBe(false)
      seen.add(key)
    }
  })

  // THE SHAPE TESTS ABOVE CANNOT SEE THIS. A matcher mutated to `a.code === code`
  // — the bare-code licence this guard's own prose warns against — leaves every
  // entry perfectly well-formed and simply approves that code repo-wide. Both
  // halves of the key are pinned, in both directions, against the live entries.
  it('requires BOTH halves of the key, so no entry becomes a repo-wide licence', () => {
    expect(SEMANTIC_ALLOWED.length).toBeGreaterThan(0)
    for (const a of SEMANTIC_ALLOWED) {
      expect(semanticAllowanceIndex(a.file, a.code)).toBeGreaterThanOrEqual(0)
      // Right code, different file — a bare-code matcher approves this.
      expect(semanticAllowanceIndex('packages/dom/dist/index.d.ts', a.code)).toBe(-1)
      // Right file, different code — a bare-file matcher approves this.
      expect(semanticAllowanceIndex(a.file, 999999)).toBe(-1)
    }
    expect(semanticAllowanceIndex('packages/dom/dist/index.d.ts', 999999)).toBe(-1)
  })

  it('points the instrument probe at a checked-in, never-built file', () => {
    // The probe asserts it can still report TS2882, which needs a file that
    // EXISTS and has no type declarations. A build output would make the probe
    // depend on another package having been built; a missing file would silently
    // turn the probe into a TS2307 case. `check-dist.mjs` guards the second
    // direction at runtime; this guards the first.
    expect(PROBE_SIDE_EFFECT_TARGET).not.toContain('/dist/')
    expect(existsSync(join(ROOT, PROBE_SIDE_EFFECT_TARGET))).toBe(true)
  })
})
