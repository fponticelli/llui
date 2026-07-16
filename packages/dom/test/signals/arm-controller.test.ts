import { describe, it, expect } from 'vitest'
import { mountSignal, requireCtx, mountable, el, staticText, onMount } from '../../src/signals/dom'
import type { Renderable } from '../../src/signals/dom'
import { ArmController } from '../../src/signals/arm-controller'
import { removeBetween } from '../../src/signals/dom-region'

// Focused unit tests for the one-mounted-arm machine shared by show / branch /
// lazy. Rather than re-test show/branch end-to-end (covered elsewhere), these drive
// an ArmController DIRECTLY through a tiny anchor-bracketed harness, pinning its
// invariants: at most one mounted arm, same-key short-circuit (no remount),
// swap tears down the old arm (running its onMount cleanups) before mounting the
// new one, an undefined arm mounts nothing, and dispose clears.

/** Mount a view that sets up an anchor-bracketed ArmController and hands it back,
 * so a test can call `switchTo` / `dispose` with full control over key + state. */
function setup(): {
  container: HTMLElement
  arm: () => ArmController<string>
  disposeMount: () => void
} {
  let armRef: ArmController<string> | null = null
  const container = document.createElement('div')
  const view = mountable(() => {
    const c = requireCtx()
    const doc = c.doc
    const start = doc.createComment('arm')
    const end = doc.createComment('/arm')
    const frag = doc.createDocumentFragment()
    frag.appendChild(start)
    frag.appendChild(end)
    armRef = new ArmController<string>({
      doc,
      buildCtx: c,
      contexts: c.contexts,
      ownerHost: c.host,
      inRow: false,
      parent: () => end.parentNode,
      insertBefore: () => end,
      clear: () => removeBetween(start, end),
    })
    c.teardowns.push(() => armRef!.dispose())
    return frag
  })
  const m = mountSignal(container, null, () => [view])
  return { container, arm: () => armRef!, disposeMount: () => m.dispose() }
}

describe('ArmController', () => {
  it('starts empty', () => {
    const { arm } = setup()
    expect(arm().isMounted).toBe(false)
    expect(arm().currentKey).toBe(null)
  })

  it('mounts one arm; swapping keys tears down the old and mounts the new', () => {
    const { container, arm } = setup()
    let aBuilds = 0
    let bBuilds = 0
    const armA = (): Renderable => {
      aBuilds++
      return [el('div', { class: 'a' }, [staticText('A')])]
    }
    const armB = (): Renderable => {
      bBuilds++
      return [el('div', { class: 'b' }, [staticText('B')])]
    }

    arm().switchTo('a', armA, null)
    expect(arm().isMounted).toBe(true)
    expect(arm().currentKey).toBe('a')
    expect(container.querySelectorAll('.a').length).toBe(1)
    expect(aBuilds).toBe(1)

    // swap → old arm removed, new arm mounted (exactly one arm at a time)
    arm().switchTo('b', armB, null)
    expect(arm().currentKey).toBe('b')
    expect(container.querySelectorAll('.a').length).toBe(0)
    expect(container.querySelectorAll('.b').length).toBe(1)
    expect(bBuilds).toBe(1)
  })

  it('same-key switchTo is a no-op (does NOT rebuild the arm)', () => {
    const { container, arm } = setup()
    let builds = 0
    const armA = (): Renderable => {
      builds++
      return [el('div', { class: 'a' }, [staticText('A')])]
    }
    arm().switchTo('a', armA, null)
    expect(builds).toBe(1)
    arm().switchTo('a', armA, null)
    arm().switchTo('a', armA, null)
    expect(builds).toBe(1) // still the original mount — no remount
    expect(container.querySelectorAll('.a').length).toBe(1)
  })

  it('an undefined arm mounts nothing (and tears down the current one)', () => {
    const { container, arm } = setup()
    arm().switchTo('a', () => [el('div', { class: 'a' }, [staticText('A')])], null)
    expect(container.querySelectorAll('.a').length).toBe(1)

    arm().switchTo('none', undefined, null)
    expect(arm().isMounted).toBe(false)
    expect(arm().currentKey).toBe(null)
    expect(container.querySelectorAll('.a').length).toBe(0)
  })

  it('runs the swapped-out arm’s onMount cleanup exactly once, on swap', () => {
    const { arm } = setup()
    let cleaned = 0
    const armWithCleanup = (): Renderable => [el('div', {}, [onMount(() => () => void cleaned++)])]
    arm().switchTo('c', armWithCleanup, null)
    expect(cleaned).toBe(0)
    arm().switchTo('d', () => [el('div', { class: 'd' }, [])], null)
    expect(cleaned).toBe(1) // cleanup fired when arm 'c' was torn down
  })

  it('dispose tears down the mounted arm and clears its nodes', () => {
    const { container, arm, disposeMount } = setup()
    arm().switchTo('a', () => [el('div', { class: 'a' }, [staticText('A')])], null)
    expect(container.querySelectorAll('.a').length).toBe(1)
    disposeMount() // runs the host teardown → armRef.dispose()
    expect(arm().isMounted).toBe(false)
    expect(container.querySelectorAll('.a').length).toBe(0)
  })
})
