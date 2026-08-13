import { describe, it, expect } from 'vitest'
import { createRunScope } from '../src/anim'
import { spring } from '../src/spring'
import { stagger } from '../src/stagger'
import { flip } from '../src/flip'
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

// A hand-rolled `WeakMap` keyed on the animated node IS the shape all four
// bespoke implementations took. A helper may still own one for pure DATA, but
// anything tracking whether a phase is LIVE belongs to a `RunScope` — so every
// `WeakMap` in a helper has to be named here, with its reason.
const ALLOWED_WEAKMAPS: Record<string, readonly string[]> = {
  // Last-known LAYOUT position per row. Geometry, not liveness: it must survive
  // long past the glide that read it, which is exactly why it cannot live on the
  // run scope.
  'flip.ts': ['new WeakMap<Element, Point>()'],
}

describe('one shared cancellation path', () => {
  it.each(HELPERS)('%s routes cancellation through createRunScope', (_file, source) => {
    expect(source).toContain('createRunScope')
  })

  it.each(HELPERS)('%s declares no bespoke run registry', (file, source) => {
    const declared = source.match(/new WeakMap[^\n]*/g) ?? []
    expect(declared).toEqual(ALLOWED_WEAKMAPS[file] ?? [])
  })

  it('anim.ts owns the one run registry', () => {
    expect(animSource).toContain('new WeakMap<Node, RunEntry>()')
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
    child.getBoundingClientRect = () => ({ left, top: 0, width: 1, height: 1 }) as DOMRect
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
