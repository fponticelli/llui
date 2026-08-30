import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  checkPackage,
  declaredNames,
  extractBlocks,
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
const dirs: string[] = []
function fixture(readme: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'llui-readme-check-test-'))
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

  it('resolves a workspace @llui/* package for real', () => {
    const result = checkPackage(
      fixture(fence(`import { notAnExport } from '@llui/dom'\nvoid notAnExport`)),
    )
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toMatch(/TS(2305|2724)/)
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
