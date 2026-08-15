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
 * `WeakMap<Element, Point>`) against its new one and, for any that moved,
 * plays an inverse-then-identity transform so the row appears to glide.
 *
 * A pass is split into a read phase and a write phase: every measurement
 * (`getBoundingClientRect`, the computed transform) happens before the first
 * `cancel()`/`animate()`, so a K-row reorder forces layout ONCE rather than
 * once per row. Do not reintroduce a write between the reads.
 *
 * Interruption: the live `Animation` is retained per element and cancelled
 * before the next one starts, and the new delta is measured from where the row
 * VISUALLY is — its previous layout box plus whatever translation the running
 * glide had already applied — so an interrupted reorder continues rather than
 * jumping. `getBoundingClientRect` reports the transformed box, so the stored
 * position is the rect with that translation subtracted back out. The run ENDS
 * when the glide completes (or is cancelled by anyone, including someone other
 * than us): only while one is live is the computed transform ours to read, and
 * a run left registered makes every later pass measure a row's own author
 * transform as if it were a glide.
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
 * carried at its old value until the row next settles.
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
  const positions = new WeakMap<Element, Point>()
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

  const captureAfterFrame = (els: HTMLElement[]): void => {
    const run = (): void => {
      for (const el of els) {
        if (!el.isConnected) continue
        const rect = el.getBoundingClientRect()
        positions.set(el, { left: rect.left, top: rect.top })
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
      const measured: Array<{ child: HTMLElement; rect: DOMRect; glide: Point }> = []
      for (const child of Array.from(parent.children)) {
        if (!(child instanceof HTMLElement)) continue
        if (leaving.has(child)) continue
        // Only OUR glide displaces the row from its layout box, and only while
        // one is live is the computed transform ours to read at all. What is
        // there then is `translate(glide) <author transform>`, whose matrix
        // translation is the sum of the two — so the author's half (captured
        // before this glide started) comes back out.
        let glide = NO_TRANSLATION
        if (glides.isActive(child)) {
          const composed = currentTranslation(child)
          const author = (authors.get(child) ?? NO_AUTHOR_TRANSFORM).translation
          glide = { left: composed.left - author.left, top: composed.top - author.top }
        }
        measured.push({ child, rect: child.getBoundingClientRect(), glide })
      }

      // Still the read phase: decide what each row needs and read the author
      // transform of the ones that will actually glide. `positions` is a plain
      // WeakMap write, and `supersede`/`animate` — the DOM writes — are deferred
      // to the loop after this one.
      const plays: Array<{ child: HTMLElement; dx: number; dy: number; author: AuthorTransform }> =
        []
      const stops: HTMLElement[] = []
      for (const { child, rect, glide } of measured) {
        // `rect` is the VISUAL box; subtract the running glide to recover the
        // layout box, which is what a later pass must measure against.
        const layout: Point = { left: rect.left - glide.left, top: rect.top - glide.top }
        const prev = positions.get(child)
        positions.set(child, layout)

        // Entering rows have no meaningful "First" yet — the baseline is enough.
        if (!prev || entering.has(child) || reduced) continue

        // Where the row APPEARED just before this reconcile: its previous layout
        // box plus the translation the interrupted glide had reached. Using the
        // layout box alone is what made an interrupted reorder jump.
        const dx = prev.left + glide.left - layout.left
        const dy = prev.top + glide.top - layout.top
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
