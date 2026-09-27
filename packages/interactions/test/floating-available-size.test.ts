import { describe, expect, it } from 'vitest'
import { attachFloating } from '../src/floating'

/**
 * #265 G2: a floating surface must be able to cap itself at the space left
 * beside its anchor, not at the viewport. The engine publishes that space as
 * two custom properties on the floating element (the LLui counterpart of
 * Radix's `--radix-*-content-available-height`), owned and restored like
 * every other inline style it writes. Real floating-ui over jsdom.
 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('attachFloating available size', () => {
  it('publishes the available width and height as px custom properties', async () => {
    const anchor = document.createElement('button')
    const floating = document.createElement('div')
    document.body.append(anchor, floating)
    const cleanup = attachFloating({ anchor, floating })
    await settle()

    const height = floating.style.getPropertyValue('--llui-floating-available-height')
    const width = floating.style.getPropertyValue('--llui-floating-available-width')
    expect(height).toMatch(/^\d+px$/)
    expect(width).toMatch(/^\d+px$/)
    // The VALUES need real layout (jsdom has none); they are proven in
    // Chromium by menus-overlays-product-effects.browser.test.ts ("viewport:").
    cleanup()
    anchor.remove()
    floating.remove()
  })

  it('restores prior values of both properties on cleanup, and drops them when absent', async () => {
    const anchor = document.createElement('button')
    const floating = document.createElement('div')
    floating.style.setProperty('--llui-floating-available-height', '10px', 'important')
    document.body.append(anchor, floating)
    const cleanup = attachFloating({ anchor, floating })
    await settle()
    expect(floating.style.getPropertyValue('--llui-floating-available-height')).not.toBe('10px')

    cleanup()
    expect(floating.style.getPropertyValue('--llui-floating-available-height')).toBe('10px')
    expect(floating.style.getPropertyPriority('--llui-floating-available-height')).toBe('important')
    expect(floating.style.getPropertyValue('--llui-floating-available-width')).toBe('')
    anchor.remove()
    floating.remove()
  })

  it('writes nothing after cleanup', async () => {
    const anchor = document.createElement('button')
    const floating = document.createElement('div')
    document.body.append(anchor, floating)
    const cleanup = attachFloating({ anchor, floating })
    cleanup()
    await settle()
    expect(floating.hasAttribute('style')).toBe(false)
    anchor.remove()
    floating.remove()
  })
})
