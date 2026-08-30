import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import {
  checkPackage,
  declaredNames,
  docOnlyModuleDefects,
  docOnlyModuleListDefects,
  extractBlocks,
  obsoleteDocOnlyModules,
  parseImportClause,
  splitSetup,
} from '../check-readme-examples.mjs'

/**
 * #255: `check:docs` wrote a file-level `// @ts-nocheck` as the second line of
 * the synthetic file it compiled, which disables ALL semantic checking — so it
 * reported PARSE errors only and a README example could name an export that no
 * longer exists. These two directions are the issue's own measured table, and
 * they are the reason this file exists: the first one PASSED on `main`.
 *
 * `checkPackage` is driven against a throwaway directory rather than a real
 * package, so the fixtures are the whole input and a green result cannot come
 * from something else in the tree.
 */

/** @returns the temp dir, registered for teardown. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const dirs: string[] = []
function fixture(readme: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'llui-readme-check-test-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'README.md'), readme)
  return dir
}

/**
 * A fixture rooted INSIDE a real package, so Node's resolution walk reaches
 * that package's own `node_modules` and its THIRD-PARTY dependencies resolve.
 * A bare `mkdtemp` fixture cannot see that — which is why moving the synthetic
 * file back to the workspace-root cache survived the whole suite while costing
 * 54 errors on the real corpus.
 *
 * It lives under the package's `node_modules/.cache`, which is gitignored, so
 * it is structurally invisible to the repo-walking guards that enumerate with
 * `git ls-files`.
 */
function packageRootedFixture(pkg: string, readme: string): string {
  // CREATE the `.cache` directory rather than assuming it: it is gitignored,
  // pnpm does not create it, and a fresh checkout therefore has none. Do not
  // "simplify" this away on the grounds that the directory always seems to be
  // there — it seems to be there because `check-readme-examples.mjs` creates
  // one per package as a side effect (its own `mkdirSync` at the equivalent
  // site), and `pnpm check:docs` runs at step ~190 of `ci.yml` while
  // `pnpm test:scripts` runs at ~287. So CI passes by accident of STEP ORDER:
  // `rm -rf packages/*/node_modules/.cache && pnpm test:scripts` fails with
  // ENOENT on `mkdtemp`, which is what a developer running this suite alone in
  // a fresh worktree gets — a red with nothing to do with their change, and a
  // red `main` the day the steps are reordered. Fixed here, at the assumption,
  // never by pinning the CI order.
  const cacheDir = join(ROOT, 'packages', pkg, 'node_modules', '.cache')
  mkdirSync(cacheDir, { recursive: true })
  const dir = mkdtempSync(join(cacheDir, 'readme-fixture-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'README.md'), readme)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

const fence = (body: string, info = '') => '```ts' + info + '\n' + body + '\n```\n'

describe('check:docs type-checks, not just parses (#255)', () => {
  it('reports a TYPE error in a README block', () => {
    const result = checkPackage(fixture(fence(`const x: number = 'not a number'\nvoid x`)))
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContain('TS2322')
  })

  it('still reports a SYNTAX error in a README block', () => {
    const result = checkPackage(fixture(fence('const x: number = = 1\nvoid x')))
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toMatch(/TS1\d{3}/)
  })

  it('passes a block that is actually correct', () => {
    const result = checkPackage(fixture(fence('const x: number = 1\nvoid x')))
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toBe('')
  })

  it('reports against the README line, not the synthetic file', () => {
    // Two blocks, so the reported line can only be right if the offset is
    // computed per block rather than from the top of the file.
    const readme = [
      '# Title',
      '',
      fence('const a: number = 1\nvoid a'),
      '',
      fence('const b: number = "x"\nvoid b'),
    ].join('\n')
    const result = checkPackage(fixture(readme))
    expect(result.ok).toBe(false)
    // `const b` sits on README line 10 (1-based), and nothing in the message
    // may name the synthetic file a reader cannot open.
    expect(result.diagnostics).toContain('README.md(10,7)')
    expect(result.diagnostics).not.toContain('llui-readme-check/')
    expect(result.diagnostics).not.toContain('-block-')
  })
})

describe('DOC_ONLY_MODULES is closed at BOTH ends', () => {
  it('the shipped list is well-formed and every entry is still used', () => {
    expect(docOnlyModuleDefects()).toEqual([])
    expect(obsoleteDocOnlyModules()).toEqual([])
  })

  it('rejects a workspace @llui/* package', () => {
    // A stub silences a renamed or dropped export outright — measured before
    // this gate existed, `DOC_ONLY_MODULES.probe['@llui/dom'] = ''` took a
    // control that fails TS2305 to exit 0. Workspace packages must RESOLVE.
    const defects = docOnlyModuleDefects({ probe: { '@llui/dom': 'a real reason' } })
    expect(defects).toHaveLength(1)
    expect(defects[0]).toContain('@llui/dom')
    expect(defects[0]).toContain('RESOLVED')
  })

  it('rejects an entry with a blank reason', () => {
    expect(docOnlyModuleDefects({ probe: { express: '' } })).toHaveLength(1)
    expect(docOnlyModuleDefects({ probe: { express: '   ' } })).toHaveLength(1)
  })

  it('accepts a third-party entry that carries a reason', () => {
    expect(docOnlyModuleDefects({ probe: { express: 'server integration example' } })).toEqual([])
  })

  it('the pass `main` runs reports BOTH ends', () => {
    // `main` calls this one function, so dropping either half from it is
    // caught here. Testing the two halves alone would not notice.
    const both = docOnlyModuleListDefects({
      router: { '@llui/dom': 'reason', 'no-such-module': 'reason' },
    })
    expect(both.some((d) => d.includes('RESOLVED'))).toBe(true)
    expect(both.some((d) => d.includes('no longer imported'))).toBe(true)
  })

  it('reports an entry the README no longer imports, and only that one', () => {
    // `@llui/router` really does import `zod`; `no-such-module` cannot.
    const stale = obsoleteDocOnlyModules({
      router: { zod: 'reason', 'no-such-module': 'reason' },
    })
    expect(stale).toHaveLength(1)
    expect(stale[0]).toContain('no-such-module')
  })
})

describe('escape hatches', () => {
  it('skips a block tagged in the fence info string', () => {
    const result = checkPackage(fixture(fence(`const x: number = 'nope'`, ' @doc-skip')))
    expect(result.ok).toBe(true)
  })

  it('skips a block tagged with a leading // @doc-skip comment', () => {
    const result = checkPackage(fixture(fence(`// @doc-skip\nconst x: number = 'nope'`)))
    expect(result.ok).toBe(true)
  })

  it('a @doc-setup region declares elided values without rendering', () => {
    const readme = [
      fence('const n: number = elided\nvoid n'),
      '',
      '<!-- @doc-setup',
      'declare const elided: number',
      '-->',
    ].join('\n')
    expect(checkPackage(fixture(readme)).ok).toBe(true)
  })

  it('a @doc-setup group is dropped when a block declares the same name', () => {
    // The block's own definition must win, or the stub shadows real code.
    const readme = [
      fence(`const elided = 'a string'\nconst s: string = elided\nvoid s`),
      '',
      '<!-- @doc-setup',
      'declare const elided: number',
      '-->',
    ].join('\n')
    expect(checkPackage(fixture(readme)).ok).toBe(true)
  })
})

describe('a README is a narrative', () => {
  it('a later block sees an earlier block’s imports', () => {
    const readme = [
      fence(`import { text } from '@llui/dom'\nvoid text`),
      '',
      fence('void text'),
    ].join('\n')
    expect(checkPackage(fixture(readme)).ok).toBe(true)
  })

  it('a later block sees an earlier block’s top-level declarations', () => {
    const readme = [
      fence('type Widget = { id: string }'),
      '',
      fence('declare const w: Widget\nvoid w.id'),
    ].join('\n')
    expect(checkPackage(fixture(readme)).ok).toBe(true)
  })

  it('an EARLIER block does not see a LATER one (edges point backwards)', () => {
    const readme = [
      fence('declare const w: Widget\nvoid w'),
      '',
      fence('type Widget = { id: string }'),
    ].join('\n')
    const result = checkPackage(fixture(readme))
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContain('Widget')
  })

  it('two blocks may bind the same name from different modules', () => {
    // The single-file design collided here (`Duplicate identifier`); one file
    // per block plus a first-wins preamble must not.
    const readme = [
      fence(`import { text } from '@llui/dom'\nvoid text`),
      '',
      fence(`import { text } from '@llui/dom'\nvoid text`),
    ].join('\n')
    expect(checkPackage(fixture(readme)).ok).toBe(true)
  })

  it('a block may use export / export default / a multi-line import', () => {
    const readme = fence(
      [
        'import {',
        '  text,',
        "} from '@llui/dom'",
        'export const p = text',
        'export default p',
      ].join('\n'),
    )
    expect(checkPackage(fixture(readme)).ok).toBe(true)
  })
})

describe('strictness posture', () => {
  it('is STRICT: a bare [] infers never[], not any[]', () => {
    // The shape that actually broke: `component<State, Msg, never>` with the
    // canonical effect-free `init: () => [state, []]`. Under `strict: false`
    // the `[]` infers `any[]`, which is not assignable to `never[]`, so a
    // correct README example FAILS. An annotated `[number, never[]]` does NOT
    // reproduce it — the contextual type rescues it in both postures — so this
    // has to go through generic inference to be worth anything.
    const readme = fence(
      [
        'declare function make<E>(spec: { init: () => [number, E[]] }): void',
        'make<never>({ init: () => [1, []] })',
      ].join('\n'),
    )
    expect(checkPackage(fixture(readme)).ok).toBe(true)
  })

  it('allows an implicitly-any callback parameter', () => {
    const readme = fence(['const f = (x) => x', 'void f'].join('\n'))
    expect(checkPackage(fixture(readme)).ok).toBe(true)
  })

  it('still reports a null/undefined confusion (strictNullChecks is on)', () => {
    const readme = fence(['const s: string = null', 'void s'].join('\n'))
    expect(checkPackage(fixture(readme)).ok).toBe(false)
  })
})

describe('relative imports name the reader’s project', () => {
  it('does not report an unresolvable RELATIVE module', () => {
    expect(checkPackage(fixture(fence(`import { Thing } from './thing'\nvoid Thing`))).ok).toBe(
      true,
    )
  })

  it('DOES report an unresolvable BARE module', () => {
    const result = checkPackage(fixture(fence(`import { x } from 'no-such-package-xyz'\nvoid x`)))
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContain('TS2307')
  })

  it('resolves the documenting package’s own THIRD-PARTY dependencies', () => {
    // `loro-crdt` is a peer/dev dependency of `@llui/lexical-loro` and is not
    // hoisted to the workspace root, so this passes only because the synthetic
    // file sits under that package rather than in the root cache.
    const result = checkPackage(
      packageRootedFixture(
        'lexical-loro',
        fence("import { LoroDoc } from 'loro-crdt'\nvoid LoroDoc"),
      ),
    )
    expect(result.ok).toBe(true)
  })

  it('resolves a workspace @llui/* package for real', () => {
    const result = checkPackage(
      fixture(fence(`import { notAnExport } from '@llui/dom'\nvoid notAnExport`)),
    )
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toMatch(/TS(2305|2724)/)
  })
})

describe('a tsx fence is written to a .tsx file', () => {
  it('parses JSX rather than misreading it as TS', () => {
    // The ScriptKind trap `@llui/compiler` documents: parsing TSX as TS
    // misparses JSX. Latent (no tsx fence ships today) but the fence syntax is
    // accepted, so the day one is written it must not fail for the wrong
    // reason. Without the `.tsx` extension this reports TS1005 x2 / TS1134 /
    // TS1161.
    const readme = '```tsx\nconst el = <div className="x">hi</div>\nvoid el\n```\n'
    expect(checkPackage(fixture(readme)).ok).toBe(true)
  })

  it('records which fence language a block came from', () => {
    expect(extractBlocks('```tsx\nconst a = 1\n```\n')[0]?.tsx).toBe(true)
    expect(extractBlocks('```ts\nconst a = 1\n```\n')[0]?.tsx).toBe(false)
    expect(extractBlocks('```typescript\nconst a = 1\n```\n')[0]?.tsx).toBe(false)
  })
})

describe('generated-code positions never claim a README line', () => {
  it('a standalone `export { x }` does not collide with the republish', () => {
    // `declaredNames` used to flag only the `export` MODIFIER, so the appended
    // republish re-exported a name the block already exported: two bogus
    // `Duplicate identifier` on a block doing nothing wrong.
    const readme = fence('const a = 1\nexport { a }')
    expect(checkPackage(fixture(readme)).ok).toBe(true)
  })

  it('labels a diagnostic on the appended footer instead of inventing a line', () => {
    // The republish sits one line PAST the block, so in a short README it maps
    // to a line the file does not have. `DECLARATION_RE` is anchored at column
    // 0 and knows nothing about template literals, so a `const` written at the
    // start of a template line is collected and then re-exported — an honest
    // over-approximation, and the cheapest way to put a diagnostic on the
    // generated line.
    const readme = fence('const s = `\nconst ghost = 1\n`\nvoid s')
    const result = checkPackage(fixture(readme))
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContain('[generated footer]')
    // The block covers README lines 2-5; nothing may claim line 6 or beyond.
    expect(result.diagnostics).not.toMatch(/README\.md\(\d+,/)
  })
})

describe('block extraction', () => {
  it('records the README line each block starts on', () => {
    const blocks = extractBlocks('# T\n\n```ts\nconst a = 1\n```\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.startLine).toBe(4)
  })

  it('dedents a fence nested in a Markdown list, and remembers the indent', () => {
    const blocks = extractBlocks('1. Step\n\n   ```ts\n   export const a = 1\n   ```\n')
    expect(blocks[0]?.indent).toBe(3)
    expect(blocks[0]?.body).toBe('export const a = 1\n')
    // Column 0 is what `declaredNames` needs; without the dedent this is empty.
    expect([...declaredNames(blocks[0]?.body ?? '').keys()]).toEqual(['a'])
  })

  it('blanks a @doc-setup region to the same line count', () => {
    const source = '# T\n\n<!-- @doc-setup\ndeclare const x: number\n-->\n\n```ts\nvoid x\n```\n'
    const { setup, rest } = splitSetup(source)
    expect(setup).toContain('declare const x: number')
    expect(rest.split('\n').length).toBe(source.split('\n').length)
    expect(extractBlocks(rest)[0]?.startLine).toBe(8)
  })
})

describe('import-clause parsing', () => {
  it('reads default, namespace, named and aliased bindings', () => {
    expect(parseImportClause('def, { a, b as c }')).toEqual({
      standalone: [{ local: 'def', clause: 'def' }],
      named: [
        { local: 'a', clause: 'a' },
        { local: 'c', clause: 'b as c' },
      ],
    })
    expect(parseImportClause('* as ns').standalone).toEqual([{ local: 'ns', clause: '* as ns' }])
    expect(parseImportClause('{ type T }').named).toEqual([{ local: 'T', clause: 'type T' }])
  })
})

describe('declaration collection', () => {
  it('collects top-level declarations and flags the exported ones', () => {
    const names = declaredNames(
      ['const a = 1', 'export const b = 2', 'function c() {}', 'type D = 1', 'class E {}'].join(
        '\n',
      ),
    )
    expect([...names.entries()]).toEqual([
      ['a', false],
      ['b', true],
      ['c', false],
      ['D', false],
      ['E', false],
    ])
  })

  it('ignores a nested declaration', () => {
    // Nested names are re-exported for later blocks, and `export { x }` naming
    // a function-local `const` is an error in the block that declares it.
    expect([...declaredNames('function f() {\n  const inner = 1\n}').keys()]).toEqual(['f'])
  })
})
