import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flip } from '../src/flip'

// Issue #107 — `flip()` never cancelled the prior WAAPI `Animation` (there was
// no `.cancel()` anywhere in the package), interleaved a layout READ with an
// animation WRITE per row (one forced reflow per row on a K-row reorder), and
// computed the next glide's delta from the stored LAYOUT box rather than from
// where the row visually is mid-glide — so an interrupted reorder jumped.

type Op = 'read' | 'write'

interface StubAnimation {
  cancel: () => void
  cancelled: number
  keyframes: unknown
  /**
   * Modelled on the real WAAPI member: resolves when the animation completes,
   * and REJECTS when it is cancelled. Nothing resolves it on its own — a test
   * calls {@link StubAnimation.settle} at the point the browser would finish.
   */
  finished: Promise<void>
  /** Complete the animation, as the browser does when its duration elapses. */
  settle: () => void
}

/** A `parent` whose children are instrumented to log every read and write. */
function makeList(count: number) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const log: Op[] = []
  const animations: StubAnimation[] = []
  // Layout position per child, and the transform the test wants reported.
  const layout = new Map<HTMLElement, { left: number; top: number }>()
  const transform = new Map<HTMLElement, string>()

  const children: HTMLElement[] = []
  for (let i = 0; i < count; i++) {
    const child = document.createElement('div')
    parent.appendChild(child)
    layout.set(child, { left: 0, top: i * 10 })
    child.getBoundingClientRect = () => {
      log.push('read')
      const { left, top } = layout.get(child)!
      // A real `getBoundingClientRect` reports the VISUAL box, so a running
      // FLIP transform is already folded in.
      const [dx, dy] = parseTranslate(transform.get(child) ?? 'none')
      return { left: left + dx, top: top + dy, width: 10, height: 10 } as DOMRect
    }
    child.animate = ((keyframes: unknown) => {
      log.push('write')
      let settle!: () => void
      let abort!: () => void
      const finished = new Promise<void>((resolve, reject) => {
        settle = resolve
        // WAAPI rejects `finished` with an AbortError when an animation is
        // cancelled. Anything reading `finished` must handle that rejection or
        // the cancel ledger below turns into an unhandled rejection.
        abort = () => reject(new Error('AbortError'))
      })
      const anim: StubAnimation = {
        keyframes,
        cancelled: 0,
        finished,
        settle,
        cancel: () => {
          log.push('write')
          anim.cancelled++
          abort()
        },
      }
      animations.push(anim)
      return anim
    }) as unknown as typeof child.animate

    children.push(child)
  }

  // `getComputedStyle` is a global; wrap it so a transform read is logged too.
  const originalComputed = globalThis.getComputedStyle
  vi.stubGlobal('getComputedStyle', (el: Element, pseudo?: string | null) => {
    if (el instanceof HTMLElement && transform.has(el)) {
      log.push('read')
      return { transform: transform.get(el)! } as CSSStyleDeclaration
    }
    return originalComputed(el, pseudo)
  })

  return { parent, children, log, animations, layout, transform }
}

function parseTranslate(value: string): [number, number] {
  const m = value.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/)
  if (m) return [parseFloat(m[1]!), parseFloat(m[2]!)]
  // A BROWSER serializes a computed transform as `matrix(a, b, c, d, tx, ty)`,
  // never as the authored function — so an author-set `transform` reads back in
  // this form, and `getBoundingClientRect` folds it into the box. jsdom reports
  // `none` for both, which is exactly why the author-transform case below was
  // invisible to this suite.
  const matrix = value.match(/^matrix\(([^)]*)\)$/)
  if (matrix) {
    const parts = matrix[1]!.split(',')
    return [parseFloat(parts[4] ?? '0'), parseFloat(parts[5] ?? '0')]
  }
  return [0, 0]
}

/** How many times the pass switched from writing back to reading. */
function forcedLayouts(log: Op[]): number {
  let count = 0
  let reading = false
  for (const op of log) {
    if (op === 'read') {
      if (!reading) count++
      reading = true
    } else {
      reading = false
    }
  }
  return count
}

describe('flip() read/write batching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      cb(0)
      return 0 as unknown as number
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it.each([1, 3, 10])('forces one layout for a %i-row reorder', (k) => {
    const { parent, children, log, layout } = makeList(k)
    const f = flip()
    f.enter!(children)

    // Every row moves.
    for (const child of children) layout.set(child, { left: 100, top: layout.get(child)!.top })
    log.length = 0
    f.onTransition!({ entering: [], leaving: [], parent })

    // All reads precede all writes, so the browser flushes layout exactly once
    // no matter how many rows moved.
    expect(forcedLayouts(log)).toBe(1)
  })

  it('issues every read before any write', () => {
    const { parent, children, log, layout } = makeList(4)
    const f = flip()
    f.enter!(children)

    for (const child of children) layout.set(child, { left: 100, top: layout.get(child)!.top })
    log.length = 0
    f.onTransition!({ entering: [], leaving: [], parent })

    const firstWrite = log.indexOf('write')
    expect(firstWrite).toBeGreaterThan(0)
    expect(log.lastIndexOf('read')).toBeLessThan(firstWrite)
  })

  it('cancels the prior animation: N passes leave N−1 cancels and one live animation', () => {
    const { parent, children, layout, animations } = makeList(1)
    const child = children[0]!
    const f = flip()
    f.enter!([child])

    for (let pass = 1; pass <= 3; pass++) {
      layout.set(child, { left: pass * 100, top: 0 })
      f.onTransition!({ entering: [], leaving: [], parent })
    }

    expect(animations).toHaveLength(3)
    // Each new pass cancels the one before it; the newest is still live.
    expect(animations.map((a) => a.cancelled)).toEqual([1, 1, 0])
  })

  it('continues an interrupted reorder from the visual position, not the layout box', () => {
    const { parent, children, layout, transform, animations } = makeList(1)
    const child = children[0]!
    const f = flip()
    f.enter!([child]) // baseline layout at left 0

    // Pass 1: the row moves to 100 and starts gliding from -100.
    layout.set(child, { left: 100, top: 0 })
    f.onTransition!({ entering: [], leaving: [], parent })
    expect(animations[0]!.keyframes).toEqual([
      { transform: 'translate(-100px, 0px)' },
      { transform: 'translate(0, 0)' },
    ])

    // Mid-glide: the row is 40px short of its layout box, i.e. visually at 60.
    transform.set(child, 'translate(-40px, 0px)')

    // Pass 2: it moves again, to 200. It appears at 60, so it must glide -140 —
    // NOT the -60 that a stored-layout-minus-visual-rect subtraction yields.
    layout.set(child, { left: 200, top: 0 })
    f.onTransition!({ entering: [], leaving: [], parent })

    expect(animations[1]!.keyframes).toEqual([
      { transform: 'translate(-140px, 0px)' },
      { transform: 'translate(0, 0)' },
    ])
  })

  it('ends the glide run on completion, so an author transform is never read as ours', async () => {
    // A row carrying a CONSTANT author transform — a hover lift, a drag offset,
    // ordinary code. It is folded into every rect the row reports, so it cancels
    // out of the delta and must never be read as a glide of ours.
    //
    // The glide run used to be registered and never ended, so from the first
    // glide onward `isActive` stayed true and the read phase attributed the
    // AUTHOR's 50px to us: pass 2 computed dx = 0 (no animation at all, the row
    // jumped 100px) and pass 3 computed −50 (half the real delta).
    const { parent, children, layout, transform, animations } = makeList(1)
    const child = children[0]!
    transform.set(child, 'matrix(1, 0, 0, 1, 50, 0)')

    const f = flip()
    f.enter!([child])

    for (let pass = 1; pass <= 3; pass++) {
      layout.set(child, { left: pass * 100, top: 0 })
      f.onTransition!({ entering: [], leaving: [], parent })
      // The glide runs to completion before the next reorder.
      animations[pass - 1]?.settle()
      await Promise.resolve()
      await Promise.resolve()
    }

    // Every pass moved the row exactly 100px, so every glide is −100.
    expect(animations).toHaveLength(3)
    expect(animations.map((a) => a.keyframes)).toEqual([
      [{ transform: 'translate(-100px, 0px)' }, { transform: 'translate(0, 0)' }],
      [{ transform: 'translate(-100px, 0px)' }, { transform: 'translate(0, 0)' }],
      [{ transform: 'translate(-100px, 0px)' }, { transform: 'translate(0, 0)' }],
    ])
  })

  it('stops reading the computed transform once the glide has finished', async () => {
    // The direct consequence of the run never ending: `getComputedStyle` was
    // called for every surviving row on every structural reconcile, forever.
    const { parent, children, layout, transform, animations, log } = makeList(1)
    const child = children[0]!
    transform.set(child, 'matrix(1, 0, 0, 1, 50, 0)')
    const f = flip()
    f.enter!([child])

    layout.set(child, { left: 100, top: 0 })
    f.onTransition!({ entering: [], leaving: [], parent })
    animations[0]!.settle()
    await Promise.resolve()
    await Promise.resolve()

    // With the run ended, the next pass reads the rect and nothing else.
    layout.set(child, { left: 200, top: 0 })
    log.length = 0
    f.onTransition!({ entering: [], leaving: [], parent })
    expect(log.filter((op) => op === 'read')).toHaveLength(1)
  })

  it('stores the untransformed layout box, so the next pass measures from it', () => {
    const { parent, children, layout, transform, animations } = makeList(1)
    const child = children[0]!
    const f = flip()
    f.enter!([child])

    layout.set(child, { left: 100, top: 0 })
    f.onTransition!({ entering: [], leaving: [], parent })
    transform.set(child, 'translate(-40px, 0px)') // mid-glide
    layout.set(child, { left: 200, top: 0 })
    f.onTransition!({ entering: [], leaving: [], parent })

    // Third pass, now settled at its layout box: the delta is measured against
    // 200 (the layout position), not 160 (the transformed rect pass 2 saw).
    transform.set(child, 'none')
    layout.set(child, { left: 500, top: 0 })
    f.onTransition!({ entering: [], leaving: [], parent })

    expect(animations[2]!.keyframes).toEqual([
      { transform: 'translate(-300px, 0px)' },
      { transform: 'translate(0, 0)' },
    ])
  })
})
