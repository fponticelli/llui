import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transition } from '../src/transition'
import { fade, collapse } from '../src/presets'
import { routeTransition } from '../src/route-transition'

// Regression coverage for the ROUTE/CONTAINER seam.
//
// `show` / `branch` / `each` remove the element once `leave` resolves, so a
// completed leave deliberately keeps its resting values (`opacity: 0`, a
// collapsed `height`) on the element — stripping them would flash the outgoing
// content back into view for a frame before detach.
//
// `fromTransition()` in `@llui/vike/client` is different: it calls `leave` and
// then `enter` on the SAME persistent element (the surviving layer's
// `slotAnchor.parentElement`), which is never removed. If the leave's residue
// survives into the enter, the enter SNAPSHOTS it as though it were an
// author-set inline value, animates 0 → 1 correctly, and then restores the
// snapshot on cleanup — parking the page slot at `opacity: 0` one duration
// after it faded in.
//
// The contract these tests pin: a completed leave keeps its resting values, but
// a later phase on the same element rolls them back before snapshotting.
describe('reused element (route seam): leave → enter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function makeEl(): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
  }

  /** Run `leave` to completion, exactly as `renderClient` awaits `onLeave`. */
  async function runLeave(t: { leave?: (n: Node[]) => void | Promise<void> }, el: HTMLElement) {
    const result = t.leave!([el])
    await vi.advanceTimersByTimeAsync(100)
    await result
  }

  /** Fire `enter` and let its delayed cleanup run, as `onEnter` does. */
  async function runEnter(t: { enter?: (n: Node[]) => void }, el: HTMLElement) {
    t.enter!([el])
    await vi.advanceTimersByTimeAsync(100)
  }

  it('leave alone still parks the element at its leaveTo resting values', async () => {
    // The show/branch/each contract — unchanged. The element is about to be
    // removed, so it must stay hidden until it is.
    const el = makeEl()
    const t = fade({ duration: 20 })

    await runLeave(t, el)

    expect(el.style.opacity).toBe('0')
  })

  it('a following enter clears the leave residue instead of restoring it', async () => {
    const el = makeEl()
    const t = fade({ duration: 20 })

    await runLeave(t, el)
    expect(el.style.opacity).toBe('0') // residue, mid-swap

    await runEnter(t, el)

    // The slot ends fully visible with no inline leftovers at all.
    expect(el.style.opacity).toBe('')
    expect(el.style.transition).toBe('')
  })

  it('reaches full opacity during the enter, not just after cleanup', async () => {
    const el = makeEl()
    const t = fade({ duration: 20 })

    await runLeave(t, el)
    t.enter!([el])

    // After the reflow swap the element is animating toward its visible state.
    expect(el.style.opacity).toBe('1')
  })

  it('survives repeated navigations', async () => {
    const el = makeEl()
    const t = fade({ duration: 20 })

    for (let nav = 0; nav < 4; nav++) {
      await runLeave(t, el)
      await runEnter(t, el)
      expect(el.style.opacity).toBe('')
    }
  })

  it('restores an author-set inline value rather than the leave residue', async () => {
    const el = makeEl()
    el.style.opacity = '0.5' // author-set baseline the seam must not eat
    const t = fade({ duration: 20 })

    await runLeave(t, el)
    await runEnter(t, el)

    expect(el.style.opacity).toBe('0.5')
  })

  it('clears every style key the bundle touched, not just the animated one', async () => {
    const el = makeEl()
    const t = transition({
      duration: 20,
      enterActive: { transition: 'opacity 20ms', willChange: 'opacity' },
      enterFrom: { opacity: 0 },
      enterTo: { opacity: 1 },
      leaveActive: { transition: 'opacity 20ms', willChange: 'opacity' },
      leaveFrom: { opacity: 1 },
      leaveTo: { opacity: 0 },
    })

    await runLeave(t, el)
    await runEnter(t, el)

    expect(el.style.opacity).toBe('')
    expect(el.style.transition).toBe('')
    expect(el.style.willChange).toBe('')
  })

  it('removes the bundle’s classes across the cycle', async () => {
    const el = makeEl()
    const t = transition({
      duration: 20,
      enterActive: 'ea',
      enterFrom: 'ef',
      enterTo: 'et',
      leaveActive: 'la',
      leaveFrom: 'lf',
      leaveTo: 'lt',
    })

    await runLeave(t, el)
    await runEnter(t, el)

    expect(el.className).toBe('')
  })

  it('a settled leave is not mistaken for an in-flight enter by the next leave', async () => {
    // `runLeave` skips `leaveFrom` when it is interrupting a live enter (so the
    // element doesn't snap to fully-visible before animating out). A leave that
    // has already COMPLETED is not in flight, so the next leave must take the
    // normal leaveFrom → leaveTo path.
    const el = makeEl()
    const t = transition({
      duration: 20,
      leaveActive: 'la',
      leaveFrom: 'lf',
      leaveTo: 'lt',
    })

    await runLeave(t, el)

    const added: string[] = []
    const origAdd = el.classList.add.bind(el.classList)
    el.classList.add = (...tokens: string[]) => {
      added.push(...tokens)
      return origAdd(...tokens)
    }

    void t.leave!([el])

    expect(added).toContain('lf')
  })

  it('an interrupted (not completed) leave still rolls back on the enter', async () => {
    // The pre-existing supersede path: enter arrives mid-leave. Unchanged.
    const el = makeEl()
    const t = fade({ duration: 200 })

    void t.leave!([el])
    await vi.advanceTimersByTimeAsync(50) // mid-flight

    t.enter!([el])
    await vi.advanceTimersByTimeAsync(400)

    expect(el.style.opacity).toBe('')
  })

  it('routeTransition({ slide: false }) — the documented wiring — ends visible', async () => {
    const el = makeEl()
    const t = routeTransition({ duration: 20, slide: false })

    await runLeave(t, el)
    await runEnter(t, el)

    expect(el.style.opacity).toBe('')
  })

  it('routeTransition() with slide (mergeTransitions) ends visible', async () => {
    const el = makeEl()
    const t = routeTransition({ duration: 20 })

    await runLeave(t, el)
    await runEnter(t, el)

    expect(el.style.opacity).toBe('')
    expect(el.style.transform).toBe('')
  })

  it('collapse() clears its leave residue on a following enter', async () => {
    const el = makeEl()
    const t = collapse({ duration: 20 })

    await runLeave(t, el)
    // Residue while the element would normally be detached.
    expect(el.style.height).toBe('0px')
    expect(el.style.overflow).toBe('hidden')

    await runEnter(t, el)

    expect(el.style.height).toBe('')
    expect(el.style.overflow).toBe('')
    expect(el.style.transition).toBe('')
  })

  it('collapse() restores an author-set inline height across the cycle', async () => {
    const el = makeEl()
    el.style.height = '120px'
    el.style.overflow = 'auto'
    const t = collapse({ duration: 20 })

    await runLeave(t, el)
    await runEnter(t, el)

    expect(el.style.height).toBe('120px')
    expect(el.style.overflow).toBe('auto')
  })
})
