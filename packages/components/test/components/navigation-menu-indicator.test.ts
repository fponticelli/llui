import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { init, connect, watchNavMenuIndicator } from '../../src/components/navigation-menu'
import { rootSignal, read } from '../_signal'

describe('navigation-menu indicator part', () => {
  it('names the part so a recipe can target it', () => {
    const parts = connect(rootSignal(), vi.fn(), { id: 'nav' })
    expect(parts.indicator['data-scope']).toBe('navigation-menu')
    expect(parts.indicator['data-part']).toBe('indicator')
  })

  it('is hidden while nothing is open and visible once a branch opens', () => {
    const parts = connect(rootSignal(), vi.fn(), { id: 'nav' })
    expect(read(parts.indicator['data-state'], init())).toBe('hidden')
    expect(read(parts.indicator['data-state'], init({ open: ['file'] }))).toBe('visible')
  })

  // A nested branch keeps the arrow up: `open` is root-first, so a non-empty
  // list always still has the top-level entry the arrow points at.
  it('stays visible while a nested branch is the deepest open one', () => {
    const parts = connect(rootSignal(), vi.fn(), { id: 'nav' })
    expect(read(parts.indicator['data-state'], init({ open: ['file', 'recent'] }))).toBe('visible')
  })
})

interface Box {
  left: number
  top: number
  width: number
  height: number
}

function stubRect(el: Element, b: Box): void {
  el.getBoundingClientRect = (): DOMRect =>
    ({
      x: b.left,
      y: b.top,
      left: b.left,
      top: b.top,
      width: b.width,
      height: b.height,
      right: b.left + b.width,
      bottom: b.top + b.height,
      toJSON: () => ({}),
    }) as DOMRect
}

function setProp(el: Element, key: string, value: unknown): void {
  Object.defineProperty(el, key, { value, configurable: true })
}

/**
 * Build the DOM shape the registry recipes produce:
 *
 *   root (positioned — the indicator's offsetParent)
 *     nav
 *       ul > li (POSITIONED — this is what makes `offsetLeft` useless here)
 *              > button[data-part=trigger]
 *       div[data-part=indicator]
 */
function build(): {
  root: HTMLElement
  nav: HTMLElement
  indicator: HTMLElement
  file: HTMLElement
  edit: HTMLElement
} {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  const nav = document.createElement('nav')
  const ul = document.createElement('ul')
  const trigger = (id: string): HTMLElement => {
    const li = document.createElement('li')
    const b = document.createElement('button')
    b.setAttribute('data-scope', 'navigation-menu')
    b.setAttribute('data-part', 'trigger')
    b.setAttribute('data-state', 'closed')
    b.setAttribute('data-value', id)
    li.appendChild(b)
    ul.appendChild(li)
    return b
  }
  const file = trigger('file')
  const edit = trigger('edit')
  const indicator = document.createElement('div')
  indicator.setAttribute('data-scope', 'navigation-menu')
  indicator.setAttribute('data-part', 'indicator')
  nav.appendChild(ul)
  nav.appendChild(indicator)
  root.appendChild(nav)
  document.body.appendChild(root)

  // The root is the positioned ancestor; the `li` wrappers are positioned too,
  // which is exactly why every trigger's own offsetLeft is 0 here.
  setProp(indicator, 'offsetParent', root)
  for (const b of [file, edit]) {
    setProp(b, 'offsetLeft', 0)
    setProp(b, 'offsetTop', 0)
  }
  stubRect(root, { left: 100, top: 50, width: 400, height: 36 })
  stubRect(file, { left: 140, top: 50, width: 60, height: 36 })
  stubRect(edit, { left: 210, top: 50, width: 80, height: 36 })
  return { root, nav, indicator, file, edit }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('watchNavMenuIndicator', () => {
  let dispose: (() => void) | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    dispose?.()
    dispose = null
    document.body.innerHTML = ''
  })

  it('does nothing when the consumer renders no indicator', () => {
    const { root, indicator } = build()
    indicator.remove()
    dispose = watchNavMenuIndicator(root)
    expect(dispose).toBeTypeOf('function')
    expect(() => dispose?.()).not.toThrow()
  })

  it('writes nothing while no branch is open', () => {
    const { root, indicator } = build()
    dispose = watchNavMenuIndicator(root)
    expect(indicator.style.getPropertyValue('--indicator-left')).toBe('')
  })

  // The load-bearing assertion: the offset is measured against the INDICATOR'S
  // offsetParent, not read off the trigger. Every trigger's offsetLeft is 0
  // here (its `li` is its own offset parent), so an offsetLeft-based
  // implementation writes `0px` and fails this.
  it('positions against the indicator offsetParent, not the trigger offsetLeft', () => {
    const { root, indicator, file, edit } = build()
    file.setAttribute('data-state', 'open')
    dispose = watchNavMenuIndicator(root)
    expect(indicator.style.getPropertyValue('--indicator-left')).toBe('40px')
    expect(indicator.style.getPropertyValue('--indicator-width')).toBe('60px')
    expect(indicator.style.getPropertyValue('--indicator-top')).toBe('0px')
    expect(indicator.style.getPropertyValue('--indicator-height')).toBe('36px')
  })

  it('accounts for the offset parent border and scroll', () => {
    const { root, indicator, file, edit } = build()
    setProp(root, 'clientLeft', 2)
    setProp(root, 'clientTop', 3)
    setProp(root, 'scrollLeft', 30)
    setProp(root, 'scrollTop', 5)
    file.setAttribute('data-state', 'open')
    dispose = watchNavMenuIndicator(root)
    // 140 - 100 - 2 + 30
    expect(indicator.style.getPropertyValue('--indicator-left')).toBe('68px')
    // 50 - 50 - 3 + 5
    expect(indicator.style.getPropertyValue('--indicator-top')).toBe('2px')
  })

  it('re-syncs when a trigger data-state flips', async () => {
    const { root, indicator, file, edit } = build()
    file.setAttribute('data-state', 'open')
    dispose = watchNavMenuIndicator(root)
    expect(indicator.style.getPropertyValue('--indicator-left')).toBe('40px')

    file.setAttribute('data-state', 'closed')
    edit.setAttribute('data-state', 'open')
    await tick()
    expect(indicator.style.getPropertyValue('--indicator-left')).toBe('110px')
    expect(indicator.style.getPropertyValue('--indicator-width')).toBe('80px')
  })

  // The arrow fades out in place; moving it mid-exit is the one thing that
  // looks broken, so a close must LEAVE the last position alone.
  it('keeps the last position when everything closes', async () => {
    const { root, indicator, file, edit } = build()
    edit.setAttribute('data-state', 'open')
    dispose = watchNavMenuIndicator(root)
    expect(indicator.style.getPropertyValue('--indicator-left')).toBe('110px')

    edit.setAttribute('data-state', 'closed')
    await tick()
    expect(indicator.style.getPropertyValue('--indicator-left')).toBe('110px')
  })

  // A nested trigger publishes data-state="open" too, and lives inside its
  // parent's panel — so document order puts the outermost open branch first.
  it('tracks the outermost open branch, not a nested one', () => {
    const { root, indicator, file, edit } = build()
    const panel = document.createElement('div')
    const nested = document.createElement('button')
    nested.setAttribute('data-scope', 'navigation-menu')
    nested.setAttribute('data-part', 'trigger')
    nested.setAttribute('data-state', 'open')
    stubRect(nested, { left: 300, top: 90, width: 120, height: 24 })
    panel.appendChild(nested)
    file.parentElement?.appendChild(panel)

    file.setAttribute('data-state', 'open')
    dispose = watchNavMenuIndicator(root)
    expect(indicator.style.getPropertyValue('--indicator-left')).toBe('40px')
    expect(indicator.style.getPropertyValue('--indicator-width')).toBe('60px')
  })

  it('writes nothing when the indicator has no offset parent', () => {
    const { root, indicator, file, edit } = build()
    setProp(indicator, 'offsetParent', null)
    file.setAttribute('data-state', 'open')
    dispose = watchNavMenuIndicator(root)
    expect(indicator.style.getPropertyValue('--indicator-left')).toBe('')
  })

  it('stops observing once disposed', async () => {
    const { root, indicator, file, edit } = build()
    file.setAttribute('data-state', 'open')
    const stop = watchNavMenuIndicator(root)
    expect(indicator.style.getPropertyValue('--indicator-left')).toBe('40px')
    stop()

    file.setAttribute('data-state', 'closed')
    edit.setAttribute('data-state', 'open')
    await tick()
    expect(indicator.style.getPropertyValue('--indicator-left')).toBe('40px')
  })

  it('survives an environment with no ResizeObserver', () => {
    const { root, indicator, file, edit } = build()
    const RO = globalThis.ResizeObserver
    // @ts-expect-error — deleting a global for the duration of one assertion.
    delete globalThis.ResizeObserver
    try {
      file.setAttribute('data-state', 'open')
      dispose = watchNavMenuIndicator(root)
      expect(indicator.style.getPropertyValue('--indicator-left')).toBe('40px')
    } finally {
      globalThis.ResizeObserver = RO
    }
  })

  it('re-syncs on a root resize', () => {
    const observed: Element[] = []
    const RO = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      constructor(private cb: () => void) {}
      observe(el: Element): void {
        observed.push(el)
        this.cb()
      }
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver
    try {
      const { root, indicator, file, edit } = build()
      edit.setAttribute('data-state', 'open')
      const spy = vi.spyOn(indicator.style, 'setProperty')
      dispose = watchNavMenuIndicator(root)
      expect(observed).toContain(root)
      // Once for the eager sync, once for the observe callback.
      expect(spy.mock.calls.filter((c) => c[0] === '--indicator-left')).toHaveLength(2)
      expect(indicator.style.getPropertyValue('--indicator-left')).toBe('110px')
    } finally {
      globalThis.ResizeObserver = RO
    }
  })
})

describe('navigation-menu indicator is decoration', () => {
  // The arrow duplicates what the trigger's own `aria-expanded` already says,
  // and unlike Radix's it is ALWAYS in the tree — so it must be hidden from
  // assistive tech in both states, not just while it is invisible.
  it('is aria-hidden', () => {
    const parts = connect(rootSignal(), vi.fn(), { id: 'nav' })
    expect(parts.indicator['aria-hidden']).toBe('true')
  })
})
