import type { TransitionOptions } from '@llui/dom'
import type { RunScope } from './anim.js'
import { asElements } from './style-utils.js'
import { prefersReducedMotion, createRunScope } from './anim.js'

export interface FlipOptions {
  duration?: number
  easing?: string
  /** Honor `prefers-reduced-motion` (default: true) — skip the reorder animation (rows jump) when reduced motion is requested. */
  respectReducedMotion?: boolean
}

/** An element's position, kept as plain numbers so no DOMRect is retained. */
interface Point {
  left: number
  top: number
}

const NO_TRANSLATION: Point = { left: 0, top: 0 }

/**
 * A row's last-known position, measured BOTH ways available — because neither
 * measurement alone is both transform-free and sub-pixel exact, and the delta
 * needs to be both.
 *
 * - {@link TrackedPosition.layout} is `offsetLeft`/`offsetTop`: the layout box
 *   itself, by definition, with no transform of anyone's folded in — but the
 *   CSSOM returns it as a `long`, so it is quantized to whole pixels (measured
 *   in Chromium 143: rows on a 33.333px pitch report 0/33/67/100/133/167 against
 *   true tops of 0/33.33/66.66/99.98/133.31/166.64).
 * - {@link TrackedPosition.visual} is `getBoundingClientRect()` with our own
 *   glide subtracted back out: sub-pixel exact, but it carries the row's AUTHOR
 *   transform, every ancestor transform, and the scroll position with it.
 *
 * See {@link layoutDelta} for how the two combine.
 */
interface TrackedPosition {
  layout: Point
  visual: Point
}

/**
 * The offset parent's padding-box origin in document layout coordinates.
 *
 * Unlike a rect, this chain excludes transforms and scroll. Adding it to a
 * row's local offsets therefore gives the same coordinate system before and
 * after an ancestor becomes positioned (#217). Origins are cached by offset
 * parent, so the usual homogeneous list pays for one chain walk while a list
 * containing a hidden/fixed row remains correct too.
 */
function offsetParentOrigin(offsetParent: Element | null): Point {
  let current = offsetParent instanceof HTMLElement ? offsetParent : null
  let left = 0
  let top = 0

  // BODY/HTML are the stable root of the offset coordinate system. Stopping
  // here also avoids four reads whose values cannot rebase a descendant.
  while (current && current !== document.body && current !== document.documentElement) {
    left += current.offsetLeft + current.clientLeft
    top += current.offsetTop + current.clientTop
    const next = current.offsetParent
    current = next instanceof HTMLElement ? next : null
  }
  return { left, top }
}

function layoutPosition(el: HTMLElement, origins: Map<Element | null, Point>): Point {
  const offsetParent = el.offsetParent
  let origin = origins.get(offsetParent)
  if (!origin) {
    origin = offsetParentOrigin(offsetParent)
    origins.set(offsetParent, origin)
  }
  return { left: el.offsetLeft + origin.left, top: el.offsetTop + origin.top }
}

/**
 * The widest a delta of two whole-pixel layout positions can differ from the
 * true one.
 *
 * Rounding puts each position's residue in the HALF-OPEN interval
 * `(-0.5, +0.5]` — half a pixel IS attained at the top (`Math.round(0.5) === 1`)
 * and is NOT at the bottom — so the two residues of a difference cannot sit at
 * opposite closed ends and the difference is off by strictly less than one.
 * (Measured sup over a 1/64 grid: 0.984375.) The bound is 1 because the interval
 * is half-open, NOT because either residue is under half a pixel — it is exactly
 * half a pixel that often.
 */
const QUANTIZATION = 1

/**
 * How far the row's LAYOUT box moved along one axis, between the pass that
 * stored `prev` and this one.
 *
 * `fine` — the sub-pixel rect delta — is the layout delta PLUS whatever changed
 * about the row's author transform, its ancestors' transforms, and the scroll
 * position in between. `coarse` — the offset delta — is the layout delta alone,
 * to within {@link QUANTIZATION}.
 *
 * So the two agreeing means nothing but layout moved, and `fine` is then the
 * same number at higher precision. The two DISAGREEING is the whole of issue
 * #185: the difference is real displacement that is not layout, must not be
 * animated as if it were, and has no sub-pixel source — `coarse` is the best
 * answer that exists, and it is exact to under a pixel where the alternative was
 * wrong by the entire change (measured: a row whose author transform went
 * `translateY(-20px)` → `translateY(-50px)` while settled glided 90px for a 60px
 * move, and jumped 30px at glide start).
 *
 * Reading the author transform per row instead would make `fine` usable
 * everywhere — and would put a `getComputedStyle` on every SETTLED row of every
 * structural reconcile, which is the cost balance #137 struck and #107 measured.
 * `offsetLeft`/`offsetTop` are reads like the rect: they force no layout of
 * their own once the pass's first read has flushed one.
 *
 * THE COST, stated at its real size: preferring `fine` absorbs a non-layout
 * change too small to be told apart from quantization, and that window is just
 * under TWO pixels, not one. Agreement is `|A - e| <= 1` for a non-layout change
 * `A` against a quantization residue `e` that is itself under 1, so any
 * `|A| < 2` can be taken for a move. Brute-force sweep over a 1/64 grid: worst
 * absorbed 1.984375px (at `p = -2.515625`, `c = -2.5`), worst error when the
 * fallback DOES fire 0.984375px, and a pure layout move (`A = 0`) is never
 * misrouted and always exact. Reproduced in Chromium rather than only derived: a
 * row at a 0.4375px offset moving 10.125px while its author transform changes by
 * 1.875px emits `translate(0px, -12px)` — `fine` 12 against `coarse` 11 — and
 * the pre-#185 code emits the same keyframe there. Bounded by the change itself,
 * against the WHOLE change (30px, 33.66px) before #185, but it is 2px, not 1.
 */
function layoutDelta(prev: TrackedPosition, current: TrackedPosition, axis: keyof Point): number {
  const fine = current.visual[axis] - prev.visual[axis]
  const coarse = current.layout[axis] - prev.layout[axis]
  return Math.abs(fine - coarse) <= QUANTIZATION ? fine : coarse
}

/**
 * A row's OWN `transform` — the one the author declared (a hover lift, a drag
 * offset, `scale(1.02)` on the active row) — captured while no glide of ours is
 * overriding it.
 */
interface AuthorTransform {
  /** The computed value, or `''` when the element has none. */
  css: string
  /**
   * Its translation component. A composed keyframe serializes as
   * `translate(dx, dy) <author>`, whose matrix translation is `(dx, dy)` PLUS
   * this — so the read phase subtracts it back out to recover our glide alone.
   */
  translation: Point
}

const NO_AUTHOR_TRANSFORM: AuthorTransform = { css: '', translation: NO_TRANSLATION }

/** The glide's resting end. Kept unitless so an uncomposed keyframe is unchanged. */
const IDENTITY = 'translate(0, 0)'

/** The element's computed `transform`, normalized so "none" reads as `''`. */
function readTransform(el: HTMLElement): string {
  if (typeof getComputedStyle !== 'function') return ''
  const raw = getComputedStyle(el).transform
  return !raw || raw === 'none' ? '' : raw
}

/**
 * The row's own transform, for composing into a glide's keyframes. Only valid
 * while no animation of ours is running on the element — a running WAAPI
 * animation wins the cascade for `transform`, so `getComputedStyle` would report
 * OUR value, not the author's.
 */
function readAuthorTransform(el: HTMLElement): AuthorTransform {
  const css = readTransform(el)
  if (css === '') return NO_AUTHOR_TRANSFORM
  return { css, translation: parseTranslation(css) }
}

/**
 * The translation an in-flight glide has currently applied, read from the
 * element's computed `transform`.
 *
 * Browsers serialize a computed transform as `matrix()` / `matrix3d()`; jsdom
 * and some non-browser DOMs echo the authored function instead, so the
 * `translate()` forms are parsed too. Anything else (a rotate, a scale, a
 * shorthand we don't recognize) reads as no translation — over-reporting a
 * translation would move a row that isn't gliding, under-reporting only falls
 * back to the pre-#107 layout-box delta.
 */
function currentTranslation(el: HTMLElement): Point {
  return parseTranslation(readTransform(el))
}

function parseTranslation(raw: string): Point {
  if (raw === '') return NO_TRANSLATION

  const matrix = raw.match(/^matrix\(([^)]*)\)$/)
  if (matrix) {
    const parts = matrix[1]!.split(',')
    // matrix(a, b, c, d, tx, ty)
    return { left: numberAt(parts, 4), top: numberAt(parts, 5) }
  }
  const matrix3d = raw.match(/^matrix3d\(([^)]*)\)$/)
  if (matrix3d) {
    const parts = matrix3d[1]!.split(',')
    // A 4×4 column-major matrix: the translation lives at m41/m42.
    return { left: numberAt(parts, 12), top: numberAt(parts, 13) }
  }
  const translate = raw.match(/^translate(?:3d)?\(([^)]*)\)$/)
  if (translate) {
    const parts = translate[1]!.split(',')
    return { left: numberAt(parts, 0), top: numberAt(parts, 1) }
  }
  return NO_TRANSLATION
}

function numberAt(parts: readonly string[], index: number): number {
  const n = parseFloat(parts[index] ?? '')
  return Number.isNaN(n) ? 0 : n
}

/**
 * End `token`'s glide run once the animation completes.
 *
 * The run is what {@link currentTranslation} is gated on, and the gate exists
 * precisely so a row's CONSTANT author transform (a hover lift, a drag offset)
 * is never mistaken for a glide of ours. A run that is registered and never
 * ended therefore does not merely leak a WeakMap entry: from the row's first
 * glide onward every pass attributes the AUTHOR's translation to us and
 * computes the delta against it — one reorder in three silently animating the
 * wrong distance, one not animating at all. `fill: 'backwards'` means the
 * element is back on its own `transform` the moment the glide ends, so the run
 * must end with it.
 *
 * `Animation.finished` is the standard completion signal, but `animate()` is
 * only feature-detected as a function here: a shim (or a test double) may
 * return nothing at all, or an object without `finished`. There the run simply
 * stays registered until the next pass supersedes it, which is the pre-fix
 * behaviour and no worse.
 *
 * A CANCELLED animation REJECTS `finished`, and BOTH outcomes end the run. No
 * error is lost by not rethrowing — cancellation is the only thing `finished`
 * ever rejects with — but the cleanup obligation is identical, and only ONE of
 * the two cancel sources is covered elsewhere: our own supersede, which has
 * already replaced the entry by the time the rejection lands. Anything else
 * that cancels the glide (author code, devtools, an
 * `el.getAnimations().forEach(a => a.cancel())`) would otherwise leave the run
 * registered forever and put the row straight back into the defect above.
 * Ending on both paths is safe precisely because `end` is token-guarded: on the
 * supersede path the entry is either gone or already `token2`'s, so the call is
 * a no-op.
 */
function endRunOnFinish(
  glides: RunScope,
  child: Element,
  animation: Animation,
  token: symbol,
): void {
  const finished: Promise<unknown> | undefined = animation?.finished
  if (finished === undefined || typeof finished.then !== 'function') return
  const done = (): void => glides.end(child, token)
  void finished.then(done, done)
}

/**
 * FLIP (First-Last-Invert-Play) reorder animation for keyed lists.
 *
 * `onTransition` runs after a reconcile with `{ entering, leaving, parent }`.
 * It compares each surviving child's last-known LAYOUT position (kept in a
 * `WeakMap<Element, TrackedPosition>`) against its new one and, for any that
 * moved, plays an inverse-then-identity transform so the row appears to glide.
 *
 * A pass is split into a read phase and a write phase: every measurement
 * (`getBoundingClientRect`, `offsetLeft`/`offsetTop`, the computed transform)
 * happens before the first `cancel()`/`animate()`, so a K-row reorder forces
 * layout ONCE rather than once per row. Do not reintroduce a write between the
 * reads. (Measured in Chromium 143 over a 200-row list via CDP
 * `Performance.getMetrics` → `LayoutCount`, with layout left dirty as a
 * reconcile leaves it: 1 forced layout for a settled pass, 1 for a pass where
 * every row moves, 1 for a pass over rows already mid-glide. The same probe
 * reports 200 for a deliberately interleaved read/write loop.)
 *
 * What the glide animates is the row's LAYOUT move, and nothing else. That is
 * why the bookkeeping stores the layout box rather than the box the row is
 * DRAWN in: the two differ by the row's own transform, which can change between
 * two passes entirely independently of layout, and attributing that change to a
 * move animates the row from a position it was never in (#185 — measured in
 * Chromium: a row whose author transform changed `translateY(-20px)` →
 * `translateY(-50px)` while settled glided 90px for a 60px move and jumped 30px
 * at glide start; a row whose author transform was mid CSS-transition folded the
 * in-flight 33.66px into `dx` and jumped by it). Neither available measurement
 * is on its own both transform-free and sub-pixel exact, so both are taken and
 * {@link layoutDelta} decides — see there, including why reading the author
 * transform per row instead is not free, and the size of the one case it gets
 * wrong.
 *
 * The offsets are normalized through their shared offset-parent chain (#217).
 * Without that rebase, an ancestor going `static → relative` or `static →
 * sticky` in the same update changed the origin under every stored pair. In the
 * four-row Chromium fixture that emitted 310px/190px for the reordered rows and
 * 250px for each untouched row; normalization emits the actual +60px/−60px and
 * nothing for the other two. The chain contains layout coordinates only, so a
 * 200px page scroll or a 150px inner-scroller move remains absent from the
 * result, preserving #185's scroll fix.
 *
 * Origins are cached per distinct offset parent, so normalization adds one
 * `offsetParent` read per row but not a tree walk per row. Measured in Chromium
 * 147 on that four-row, one-ancestor pass: each row reads one rect, two offsets,
 * and its offset parent; the shared chain adds the ancestor's two offsets, two
 * client-border reads, and its offset parent. Total: 4 rects, 10 row/ancestor
 * offsets, 2 client-border reads, 5 offset-parent reads, one forced layout, and
 * computed style only for the two rows that actually glide (zero style reads
 * for every settled row).
 *
 * Interruption: the live `Animation` is retained per element and cancelled
 * before the next one starts, and the translation the running glide had already
 * applied is ADDED back to the delta, so an interrupted reorder continues from
 * where the row currently appears rather than jumping. That translation is also
 * subtracted from the rect before storing it, so the stored pair still describes
 * a settled row. The run ENDS when the glide completes (or is cancelled by
 * anyone, including someone other than us): only while one is live is the
 * computed transform ours to read, and a run left registered makes every later
 * pass measure a row's own author transform as if it were a glide.
 *
 * Composition (#144): a WAAPI animation wins the cascade for the property it
 * animates, so keyframes naming a bare `translate(...)` REPLACE the row's own
 * `transform` for the length of the glide. A row carrying a constant author
 * transform therefore jumped by that amount when a glide started and jumped back
 * when it ended (measured in Chromium: a `.lift { transform: translateY(-20px) }`
 * row resting at `top: 0` reported `top: 22` one frame into a 60px glide). Both
 * keyframes are therefore emitted as `translate(…) <author transform>`, which
 * puts the glide OUTSIDE the author's transform — the translation then means the
 * same thing whatever the author's linear part is, and a row with no transform
 * of its own still gets exactly the bare keyframes it always did.
 *
 * The author transform is read in the read phase, and ONLY for a row that is
 * about to glide: rows that did not move keep paying nothing, which is the cost
 * balance #137 struck when it stopped reading the computed transform on every
 * settled row forever. A row that IS mid-glide cannot be read at all (our own
 * animation owns `transform`), so the value captured when its glide started is
 * cached and reused — an author transform that CHANGES mid-glide is therefore
 * carried at its old value until the row next settles. That caveat is about the
 * RENDERING only; the row's delta is unaffected, because the delta no longer
 * reads the author transform at all (#185).
 *
 * The composition feeds back into the delta: the computed transform of a
 * composed glide carries the author's translation too, so the read phase
 * subtracts the cached author translation to recover our glide alone. Matrix
 * multiplication makes that exact — `translate(g)·A` has translation
 * `g + A.translation` for any A.
 *
 * Element retention is deliberately weak: the tracked positions live in a
 * `WeakMap` and the working set is derived from `parent`'s live children
 * (minus `leaving`) on each pass, so bulk-removed rows are never held and are
 * free to be garbage-collected. There is no independent strong Set.
 *
 * Combine with an item-level appear/disappear preset via `mergeTransitions`:
 *
 * ```ts
 * mergeTransitions(fade(), flip())
 * ```
 *
 * The signal `each()` primitive invokes `onTransition` (with the entering /
 * leaving / parent for the reconcile), so passing `flip()` as `each`'s trailing
 * transition argument animates surviving rows to their new positions:
 *
 * ```ts
 * each(state.at('rows'), r => r.id, row, undefined, flip({ duration: 300 }))
 * // or combined with an appear/disappear preset:
 * each(state.at('rows'), r => r.id, row, undefined, mergeTransitions(fade(), flip()))
 * ```
 *
 * Requires WAAPI (`element.animate()`). In environments without it (old
 * browsers, minimal jsdom) positions are still tracked but no animation runs.
 */
export function flip(opts: FlipOptions = {}): TransitionOptions {
  const duration = opts.duration ?? 300
  const easing = opts.easing ?? 'ease-out'
  const respectReduced = opts.respectReducedMotion !== false
  // Weak: entries vanish with their elements. No strong retention of rows. The
  // last-known LAYOUT box must outlive by far the glide that read it, which is
  // exactly why it cannot live on the run scope.
  // run-scope-exempt: geometry, not liveness
  const positions = new WeakMap<Element, TrackedPosition>()
  // The row's OWN transform, captured the last time one was readable (i.e. with
  // no glide of ours overriding it). Weak for the same reason as `positions`,
  // and off the run scope for the same reason: it must outlive the glide that
  // reads it, since a glide's own keyframes are what make it unreadable.
  // run-scope-exempt: geometry, not liveness
  const authors = new WeakMap<Element, AuthorTransform>()
  // The live glide per element, held on the package's shared run registry (#111):
  // the run's rollback IS `animation.cancel()`, so superseding a row's run is
  // exactly "stop the glide in flight", and `isActive` answers "is this row
  // mid-glide" for the read phase.
  const glides = createRunScope()

  /**
   * Seed the baseline pair for rows that just entered, one frame later (so the
   * row has been laid out).
   *
   * The rect is stored verbatim here — there is no glide to subtract for a row
   * that has just entered, and for the one case where there might be (an element
   * resurrected while its own glide still runs) the paired offsets are clean
   * regardless, so {@link layoutDelta} falls back to them rather than believing
   * a polluted rect.
   */
  const captureAfterFrame = (els: HTMLElement[]): void => {
    const run = (): void => {
      // run-scope-exempt: per-capture coordinate origins, dead when this callback returns
      const origins = new Map<Element | null, Point>()
      for (const el of els) {
        if (!el.isConnected) continue
        const rect = el.getBoundingClientRect()
        positions.set(el, {
          visual: { left: rect.left, top: rect.top },
          layout: layoutPosition(el, origins),
        })
      }
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run)
    } else {
      run()
    }
  }

  return {
    // Seed a baseline position for freshly entering rows.
    enter: (nodes: Node[]) => {
      captureAfterFrame(asElements(nodes))
    },
    // No bookkeeping needed: leaving rows are excluded via `ctx.leaving`, and
    // the WeakMap drops them once detached.
    leave: () => {},
    onTransition: (ctx) => {
      const parent = ctx.parent as Element | null | undefined
      if (!parent) return
      // run-scope-exempt: per-pass locals, dead when this pass returns
      const leaving = new Set<Element>(asElements(ctx.leaving))
      // run-scope-exempt: per-pass locals, dead when this pass returns
      const entering = new Set<Element>(asElements(ctx.entering))
      // Hoisted: the setting is the same for every row, and a `matchMedia` call
      // per row would sit in the middle of the read phase for no gain.
      const reduced = respectReduced && prefersReducedMotion()

      // ── Read phase. Nothing from here to the write phase may touch the DOM:
      // one write between two reads costs a forced layout PER ROW instead of one
      // for the pass (#107). Both loops below are reads.
      const measured: Array<{
        child: HTMLElement
        position: TrackedPosition
        glide: Point
      }> = []
      // run-scope-exempt: per-pass coordinate origins, dead when this pass returns
      const origins = new Map<Element | null, Point>()
      for (const child of Array.from(parent.children)) {
        if (!(child instanceof HTMLElement)) continue
        if (leaving.has(child)) continue
        // Only OUR glide displaces the row from where the two measurements below
        // agree, and only while one is live is the computed transform ours to
        // read at all. What is there then is `translate(glide) <author
        // transform>`, whose matrix translation is the sum of the two — so the
        // author's half (captured before this glide started) comes back out.
        let glide = NO_TRANSLATION
        if (glides.isActive(child)) {
          const composed = currentTranslation(child)
          const author = (authors.get(child) ?? NO_AUTHOR_TRANSFORM).translation
          glide = { left: composed.left - author.left, top: composed.top - author.top }
        }
        const rect = child.getBoundingClientRect()
        // Both measurements, and no `getComputedStyle` among them for a settled
        // row: `offsetLeft`/`offsetTop` are the layout box directly, so nothing
        // has to be subtracted from them to get there. See {@link layoutDelta}.
        measured.push({
          child,
          position: {
            visual: { left: rect.left - glide.left, top: rect.top - glide.top },
            layout: layoutPosition(child, origins),
          },
          glide,
        })
      }

      // Still the read phase: decide what each row needs and read the author
      // transform of the ones that will actually glide. `positions` is a plain
      // WeakMap write, and `supersede`/`animate` — the DOM writes — are deferred
      // to the loop after this one.
      const plays: Array<{ child: HTMLElement; dx: number; dy: number; author: AuthorTransform }> =
        []
      const stops: HTMLElement[] = []
      for (const { child, position, glide } of measured) {
        const prev = positions.get(child)
        positions.set(child, position)

        // Entering rows have no meaningful "First" yet — the baseline is enough.
        if (!prev || entering.has(child) || reduced) continue

        // The glide covers exactly two things: how far the row's LAYOUT box
        // moved, and how far the interrupted glide had already carried it (using
        // the layout move alone is what made an interrupted reorder jump).
        // Nothing else — a row whose author transform changed is ALREADY drawn
        // at the new value, on both sides of the reconcile, and re-animating
        // that change would move the row somewhere it never was (#185).
        const dx = glide.left - layoutDelta(prev, position, 'left')
        const dy = glide.top - layoutDelta(prev, position, 'top')
        // Nothing to play — but a glide still in flight owns the row's
        // `transform` and would keep translating it toward a target this pass
        // has just invalidated, so it is stopped rather than left running.
        if (dx === 0 && dy === 0) {
          stops.push(child)
          continue
        }
        if (typeof child.animate !== 'function') continue

        // The one extra read this pass pays, and only for a row that is about to
        // be animated anyway. A row mid-glide cannot be read (our own animation
        // owns `transform`), so its capture is reused.
        const author = glides.isActive(child)
          ? (authors.get(child) ?? NO_AUTHOR_TRANSFORM)
          : readAuthorTransform(child)
        authors.set(child, author)
        plays.push({ child, dx, dy, author })
      }

      // ── Write phase.
      for (const child of stops) glides.supersede(child)
      for (const { child, dx, dy, author } of plays) {
        // Supersede cancels the glide still in flight, if any.
        glides.supersede(child)
        const from = `translate(${dx}px, ${dy}px)`
        const animation = child.animate(
          [
            { transform: author.css === '' ? from : `${from} ${author.css}` },
            { transform: author.css === '' ? IDENTITY : `${IDENTITY} ${author.css}` },
          ],
          { duration, easing, fill: 'backwards' },
        )
        // `?.` for the same reason `endRunOnFinish` guards: `animate()` is only
        // feature-detected as a function, and a shim may hand back nothing.
        const token = glides.register(child, () => animation?.cancel())
        endRunOnFinish(glides, child, animation, token)
      }
    },
  }
}

/**
 * Merge multiple TransitionOptions into one, chaining their `enter`,
 * `leave`, and `onTransition` handlers in order. `leave` waits for every
 * part's returned Promise before resolving.
 *
 * Useful for combining an item-level animation (fade/slide/...) with flip():
 *
 * ```ts
 * mergeTransitions(fade(), flip())
 * ```
 *
 * The merged bundle is passed as the trailing transition argument to
 * `show`/`branch`/`each` (or adapted onto a route via `fromTransition`); `each`
 * drives the `onTransition` half of a `flip()` part. See `flip()`.
 */
export function mergeTransitions(...parts: TransitionOptions[]): TransitionOptions {
  const enters = parts.map((p) => p.enter).filter((f): f is NonNullable<typeof f> => !!f)
  const leaves = parts.map((p) => p.leave).filter((f): f is NonNullable<typeof f> => !!f)
  const onTs = parts.map((p) => p.onTransition).filter((f): f is NonNullable<typeof f> => !!f)

  const out: TransitionOptions = {}
  if (enters.length > 0) {
    out.enter = (nodes: Node[]) => {
      for (const fn of enters) void fn(nodes)
    }
  }
  if (leaves.length > 0) {
    out.leave = (nodes: Node[]) => {
      // Wait for all leaves to resolve.
      const results = leaves.map((fn) => fn(nodes))
      const promises = results.filter(
        (r): r is Promise<void> => !!r && typeof (r as Promise<void>).then === 'function',
      )
      if (promises.length === 0) return
      return Promise.all(promises).then(() => undefined)
    }
  }
  if (onTs.length > 0) {
    out.onTransition = (ctx) => {
      for (const fn of onTs) void fn(ctx)
    }
  }
  return out
}
