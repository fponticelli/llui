import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
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
// reports nothing on any of them.
//
// Enumeration is `git ls-files --cached --others --exclude-standard` — TRACKED plus
// UNTRACKED-BUT-NOT-IGNORED, so a brand-new file the author has not yet `git add`ed is
// still covered (CLAUDE.md's own standing rule; a bare `git ls-files` misses exactly
// that file, silently). Never re-derive the file set with a plain filesystem walk either
// (the `.claude/worktrees/` trap, irrelevant here since this walk is rooted at `src`, but
// the discipline is the same one CLAUDE.md names generally).
//
// The vacuity guard below is an EXACT set comparison against an INDEPENDENT enumeration
// (a `readdirSync` walk), never a `length > N` floor — a floor only detects
// under-collection and cannot see the git enumeration silently missing files a directory
// walk would still find (or vice versa).
const PACKAGE_ROOT = resolve(import.meta.dirname, '..')

function sourceFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src'],
    { cwd: PACKAGE_ROOT, encoding: 'utf8' },
  )
  return out
    .split('\0')
    .filter((p) => p.length > 0)
    .filter((p) => /\.tsx?$/.test(p))
    .sort()
}

/** Independent enumeration, walking the real filesystem rather than asking git — used
 * ONLY to cross-check `sourceFiles()`'s count/membership, never as the corpus itself. */
function walkSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(resolve(PACKAGE_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...walkSourceFiles(rel))
    else if (/\.tsx?$/.test(entry.name)) out.push(rel)
  }
  return out.sort()
}

describe('tag-send-drift corpus sweep (@llui/components/src)', () => {
  it('the git enumeration is EXACTLY the real filesystem set (vacuity guard, no floor)', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(50)
    expect(files).toEqual(walkSourceFiles('src'))
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
