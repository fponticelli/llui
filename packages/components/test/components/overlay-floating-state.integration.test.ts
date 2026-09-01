import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { button, component, div, mountApp, text } from '@llui/dom'
import { connect, init, overlay, update } from '../../src/components/select'
import type { SelectMsg, SelectState } from '../../src/components/select'

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  } as DOMRect
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

type Ctx = { select: SelectState }

let currentApp: ReturnType<typeof mountApp> | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: 400,
  })
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    value: 300,
  })
})

afterEach(() => {
  currentApp?.dispose()
  currentApp = null
  document.body.innerHTML = ''
})

function makeApp(withPriorMinWidth = true): { send: (message: SelectMsg) => void } {
  let sendRef!: (message: SelectMsg) => void
  const definition = component<Ctx, SelectMsg, never>({
    name: 'FloatingStateTargetIntegration',
    init: () => [{ select: init({ items: ['alpha', 'beta'] }) }, []],
    update: (state, message) => {
      const [select] = update(state.select, message)
      return [{ select }, []]
    },
    view: ({ state, send }) => {
      sendRef = send
      const parts = connect(state.at('select'), send, { id: 'floating-state' })
      if (withPriorMinWidth) parts.positioner.style += 'min-width:41px!important;'
      return [
        button({ ...parts.trigger }, [text('Choose')]),
        overlay({
          state: state.at('select'),
          send,
          parts,
          content: () => [
            div(
              {
                ...parts.content,
                'data-placement': 'legacy-start',
                'data-side': 'legacy',
              },
              [],
            ),
          ],
        }),
      ]
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  currentApp = mountApp(host, definition)
  return { send: (message) => sendRef(message) }
}

describe('overlay floating state target integration', () => {
  it('keeps geometry on the positioner, publishes flips on content, and restores both', async () => {
    const { send } = makeApp()
    const trigger = document.getElementById('floating-state:trigger') as HTMLElement
    Object.defineProperty(trigger, 'offsetWidth', { configurable: true, value: 144 })
    let triggerY = 80
    trigger.getBoundingClientRect = () => rect(100, triggerY, 40, 20)

    send({ type: 'open' })
    await flush()

    const content = document.getElementById('floating-state:content') as HTMLElement
    const positioner = content.closest('[data-part="positioner"]') as HTMLElement
    expect(positioner.style.minWidth).toBe('144px')
    expect(positioner.style.transform).not.toBe('')
    expect(positioner.hasAttribute('data-placement')).toBe(false)
    expect(positioner.hasAttribute('data-side')).toBe(false)
    expect(content.getAttribute('data-placement')).toBe('bottom-start')
    expect(content.getAttribute('data-side')).toBe('bottom')

    const initialTransform = positioner.style.transform
    triggerY = 286
    window.dispatchEvent(new Event('resize'))
    await flush()

    expect(positioner.style.transform).not.toBe(initialTransform)
    expect(content.getAttribute('data-placement')).toBe('top-start')
    expect(content.getAttribute('data-side')).toBe('top')

    send({ type: 'close' })
    await flush()

    expect(positioner.isConnected).toBe(false)
    expect(content.isConnected).toBe(false)
    expect(positioner.style.minWidth).toBe('41px')
    expect(positioner.style.getPropertyPriority('min-width')).toBe('important')
    expect(positioner.style.transform).toBe('')
    expect(positioner.hasAttribute('data-placement')).toBe(false)
    expect(positioner.hasAttribute('data-side')).toBe(false)
    expect(content.getAttribute('data-placement')).toBe('legacy-start')
    expect(content.getAttribute('data-side')).toBe('legacy')

    window.dispatchEvent(new Event('resize'))
    await flush()
    expect(positioner.style.minWidth).toBe('41px')
    expect(positioner.style.transform).toBe('')
    expect(content.getAttribute('data-placement')).toBe('legacy-start')
    expect(content.getAttribute('data-side')).toBe('legacy')
  })

  it('restores an absent min-width without disturbing positioner defaults', async () => {
    const { send } = makeApp(false)
    const trigger = document.getElementById('floating-state:trigger') as HTMLElement
    Object.defineProperty(trigger, 'offsetWidth', { configurable: true, value: 144 })
    trigger.getBoundingClientRect = () => rect(100, 80, 40, 20)

    send({ type: 'open' })
    await flush()

    const content = document.getElementById('floating-state:content') as HTMLElement
    const positioner = content.closest('[data-part="positioner"]') as HTMLElement
    expect(positioner.style.minWidth).toBe('144px')

    send({ type: 'close' })
    await flush()

    expect(positioner.style.getPropertyValue('min-width')).toBe('')
    expect(positioner.style.getPropertyPriority('min-width')).toBe('')
    expect(positioner.style.cssText).toBe('position: absolute; top: 0px; left: 0px;')
  })
})
