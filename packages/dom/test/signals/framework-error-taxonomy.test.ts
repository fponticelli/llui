import { describe, it, expect } from 'vitest'
import { LluiFrameworkError, isFrameworkError } from '../../src/signals/framework-error'

// Sources are read through Vite's `?raw` glob rather than `node:fs`: @llui/dom
// declares no `@types/node` (it is a browser runtime), so a filesystem import would
// not type-check under `pnpm check`.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>
  }
}

// The mount boundary (#165) contains a throwing binding so one bad fragment cannot
// abandon the document. That containment is a DEMOTION for any framework-raised
// authoring invariant: "your vite plugin is not registered" becomes a console line
// and a blank section instead of a build-stopping error.
//
// `LluiFrameworkError` is the opt-in that keeps such a throw fatal — and opt-in is
// exactly the problem. The first cut of #165 branded six sites and MISSED TWO:
// `compiledAway()` (the guard behind all six lowering entry points) and `derived()`.
// Both were reachable from inside a binding commit, both were silently swallowed,
// and the CLAUDE.md note written alongside them claimed `compiledAway` was covered.
// Nothing failed. Review caught it, which is not a control.
//
// So the taxonomy polices itself: every bare `throw new Error/TypeError` in the
// signal runtime must either be branded or be listed below WITH A REASON. Adding an
// unbranded throw to a file on the binding path fails this test with the fix in the
// message.

// The WHOLE package, not just `src/signals/`. Review found the first cut globbed
// `src/signals/*.ts` while the failure message said "the signal runtime" — no live
// gap (`src/*.ts`, `src/ssr/`, `src/tracking/` contain zero `throw new` today) but
// an enforcement narrower than it reads is how the next one slips through, which is
// the exact shape of the defect this file exists to stop.
const SOURCES: Record<string, string> = import.meta.glob('../../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** `../../src/signals/each.ts` → `signals/each.ts` (the part after `src/`).
 *
 * The ONLY file-identity in this module, deliberately. An earlier cut keyed the
 * allow-list by BASENAME while reporting offenders by relative path, which was
 * harmless while the glob was `src/signals/*.ts` and became a hole the moment it
 * widened: `index.ts` and `types.ts` now exist in BOTH `src/` and `src/signals/`,
 * so one allow-listed throw in `signals/types.ts` would have silently exempted
 * `src/types.ts` too. A false negative, in the gate whose entire purpose is that
 * branding cannot be forgotten. Do not reintroduce a second path form. */
const relative = (path: string): string => path.slice(path.indexOf('/src/') + 5)

/**
 * Bare (unbranded) throws that are deliberately NOT `LluiFrameworkError`, keyed by
 * file and matched on a distinctive fragment of the message. Every entry states why
 * demotion by the mount boundary is not a hazard for it.
 */
const ALLOWED_BARE_THROWS: Record<string, Array<{ fragment: string; why: string }>> = {
  'signals/debug-collect.ts': [
    {
      fragment: 'unknown component:',
      why:
        'Not an authoring invariant and not on the binding path: a debug-API lookup ' +
        'miss, whose callers (the MCP/agent relays) deliberately turn it into the ' +
        'error frame their protocol already defines. Branding it would leak a ' +
        'framework-fatal into a relay response.',
    },
  ],
  'signals/commit-scope.ts': [
    {
      fragment: 'CommitToken.settle() was called outside its commit scope',
      why:
        'Genuinely SHOULD be branded — containing it would hide a scope-tree ' +
        'corruption. Left bare only because commit-scope.ts is owner-gated for this ' +
        'change (its schedule contract is documented at length) and the site is not ' +
        'reachable from inside a binding commit: `settle` is called by the scheduler ' +
        'through a token, never by binding produce/commit code. Tracked as a ' +
        'follow-up; if this file is opened for any other reason, brand it.',
    },
  ],
}

/** Every `throw new <Ctor>(` in a file, with the literal text that follows it. */
function bareThrows(text: string): Array<{ ctor: string; tail: string }> {
  const out: Array<{ ctor: string; tail: string }> = []
  const re = /throw new (\w+)\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ ctor: m[1]!, tail: text.slice(m.index, m.index + 400) })
  }
  return out
}

describe('#165 framework-error taxonomy is enforced, not remembered', () => {
  it('every throw in the package is branded or explicitly allow-listed', () => {
    const offenders: string[] = []
    // A sanity floor: if the glob ever resolves to nothing this test would pass
    // vacuously, which is the one way an enforcement test fails silently.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(30)
    for (const [path, text] of Object.entries(SOURCES)) {
      const file = relative(path)
      if (file === 'signals/framework-error.ts') continue
      for (const { ctor, tail } of bareThrows(text)) {
        if (ctor === 'LluiFrameworkError') continue
        const allowed = ALLOWED_BARE_THROWS[file] ?? []
        if (allowed.some((a) => tail.includes(a.fragment))) continue
        offenders.push(`${file}: throw new ${ctor}(…) — ${tail.slice(0, 120).replace(/\s+/g, ' ')}`)
      }
    }
    expect(
      offenders,
      'An unbranded throw anywhere in @llui/dom is SILENTLY DEMOTED by the mount ' +
        'error boundary when it is reachable from a binding commit: the fragment ' +
        'renders blank and one console line is written, instead of the error ' +
        'stopping the build. Either throw an `LluiFrameworkError`, or add the site ' +
        'to ALLOWED_BARE_THROWS in this file with a reason it is safe to demote.',
    ).toEqual([])
  })

  it('every allow-list key names exactly one real file', () => {
    // The guard on the guard. A key that matches NO file is a dead exemption that
    // silently stops covering the throw it was written for; a key that matches
    // MORE THAN ONE is the basename hole this file already had once — an exemption
    // written for `signals/types.ts` also excusing `src/types.ts`. Both fail in the
    // false-negative direction, which is the direction a build-failing gate cannot
    // afford, so neither is left to review.
    for (const key of Object.keys(ALLOWED_BARE_THROWS)) {
      const matches = Object.keys(SOURCES).filter((p) => relative(p) === key)
      expect(
        matches.length,
        `ALLOWED_BARE_THROWS key ${JSON.stringify(key)} matched ${matches.length} files. ` +
          `Keys are paths relative to src/ (e.g. "signals/commit-scope.ts"), not bare ` +
          `basenames — "types.ts" and "index.ts" each exist twice under the glob.`,
      ).toBe(1)
    }
  })

  it('an exemption is per-FILE, not per-basename', () => {
    // Pins the fix directly: the colliding basenames are real, and an exemption
    // keyed on one path must not reach its twin.
    const colliding = ['types.ts', 'index.ts']
    for (const name of colliding) {
      const hits = Object.keys(SOURCES).filter(
        (p) => relative(p).endsWith(`/${name}`) || relative(p) === name,
      )
      expect(hits.length, `expected ${name} to exist in more than one directory`).toBeGreaterThan(1)
    }
  })

  it('the two sites review caught (#165 B1/B2) are branded', () => {
    // Named explicitly so a refactor that re-bares them fails on the site, not just
    // on the generic sweep above.
    const read = (name: string): string => {
      const hit = Object.entries(SOURCES).find(([p]) => relative(p) === name)
      if (!hit) throw new Error(`source not found in glob: ${name}`)
      return hit[1]
    }
    const authoring = read('signals/authoring.ts')
    expect(authoring).toContain('throw new LluiFrameworkError(')
    expect(authoring).not.toMatch(/const compiledAway[\s\S]{0,600}?throw new Error\(/)

    const handle = read('signals/handle.ts')
    expect(handle).not.toContain('throw new TypeError(')
  })

  it('detects the brand by property, not identity, so a second copy still counts', () => {
    // Two physical @llui/dom installs is a documented outage-level packaging bug,
    // but an `instanceof` failing OPEN here would demote a fatal invariant to a
    // console line — the expensive direction. A structural clone must still read as
    // a framework error.
    const real = new LluiFrameworkError('boom')
    expect(isFrameworkError(real)).toBe(true)
    const foreign = Object.assign(new Error('boom'), { __lluiFrameworkError: true })
    expect(isFrameworkError(foreign)).toBe(true)
    expect(foreign instanceof LluiFrameworkError).toBe(false)

    // And it must not fire on ordinary throws, including non-objects.
    expect(isFrameworkError(new Error('plain'))).toBe(false)
    expect(isFrameworkError(new TypeError('plain'))).toBe(false)
    expect(isFrameworkError('a string')).toBe(false)
    expect(isFrameworkError(null)).toBe(false)
    expect(isFrameworkError(undefined)).toBe(false)
  })
})
