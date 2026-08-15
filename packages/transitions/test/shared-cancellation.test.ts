import { describe, it, expect } from 'vitest'
import { createRunScope } from '../src/anim'
import { spring } from '../src/spring'
import { stagger } from '../src/stagger'
import { flip } from '../src/flip'
import { fakeLayout } from './fake-layout'
import animSource from '../src/anim.ts?raw'
import transitionSource from '../src/transition.ts?raw'
import presetsSource from '../src/presets.ts?raw'
import springSource from '../src/spring.ts?raw'
import staggerSource from '../src/stagger.ts?raw'
import flipSource from '../src/flip.ts?raw'

// Issue #111 (residual 3) — cancellation was implemented FOUR times and shared
// twice. `transition()` and `collapse()` used `createRunScope`; `spring()` and
// `stagger()` each rolled their own `WeakMap` + `cancelled` flag, and `flip()`
// had none at all. That is the direct cause of the split verdicts across the
// #40 audit: the interrupt fix had to be written four times and was written
// twice. Every helper that owns per-node phase state now goes through the one
// `RunScope`, and these tests fail the build if a bespoke one comes back.

/** Every helper that owns per-node phase state, with its source text. */
const HELPERS: ReadonlyArray<readonly [string, string]> = [
  ['transition.ts', transitionSource],
  ['presets.ts', presetsSource],
  ['spring.ts', springSource],
  ['stagger.ts', staggerSource],
  ['flip.ts', flipSource],
]

// A collection keyed on the animated node IS the shape all four bespoke
// implementations took. A helper may still own one for pure DATA — geometry, a
// per-pass local, a batch whose liveness a `RunScope` already owns — but
// anything tracking whether a phase is LIVE belongs on the scope.
//
// This gate is deliberately SHAPE-based and the exemption lives at the POINT OF
// EDIT. Its predecessor matched `/new WeakMap[^\n]*/g` and compared the result
// for exact equality against an allow-list of FULL SOURCE LINES kept in this
// file: it failed the build on a rename or on a prettier rewrap, said nothing to
// a contributor at the place they were editing, and banned a spelling rather
// than a property — `new Map`, a `WeakRef` or a closure `Set` walked straight
// past it.
//
// Textual matching still cannot see an expando or a plain closure variable. What
// it CAN do is put a signpost where a cache is written, so the rule is stated to
// the person adding one rather than discovered by a red build.
//
// A marker is scoped to ONE statement — its own — in both directions. The
// forward half of that was a claim before it was true: the window took the line
// above unconditionally, so a marked declaration exempted the unmarked
// construction on the next line, which is precisely how `flip.ts` writes its
// adjacent per-pass caches. `statementWindow` is where both directions are
// decided, and the leak is pinned in both.
const CACHE_CONSTRUCTION = /\bnew\s+(?:Weak)?(?:Map|Set|Ref)\b/
/** `// run-scope-exempt: <reason>` — a bare marker with no reason does not count. */
const EXEMPTION = /\/\/\s*run-scope-exempt:\s*\S/

interface UnmarkedCache {
  file: string
  line: number
  text: string
}

/** How far a line is indented, in characters. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

/**
 * The lines a marker may sit on to explain the construction on line `i` — the
 * construction's own STATEMENT, and nothing else.
 *
 * Backwards, the line above counts, so a marker may be written as a comment
 * over the declaration — but only when that line is not ITSELF a construction.
 * Admitting it unconditionally let a marked declaration silently exempt the
 * unmarked one beneath it, and adjacent cache declarations are exactly the
 * shape `flip.ts` already has.
 *
 * Forwards, the window follows a prettier rewrap by INDENTATION rather than by
 * counting lines or hunting for a `)`: every following line indented deeper
 * than the declaration belongs to it, and the line that brings the indentation
 * back while opening with a closing token (`>()` and friends) is its last —
 * the natural home for a trailing marker. Both of the alternatives are wrong in
 * the same direction: a five-line cap loses the marker on a longer wrap, and a
 * first-`)` scan loses it on a type argument that contains one
 * (`Array<() => void>`). Each failure blocks a build on correctly-marked code.
 */
function statementWindow(lines: readonly string[], i: number): string[] {
  const own = lines[i]!
  const above = lines[i - 1]
  const window: string[] = []
  if (above !== undefined && !CACHE_CONSTRUCTION.test(above)) window.push(above)
  window.push(own)

  const indent = indentOf(own)
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j]!
    if (line.trim() === '') break
    if (indentOf(line) > indent) {
      window.push(line)
      continue
    }
    if (/^\s*[)\]}>]/.test(line)) window.push(line)
    break
  }
  return window
}

/** Every cache construction in `source` that carries no exemption marker. */
export function unmarkedCaches(file: string, source: string): UnmarkedCache[] {
  const lines = source.split('\n')
  const found: UnmarkedCache[] = []
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!
    if (!CACHE_CONSTRUCTION.test(text)) continue
    if (statementWindow(lines, i).some((line) => EXEMPTION.test(line))) continue
    found.push({ file, line: i + 1, text: text.trim() })
  }
  return found
}

const RULE =
  'Per-node LIVENESS state belongs on a RunScope (createRunScope), not on a ' +
  'hand-rolled cache — that is how the #40 interrupt fix landed in half the ' +
  'helpers (#111). If this one is NOT liveness, say why where you wrote it: ' +
  'add a `// run-scope-exempt: <reason>` comment on the line, or on the line ' +
  'directly above it. A marker covers ONE statement — the one it is written ' +
  'on — so a neighbouring construction needs its own.'

describe('one shared cancellation path', () => {
  it.each(HELPERS)('%s routes cancellation through createRunScope', (_file, source) => {
    expect(source).toContain('createRunScope')
  })

  it.each(HELPERS)('%s marks every per-node cache it owns', (file, source) => {
    const unmarked = unmarkedCaches(file, source).map((c) => `${c.file}:${c.line}  ${c.text}`)
    expect(unmarked, RULE).toEqual([])
  })

  it('anim.ts owns the one run registry', () => {
    expect(animSource).toContain('new WeakMap<Node, RunEntry>()')
  })
})

// The gate is only worth its place if it FIRES. These pin what it catches and
// what it lets through, against synthetic sources rather than the real ones — so
// a legitimate new cache in a helper never has to be added to a list in here.
describe('the run-scope drift gate itself', () => {
  const at = (source: string): number[] => unmarkedCaches('x.ts', source).map((c) => c.line)

  it('catches a cache however it is spelled', () => {
    expect(at('const runs = new WeakMap<Node, Run>()')).toEqual([1])
    expect(at('const runs = new Map<Node, Run>()')).toEqual([1])
    expect(at('const live = new WeakSet<Element>()')).toEqual([1])
    expect(at('const live = new Set<Element>()')).toEqual([1])
    expect(at('const held = new WeakRef(el)')).toEqual([1])
  })

  it('survives a rename — it matches the constructor, not the declaration text', () => {
    expect(at('const cancelledPhasesByRow = new WeakMap<Element, PhaseState>()')).toEqual([1])
  })

  it('accepts a marker on the line, or on the line above', () => {
    expect(at('const runs = new Map() // run-scope-exempt: per-pass local')).toEqual([])
    expect(at('// run-scope-exempt: geometry\nconst runs = new Map()')).toEqual([])
  })

  it('accepts a marker after a prettier rewrap of the declaration', () => {
    expect(
      at(
        'const positionsKeyedByRowElement = new WeakMap<\n' +
          '  Element,\n' +
          '  Point\n' +
          '>() // run-scope-exempt: geometry, not liveness\n',
      ),
    ).toEqual([])
  })

  it('does not accept a marker with no reason', () => {
    expect(at('const runs = new Map() // run-scope-exempt:')).toEqual([1])
  })

  it('does not let a marker leak past the construction it explains', () => {
    // The window closes at the line that closes the call, so the marker on a
    // LATER statement cannot cover this one.
    expect(at('const a = new Map()\nconst b = new Map() // run-scope-exempt: reason')).toEqual([1])
  })

  it('does not let a marker leak FORWARD onto the construction below it', () => {
    // The other direction, and the one the window used to allow: a marked
    // declaration silently exempted the UNMARKED one on the next line, because
    // the line above was admitted to the window unconditionally. Adjacent cache
    // declarations are exactly the shape `flip.ts` already has, so this was
    // reachable in the very source the gate guards.
    expect(at('const a = new Map() // run-scope-exempt: reason\nconst b = new Map()')).toEqual([2])
  })

  it('accepts a marker after a rewrap of any length', () => {
    // The window used to stop after five lines, so a longer wrap lost its
    // trailing marker and failed the build on correctly-marked code.
    expect(
      at(
        'const positions = new WeakMap<\n' +
          '  Element,\n' +
          '  {\n' +
          '    left: number\n' +
          '    top: number\n' +
          '    width: number\n' +
          '    height: number\n' +
          '  }\n' +
          '>() // run-scope-exempt: geometry, not liveness\n',
      ),
    ).toEqual([])
  })

  it('accepts a marker after a rewrap whose type argument contains parens', () => {
    // `Array<() => void>` closes a paren inside the type argument; the window
    // used to end at the first line containing `)` and stopped there.
    expect(
      at(
        'const listeners = new WeakMap<\n' +
          '  Element,\n' +
          '  Array<() => void>\n' +
          '>() // run-scope-exempt: not liveness\n',
      ),
    ).toEqual([])
  })

  it('does not let a rewrapped construction swallow the statement after it', () => {
    expect(
      at(
        'const positions = new WeakMap<\n' +
          '  Element,\n' +
          '  Point\n' +
          '>()\n' +
          'const runs = new Map() // run-scope-exempt: reason\n',
      ),
    ).toEqual([1])
  })
})

// The behavioural half: each helper's cancellation must still do its job. These
// pin the CONTRACT, so the refactor above cannot quietly drop a guarantee.
describe('cancellation semantics survive the shared scope', () => {
  const makeEl = (): HTMLElement => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
  }

  it('a scope reports the previous run as in-flight until superseded', () => {
    const runs = createRunScope()
    const el = makeEl()
    const token = runs.register(el, () => {})
    expect(runs.isActive(el)).toBe(true)
    runs.supersede(el)
    expect(runs.isCurrent(el, token)).toBe(false)
  })

  it('spring: a superseded loop stops without writing', () => {
    const el = makeEl()
    const queue: FrameRequestCallback[] = []
    const original = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      queue.push(cb)
      return queue.length
    }) as typeof globalThis.requestAnimationFrame
    const pump = (time: number): void => {
      for (const cb of queue.splice(0)) cb(time)
    }
    try {
      const t = spring({ property: 'opacity', from: 0, to: 1 })
      t.enter!([el]) // 0 → 1
      pump(16) // seeds lastTime (dt = 0)
      pump(32)
      const mid = parseFloat(el.style.getPropertyValue('opacity'))
      expect(mid).toBeGreaterThan(0)

      void t.leave!([el]) // supersedes the enter loop
      const afterLeaveStart = parseFloat(el.style.getPropertyValue('opacity'))
      // The superseded enter loop's next frame must not write — if it did, the
      // element would jump back toward the enter target.
      pump(48)
      expect(parseFloat(el.style.getPropertyValue('opacity'))).toBeLessThanOrEqual(afterLeaveStart)
    } finally {
      globalThis.requestAnimationFrame = original
    }
  })

  it('flip: the retained glide is cancelled by the next pass', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const child = document.createElement('div')
    parent.appendChild(child)
    let left = 0
    fakeLayout(child, () => ({ left, top: 0 }))
    const cancels: number[] = []
    child.animate = (() => {
      const index = cancels.push(0) - 1
      return { cancel: () => (cancels[index] = cancels[index]! + 1) }
    }) as unknown as typeof child.animate

    const f = flip()
    f.onTransition!({ entering: [], leaving: [], parent }) // seeds the baseline
    left = 50
    f.onTransition!({ entering: [], leaving: [], parent })
    left = 90
    f.onTransition!({ entering: [], leaving: [], parent })

    // Two glides; the first was cancelled when the second started.
    expect(cancels).toEqual([1, 0])
    document.body.removeChild(parent)
  })

  it('stagger: the opposite phase still cancels a pending delay', async () => {
    const seen: Node[][] = []
    const t = stagger(
      {
        enter: () => {},
        leave: (nodes) => {
          seen.push(nodes)
          return Promise.resolve()
        },
      },
      { delayPerItem: 60, leaveOrder: 'sequential' },
    )
    const a = makeEl()
    const b = makeEl()

    void t.leave!([a]) // index 0 → immediate
    const pending = t.leave!([b]) // index 1 → deferred
    t.enter!([b]) // b stays → its pending leave is cancelled AND resolved

    await new Promise<void>((resolve) => setTimeout(resolve, 200))
    expect(seen).toEqual([[a]])
    await expect(pending as Promise<void>).resolves.toBeUndefined()
  })
})
