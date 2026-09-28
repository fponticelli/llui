import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachFloating, type Placement } from '../src/floating'

const floatingUi = vi.hoisted(() => ({
  autoUpdate: vi.fn(),
  computePosition: vi.fn(),
  stop: vi.fn(),
  update: undefined as (() => void) | undefined,
}))

vi.mock('@floating-ui/dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floating-ui/dom')>()
  return {
    ...actual,
    autoUpdate: floatingUi.autoUpdate,
    computePosition: floatingUi.computePosition,
  }
})

type PositionResult = {
  x: number
  y: number
  placement: Placement
  strategy: 'absolute'
  middlewareData: { arrow?: { x?: number; y?: number } }
}

function positioned(placement: Placement, overrides: Partial<PositionResult> = {}): PositionResult {
  return {
    x: 12.4,
    y: 27.6,
    placement,
    strategy: 'absolute',
    middlewareData: {},
    ...overrides,
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  floatingUi.computePosition.mockReset()
  floatingUi.autoUpdate.mockReset()
  floatingUi.stop.mockReset()
  floatingUi.update = undefined
  floatingUi.autoUpdate.mockImplementation(
    (_anchor: Element, _floating: HTMLElement, update: () => void) => {
      floatingUi.update = update
      update()
      return floatingUi.stop
    },
  )
})

describe('attachFloating transactional state', () => {
  it('publishes resolved placement and physical side on a separate state target after flips', async () => {
    const anchor = document.createElement('button')
    const positioner = document.createElement('div')
    const content = document.createElement('div')
    positioner.append(content)
    floatingUi.computePosition
      .mockResolvedValueOnce(positioned('bottom-start'))
      .mockResolvedValueOnce(positioned('top-end', { x: 19, y: 4 }))

    const cleanup = attachFloating({ anchor, floating: positioner, stateTarget: content })
    await flush()

    expect(content.getAttribute('data-placement')).toBe('bottom-start')
    expect(content.getAttribute('data-side')).toBe('bottom')
    expect(positioner.hasAttribute('data-placement')).toBe(false)
    expect(positioner.hasAttribute('data-side')).toBe(false)
    expect(positioner.style.transform).toBe('translate(12px, 28px)')

    floatingUi.update?.()
    await flush()

    expect(content.getAttribute('data-placement')).toBe('top-end')
    expect(content.getAttribute('data-side')).toBe('top')
    expect(positioner.style.transform).toBe('translate(19px, 4px)')
    cleanup()
  })

  it.each([
    ['top', 'top'],
    ['top-start', 'top'],
    ['top-end', 'top'],
    ['right', 'right'],
    ['right-start', 'right'],
    ['right-end', 'right'],
    ['bottom', 'bottom'],
    ['bottom-start', 'bottom'],
    ['bottom-end', 'bottom'],
    ['left', 'left'],
    ['left-start', 'left'],
    ['left-end', 'left'],
  ] as const)('maps resolved %s placement to physical %s side', async (placement, side) => {
    const anchor = document.createElement('button')
    const floating = document.createElement('div')
    floatingUi.computePosition.mockResolvedValueOnce(positioned(placement))

    const cleanup = attachFloating({ anchor, floating })
    await flush()

    expect(floating.getAttribute('data-placement')).toBe(placement)
    expect(floating.getAttribute('data-side')).toBe(side)
    cleanup()
  })

  it('positions the arrow on both axes across flips and restores every owned inset once', async () => {
    const anchor = document.createElement('button')
    const floating = document.createElement('div')
    const content = document.createElement('div')
    const arrow = document.createElement('div')
    floating.style.setProperty('position', 'fixed', 'important')
    floating.style.setProperty('top', '11px')
    floating.style.setProperty('left', '13px', 'important')
    floating.style.setProperty('transform', 'scale(0.5)')
    content.setAttribute('data-placement', 'legacy-start')
    content.setAttribute('data-side', 'legacy')
    arrow.style.setProperty('position', 'relative', 'important')
    arrow.style.setProperty('left', '3px', 'important')
    arrow.style.setProperty('top', '5px')
    arrow.style.setProperty('right', '7px')
    arrow.style.setProperty('bottom', '9px', 'important')
    Object.defineProperties(arrow, {
      offsetWidth: { configurable: true, value: 10 },
      offsetHeight: { configurable: true, value: 8 },
    })
    const onUpdate = vi.fn()
    floatingUi.computePosition
      .mockResolvedValueOnce(positioned('bottom-start', { middlewareData: { arrow: { x: 17 } } }))
      .mockResolvedValueOnce(positioned('right-end', { middlewareData: { arrow: { y: 19 } } }))

    const cleanup = attachFloating({
      anchor,
      floating,
      stateTarget: content,
      arrow,
      onUpdate,
    })
    await flush()

    expect(floating.style.position).toBe('absolute')
    expect(floating.style.top).toBe('0px')
    expect(floating.style.left).toBe('0px')
    expect(floating.style.transform).toBe('translate(12px, 28px)')
    expect(content.getAttribute('data-placement')).toBe('bottom-start')
    expect(content.getAttribute('data-side')).toBe('bottom')
    expect(arrow.style.left).toBe('17px')
    expect(arrow.style.position).toBe('absolute')
    expect(arrow.style.top).toBe('-4px')
    expect(arrow.style.right).toBe('')
    expect(arrow.style.bottom).toBe('')
    expect(onUpdate).toHaveBeenCalledTimes(1)

    floatingUi.update?.()
    await flush()

    expect(content.getAttribute('data-placement')).toBe('right-end')
    expect(content.getAttribute('data-side')).toBe('right')
    expect(arrow.style.left).toBe('-5px')
    expect(arrow.style.top).toBe('19px')
    expect(arrow.style.right).toBe('')
    expect(arrow.style.bottom).toBe('')
    expect(onUpdate).toHaveBeenCalledTimes(2)

    cleanup()
    cleanup()

    expect(floatingUi.stop).toHaveBeenCalledTimes(1)
    expect(floating.style.getPropertyValue('position')).toBe('fixed')
    expect(floating.style.getPropertyPriority('position')).toBe('important')
    expect(floating.style.getPropertyValue('top')).toBe('11px')
    expect(floating.style.getPropertyValue('left')).toBe('13px')
    expect(floating.style.getPropertyPriority('left')).toBe('important')
    expect(floating.style.getPropertyValue('transform')).toBe('scale(0.5)')
    expect(content.getAttribute('data-placement')).toBe('legacy-start')
    expect(content.getAttribute('data-side')).toBe('legacy')
    expect(arrow.style.getPropertyValue('position')).toBe('relative')
    expect(arrow.style.getPropertyPriority('position')).toBe('important')
    expect(arrow.style.getPropertyValue('left')).toBe('3px')
    expect(arrow.style.getPropertyPriority('left')).toBe('important')
    expect(arrow.style.getPropertyValue('top')).toBe('5px')
    expect(arrow.style.getPropertyValue('right')).toBe('7px')
    expect(arrow.style.getPropertyValue('bottom')).toBe('9px')
    expect(arrow.style.getPropertyPriority('bottom')).toBe('important')
  })

  it('disposes before observers stop and suppresses a pending result and callback', async () => {
    const anchor = document.createElement('button')
    const floating = document.createElement('div')
    const content = document.createElement('div')
    const arrow = document.createElement('div')
    const result = deferred<PositionResult>()
    const onUpdate = vi.fn()
    floatingUi.computePosition.mockReturnValueOnce(result.promise)
    floatingUi.stop.mockImplementation(() => floatingUi.update?.())

    const cleanup = attachFloating({
      anchor,
      floating,
      stateTarget: content,
      arrow,
      onUpdate,
    })
    expect(floatingUi.computePosition).toHaveBeenCalledTimes(1)

    cleanup()
    cleanup()
    result.resolve(positioned('left-start', { middlewareData: { arrow: { x: 2, y: 4 } } }))
    await flush()

    expect(floatingUi.stop).toHaveBeenCalledTimes(1)
    expect(floatingUi.computePosition).toHaveBeenCalledTimes(1)
    expect(floating.getAttribute('style')).toBeNull()
    expect(content.hasAttribute('data-placement')).toBe(false)
    expect(content.hasAttribute('data-side')).toBe(false)
    expect(arrow.getAttribute('style')).toBeNull()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  // #265 review: the available size came through a callback into ONE shared
  // variable, so two overlapping autoUpdate passes could write one pass's
  // position with the other's size. Each computation now has its own sink.
  it('writes each computation with its OWN available size, even resolved out of order', async () => {
    const anchor = document.createElement('button')
    const floating = document.createElement('div')
    const first = deferred<PositionResult>()
    const second = deferred<PositionResult>()
    let call = 0
    floatingUi.computePosition.mockImplementation(
      (
        _a: Element,
        _f: HTMLElement,
        options: { middleware: { name: string; options?: unknown }[] },
      ) => {
        const size = options.middleware.find((mw) => mw.name === 'size')!
        const apply = (
          size.options as {
            apply: (s: { availableWidth: number; availableHeight: number }) => void
          }
        ).apply
        call++
        // The size callback runs DURING each computation, in call order.
        apply({ availableWidth: 100 * call, availableHeight: 10 * call })
        return call === 1 ? first.promise : second.promise
      },
    )
    const cleanup = attachFloating({ anchor, floating })
    floatingUi.update?.()
    // The SECOND computation resolves first, then the first one lands last.
    second.resolve(positioned('bottom', { x: 2, y: 2 }))
    await flush()
    expect(floating.style.getPropertyValue('--llui-floating-available-height')).toBe('20px')
    first.resolve(positioned('bottom', { x: 1, y: 1 }))
    await flush()
    expect(floating.style.transform).toBe('translate(1px, 1px)')
    expect(floating.style.getPropertyValue('--llui-floating-available-height')).toBe('10px')
    expect(floating.style.getPropertyValue('--llui-floating-available-width')).toBe('100px')
    cleanup()
  })
})

describe('attachFloating re-measures after an ancestor animates (#268)', () => {
  // The re-measure is deferred to the next animation frame, so a test drives
  // frames by hand: `frame()` runs every callback queued so far.
  let queued: FrameRequestCallback[] = []
  const frame = (): void => {
    const run = queued
    queued = []
    for (const callback of run) callback(0)
  }
  beforeEach(() => {
    queued = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      queued.push(callback)
      return queued.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      queued[id - 1] = () => {}
    })
  })

  it('recomputes when an animation or transition ends on an element containing the anchor', async () => {
    const menu = document.createElement('div')
    const anchor = document.createElement('button')
    const unrelated = document.createElement('div')
    menu.append(anchor)
    document.body.append(menu, unrelated)
    const floating = document.createElement('div')
    floatingUi.computePosition.mockResolvedValue(positioned('right-start'))

    const cleanup = attachFloating({ anchor, floating })
    await flush()
    const initial = floatingUi.computePosition.mock.calls.length

    // A parent's enter zoom finishing moved the anchor's rect: re-measure,
    // once per frame however many motions ended in it.
    menu.dispatchEvent(new Event('animationend', { bubbles: true }))
    anchor.dispatchEvent(new Event('transitionend', { bubbles: true }))
    await flush()
    expect(floatingUi.computePosition.mock.calls.length).toBe(initial)
    frame()
    await flush()
    expect(floatingUi.computePosition.mock.calls.length).toBe(initial + 1)

    // Something that cannot have moved the anchor does not.
    unrelated.dispatchEvent(new Event('animationend', { bubbles: true }))
    frame()
    await flush()
    expect(floatingUi.computePosition.mock.calls.length).toBe(initial + 1)

    // Disposal stops listening AND drops a re-measure already scheduled.
    menu.dispatchEvent(new Event('animationend', { bubbles: true }))
    cleanup()
    frame()
    menu.dispatchEvent(new Event('animationend', { bubbles: true }))
    frame()
    await flush()
    expect(floatingUi.computePosition.mock.calls.length).toBe(initial + 1)
    menu.remove()
    unrelated.remove()
  })

  it("measures after the ended motion's own handlers have changed the layout", async () => {
    // The listener is a CAPTURE listener on the document, so it runs BEFORE
    // the animating element's own `animationend` handlers (a presence machine
    // settling its state, a class swap). Measuring from inside it read the
    // layout those handlers were about to replace, and nothing re-measured
    // afterwards when no size changed: the gallery's visual gate caught an
    // arrow 1px off in 1 run of 8 in CI's Chromium.
    const menu = document.createElement('div')
    const anchor = document.createElement('button')
    menu.append(anchor)
    document.body.append(menu)
    const floating = document.createElement('div')
    const seen: string[] = []
    floatingUi.computePosition.mockImplementation(() => {
      seen.push(menu.dataset['state'] ?? 'unset')
      return Promise.resolve(positioned('bottom'))
    })
    menu.addEventListener('animationend', () => {
      menu.dataset['state'] = 'settled'
    })

    const cleanup = attachFloating({ anchor, floating })
    await flush()
    seen.length = 0

    menu.dispatchEvent(new Event('animationend', { bubbles: true }))
    await flush()
    frame()
    await flush()
    expect(seen).toEqual(['settled'])
    cleanup()
    menu.remove()
  })
})
