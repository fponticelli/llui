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

    // Every pass moved the row exactly 100px, so every glide is −100 — and each
    // one carries the author's transform along (#144), which is why the delta
    // and the composition have to be read off the same keyframes.
    const author = 'matrix(1, 0, 0, 1, 50, 0)'
    expect(animations).toHaveLength(3)
    expect(animations.map((a) => a.keyframes)).toEqual([
      [
        { transform: `translate(-100px, 0px) ${author}` },
        { transform: `translate(0, 0) ${author}` },
      ],
      [
        { transform: `translate(-100px, 0px) ${author}` },
        { transform: `translate(0, 0) ${author}` },
      ],
      [
        { transform: `translate(-100px, 0px) ${author}` },
        { transform: `translate(0, 0) ${author}` },
      ],
    ])
  })

  it('ends the glide run when the animation is cancelled from OUTSIDE', async () => {
    // `Animation.finished` rejects only on cancel, so a swallowed rejection
    // loses no ERROR — but it loses the run-cleanup obligation, and the only
    // cancel that is safely covered elsewhere is our OWN supersede (where the
    // next `register` has already replaced the entry). Anything else that
    // cancels the glide — author code, a devtools "cancel all animations",
    // `el.getAnimations().forEach(a => a.cancel())` — leaves the run registered
    // forever, and from there the read phase attributes the row's CONSTANT
    // author transform to us. That is #107's blocking defect reproducing
    // verbatim: the next clean reorder computes dx = 0 and does not animate.
    const { parent, children, layout, transform, animations } = makeList(1)
    const child = children[0]!
    transform.set(child, 'matrix(1, 0, 0, 1, 50, 0)')

    const f = flip()
    f.enter!([child])

    const author = 'matrix(1, 0, 0, 1, 50, 0)'
    layout.set(child, { left: 100, top: 0 })
    f.onTransition!({ entering: [], leaving: [], parent })
    expect(animations[0]!.keyframes).toEqual([
      { transform: `translate(-100px, 0px) ${author}` },
      { transform: `translate(0, 0) ${author}` },
    ])

    // Cancelled mid-glide by someone who is not us. The element goes straight
    // back to its own transform, exactly as a completion would leave it.
    animations[0]!.cancel()
    await Promise.resolve()
    await Promise.resolve()

    // A clean 100px reorder afterwards must glide the whole 100px.
    layout.set(child, { left: 200, top: 0 })
    f.onTransition!({ entering: [], leaving: [], parent })

    expect(animations).toHaveLength(2)
    expect(animations[1]!.keyframes).toEqual([
      { transform: `translate(-100px, 0px) ${author}` },
      { transform: `translate(0, 0) ${author}` },
    ])
  })

  it('reads the computed transform of a SETTLED row only when it is about to glide', async () => {
    // The cost half of #107, re-struck by #144. The run never ending meant
    // `getComputedStyle` ran for every surviving row on every structural
    // reconcile, forever. Composing the author transform into the keyframes
    // (#144) needs that value for every row that MOVES — but only for those:
    // a settled row that stays put must still read nothing but its rect, and
    // the extra read must land in the read phase so the pass still forces one
    // layout.
    const { parent, children, layout, transform, animations, log } = makeList(2)
    const [a, b] = children as [HTMLElement, HTMLElement]
    transform.set(a, 'matrix(1, 0, 0, 1, 50, 0)')
    transform.set(b, 'matrix(1, 0, 0, 1, 50, 0)')
    const f = flip()
    f.enter!([a, b])

    layout.set(a, { left: 100, top: 0 })
    layout.set(b, { left: 0, top: 10 })
    f.onTransition!({ entering: [], leaving: [], parent })
    animations[0]!.settle()
    await Promise.resolve()
    await Promise.resolve()

    // `a` moves again, `b` has not moved since the baseline.
    layout.set(a, { left: 200, top: 0 })
    log.length = 0
    f.onTransition!({ entering: [], leaving: [], parent })

    // Two rects + ONE computed transform (the moving row's author capture).
    expect(log.filter((op) => op === 'read')).toHaveLength(3)
    expect(forcedLayouts(log)).toBe(1)
  })

  it('cancels a still-running glide when the row turns out not to have moved', async () => {
    // dx/dy of 0 means no new animation is needed — but the glide already in
    // flight still owns the row's `transform` and would keep translating it, so
    // the pass must supersede it before bailing out.
    const { parent, children, layout, transform, animations } = makeList(1)
    const child = children[0]!
    const f = flip()
    f.enter!([child])

    layout.set(child, { left: 100, top: 0 })
    f.onTransition!({ entering: [], leaving: [], parent })
    expect(animations).toHaveLength(1)

    // Mid-glide at −40, and the row's new layout box is exactly where it
    // currently appears: prev(100) + glide(−40) − layout(60) === 0.
    transform.set(child, 'translate(-40px, 0px)')
    layout.set(child, { left: 60, top: 0 })
    f.onTransition!({ entering: [], leaving: [], parent })

    expect(animations).toHaveLength(1) // nothing new to play…
    expect(animations[0]!.cancelled).toBe(1) // …and the old one is stopped.
    await Promise.resolve()
  })

  // ── Issue #144 — composing the row's own transform ────────────────────────
  //
  // A running WAAPI animation wins the cascade for the property it animates, so
  // keyframes naming a bare `translate(...)` REPLACE the row's own `transform`
  // for the length of the glide: the row jumps by that amount when the glide
  // starts and jumps back when it ends. Measured in Chromium 143 against the
  // real `flip()`: a `.lift { transform: translateY(-20px) }` row resting at
  // `top: 0` reported `top: 22` one frame into a 60px glide, and its computed
  // transform was `matrix(1, 0, 0, 1, 0, -57.99)` — the author's −20 gone.
  // Composing the same author transform into both keyframes held it at `top: 0`.
  //
  // jsdom cannot arbitrate any of that (it has no cascade for `transform` and no
  // WAAPI), so what is asserted here is the EMITTED KEYFRAMES.
  describe('author-transform composition (#144)', () => {
    const AUTHOR = 'matrix(1, 0, 0, 1, 0, -20)' // translateY(-20px), as a browser reports it

    it('composes the row’s own transform into BOTH keyframes', () => {
      const { parent, children, layout, transform, animations } = makeList(1)
      const child = children[0]!
      transform.set(child, AUTHOR)
      const f = flip()
      f.enter!([child]) // baseline: layout {0,0}, so the row rests at −20

      layout.set(child, { left: 0, top: 100 })
      f.onTransition!({ entering: [], leaving: [], parent })

      // Start keyframe: where the row WAS, with its own transform intact — so
      // the first frame of the glide is exactly where it already was (no jump
      // in). End keyframe: its own transform alone — so the frame the animation
      // stops overriding is identical to the one before (no jump out).
      expect(animations[0]!.keyframes).toEqual([
        { transform: `translate(0px, -100px) ${AUTHOR}` },
        { transform: `translate(0, 0) ${AUTHOR}` },
      ])
    })

    it('emits the bare keyframes for a row with no transform of its own', () => {
      const { parent, children, layout, animations } = makeList(1)
      const child = children[0]!
      const f = flip()
      f.enter!([child])

      layout.set(child, { left: 100, top: 0 })
      f.onTransition!({ entering: [], leaving: [], parent })

      expect(animations[0]!.keyframes).toEqual([
        { transform: 'translate(-100px, 0px)' },
        { transform: 'translate(0, 0)' },
      ])
    })

    it('measures OUR glide alone while a composed glide is in flight', () => {
      // The composition feeds back into the read phase: the computed transform
      // of a composed glide is `translate(g)·author`, whose matrix translation
      // is `g + author.translation`. Attributing all of that to the glide
      // corrupts the delta of an INTERRUPTED reorder by exactly the author's
      // offset — the #107 failure mode, reintroduced through the fix for #144.
      const { parent, children, layout, transform, animations } = makeList(1)
      const child = children[0]!
      transform.set(child, AUTHOR)
      const f = flip()
      f.enter!([child]) // rests at −20 (layout 0 + author −20)

      layout.set(child, { left: 0, top: 100 })
      f.onTransition!({ entering: [], leaving: [], parent })
      expect(animations[0]!.keyframes).toEqual([
        { transform: `translate(0px, -100px) ${AUTHOR}` },
        { transform: `translate(0, 0) ${AUTHOR}` },
      ])

      // 40% through: the glide has −60 left to run, and the browser reports the
      // COMPOSED value — −60 plus the author's −20.
      transform.set(child, 'matrix(1, 0, 0, 1, 0, -80)')
      // The row appears at 100 − 80 = 20, and must reach 200 − 20 = 180.
      layout.set(child, { left: 0, top: 200 })
      f.onTransition!({ entering: [], leaving: [], parent })

      expect(animations[1]!.keyframes).toEqual([
        { transform: `translate(0px, -160px) ${AUTHOR}` },
        { transform: `translate(0, 0) ${AUTHOR}` },
      ])
    })

    it('reads the author transform in the READ phase, ahead of every write', () => {
      // The composition's read has to sit with the other reads. Taken in the
      // write phase instead — after the `cancel()` that supersedes a row's
      // in-flight glide — it puts a read between two writes, and #107's
      // one-forced-layout-per-pass becomes one per row again.
      const { parent, children, layout, transform, log } = makeList(2)
      const [settled, gliding] = children as [HTMLElement, HTMLElement]
      transform.set(settled, AUTHOR)
      transform.set(gliding, AUTHOR)
      const f = flip()
      f.enter!([settled, gliding])

      // Put `gliding` mid-glide so the next pass has a `cancel()` to issue.
      layout.set(gliding, { left: 0, top: 100 })
      f.onTransition!({ entering: [], leaving: [], parent })
      transform.set(gliding, 'matrix(1, 0, 0, 1, 0, -80)')

      // Now BOTH rows move: one settled (its author transform must be read),
      // one mid-glide (its capture is reused, and its glide is cancelled).
      layout.set(settled, { left: 50, top: 0 })
      layout.set(gliding, { left: 0, top: 200 })
      log.length = 0
      f.onTransition!({ entering: [], leaving: [], parent })

      expect(forcedLayouts(log)).toBe(1)
      expect(log.lastIndexOf('read')).toBeLessThan(log.indexOf('write'))
    })

    it('reuses the capture for a row that is already mid-glide', async () => {
      // Our own animation owns `transform` while it runs, so the computed value
      // is OURS, not the author's — re-reading it there would compose the glide
      // into its own keyframes. The capture from the glide's start is reused,
      // and refreshed the next time the row is settled.
      const { parent, children, layout, transform, animations, log } = makeList(1)
      const child = children[0]!
      transform.set(child, AUTHOR)
      const f = flip()
      f.enter!([child])

      layout.set(child, { left: 0, top: 100 })
      f.onTransition!({ entering: [], leaving: [], parent })

      // Mid-glide, the row moves again. What is readable now is the composed
      // value; the author transform must come from the earlier capture.
      transform.set(child, 'matrix(1, 0, 0, 1, 0, -80)')
      layout.set(child, { left: 0, top: 200 })
      log.length = 0
      f.onTransition!({ entering: [], leaving: [], parent })

      expect(animations[1]!.keyframes).toEqual([
        { transform: `translate(0px, -160px) ${AUTHOR}` },
        { transform: `translate(0, 0) ${AUTHOR}` },
      ])
      // One rect + the in-flight glide's translation. No author read: there is
      // nothing readable to re-read.
      expect(log.filter((op) => op === 'read')).toHaveLength(2)

      // Once the row settles, the author transform is read afresh — a row whose
      // own transform CHANGED while it glided picks the new value up here.
      animations[1]!.settle()
      await Promise.resolve()
      await Promise.resolve()
      transform.set(child, 'matrix(1, 0, 0, 1, 0, -5)')
      layout.set(child, { left: 0, top: 300 })
      f.onTransition!({ entering: [], leaving: [], parent })
      expect(animations[2]!.keyframes).toEqual([
        { transform: 'translate(0px, -115px) matrix(1, 0, 0, 1, 0, -5)' },
        { transform: 'translate(0, 0) matrix(1, 0, 0, 1, 0, -5)' },
      ])
    })
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
