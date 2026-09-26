import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseModule, lintSignalSource } from '@llui/compiler'

// Issue #264 review finding 1: `registry/test/navigation-data-live-demos.browser.test.ts`
// failed 13/14 because main's pickers demo is compiled by the real Vite plugin, and the
// plugin's `tag-send-drift` rule rejected `color-picker.ts`'s eyedropper-trigger handler
// — it is `tagSend(send, ['setColor'], ...)` but its async failure branch ALSO dispatches
// `eyeDropperFailed`. A build error in one production file is invisible to any test that
// only exercises fixtures, so this sweeps EVERY real source file the compiler would ever
// see under `packages/components/src` and asserts the rule that broke the demo compile
// reports nothing on any of them — never re-derive the file set with a filesystem walk
// (`.claude/worktrees/` trap); enumerate with `git ls-files`.
const PACKAGE_ROOT = resolve(import.meta.dirname, '..')

function sourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--', 'src'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
  })
  return out
    .split('\0')
    .filter((p) => p.length > 0)
    .filter((p) => /\.tsx?$/.test(p))
    .sort()
}

describe('tag-send-drift corpus sweep (@llui/components/src)', () => {
  it('finds a non-trivial number of source files (vacuity guard)', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(50)
  })

  it('the analyzer can still detect a faithful drift (self-check)', () => {
    const bad = `
      import { component, tagSend, div } from '@llui/dom'
      export const Bad = component({
        name: 'bad',
        init: () => ({ value: 0 }),
        update: (state, msg) => [state, []],
        view: ({ send }) => [
          div({
            onClick: tagSend(send, ['a'], () => send({ type: 'b' })),
          }, []),
        ],
      })
    `
    const parsed = parseModule('self-check.tsx', bad)
    const messages = lintSignalSource(parsed).filter((m) => m.rule === 'tag-send-drift')
    expect(messages.length).toBeGreaterThan(0)
  })

  it('reports zero tag-send-drift diagnostics across every real source file', () => {
    const files = sourceFiles()
    const offenders: { file: string; message: string }[] = []
    for (const relPath of files) {
      const absPath = resolve(PACKAGE_ROOT, relPath)
      const text = readFileSync(absPath, 'utf8')
      if (!text.includes('tagSend')) continue
      const parsed = parseModule(relPath, text)
      const messages = lintSignalSource(parsed).filter((m) => m.rule === 'tag-send-drift')
      for (const m of messages) offenders.push({ file: relPath, message: m.message })
    }
    expect(offenders).toEqual([])
  })
})
