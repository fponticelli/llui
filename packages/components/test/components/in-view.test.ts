import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init, update, connect } from '../../src/components/in-view'
import type { InViewState } from '../../src/components/in-view'

describe('in-view reducer', () => {
  it('initializes as not visible', () => {
    expect(init()).toEqual({ visible: false })
  })

  it('enter sets visible', () => {
    const [s] = update(init(), { type: 'enter' })
    expect(s.visible).toBe(true)
  })

  it('leave clears visible', () => {
    const [s1] = update(init(), { type: 'enter' })
    const [s2] = update(s1, { type: 'leave' })
    expect(s2.visible).toBe(false)
  })

  it('enter is idempotent', () => {
    const [s1] = update(init(), { type: 'enter' })
    const [s2] = update(s1, { type: 'enter' })
    expect(s1).toBe(s2)
  })

  it('leave is idempotent', () => {
    const s = init()
    const [s2] = update(s, { type: 'leave' })
    expect(s).toBe(s2)
  })
})

describe('in-view connect', () => {
  type Ctx = { iv: InViewState }

  it('returns root with data-scope and data-part', () => {
    const parts = connect<Ctx>((s) => s.iv, vi.fn(), { id: 'iv1' })
    expect(parts.root['data-scope']).toBe('in-view')
    expect(parts.root['data-part']).toBe('root')
  })

  it('data-state reflects visibility', () => {
    const parts = connect<Ctx>((s) => s.iv, vi.fn(), { id: 'iv1' })
    expect(parts.root['data-state']({ iv: { visible: false } })).toBe('hidden')
    expect(parts.root['data-state']({ iv: { visible: true } })).toBe('visible')
  })
})

describe('in-view observer', () => {
  let observeCb: IntersectionObserverCallback
  let observedElements: Element[]
  let disconnected: boolean
  let observerOpts: IntersectionObserverInit | undefined

  beforeEach(() => {
    observedElements = []
    disconnected = false

    vi.stubGlobal(
      'IntersectionObserver',
      class MockIntersectionObserver {
        constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
          observeCb = cb
          observerOpts = opts
        }
        observe(el: Element) {
          observedElements.push(el)
        }
        unobserve() {}
        disconnect() {
          disconnected = true
        }
      },
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('createObserver wires up IntersectionObserver', async () => {
    const { createObserver } = await import('../../src/components/in-view')
    const send = vi.fn()
    const el = document.createElement('div')

    const cleanup = createObserver(el, send, {})

    expect(observedElements).toContain(el)

    observeCb(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
    expect(send).toHaveBeenCalledWith({ type: 'enter' })

    observeCb(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
    expect(send).toHaveBeenCalledWith({ type: 'leave' })

    cleanup()
    expect(disconnected).toBe(true)
  })

  it('once mode disconnects after first enter', async () => {
    const { createObserver } = await import('../../src/components/in-view')
    const send = vi.fn()
    const el = document.createElement('div')

    createObserver(el, send, { once: true })

    observeCb(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
    expect(send).toHaveBeenCalledWith({ type: 'enter' })
    expect(disconnected).toBe(true)
  })

  it('passes threshold and rootMargin to observer', async () => {
    const { createObserver } = await import('../../src/components/in-view')
    const el = document.createElement('div')

    createObserver(el, vi.fn(), { threshold: 0.5, rootMargin: '10px' })

    expect(observerOpts?.threshold).toBe(0.5)
    expect(observerOpts?.rootMargin).toBe('10px')
  })
})
