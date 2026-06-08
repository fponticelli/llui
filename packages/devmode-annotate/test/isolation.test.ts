/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'

const HUD_ID = 'llui-devmode-annotate-root'

describe('shadow-DOM isolation (isolate: true)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.getElementById('llui-devmode-annotate-styles')?.remove()
  })
  afterEach(() => {
    document.getElementById(HUD_ID)?.remove()
    document.body.innerHTML = ''
    document.getElementById('llui-devmode-annotate-styles')?.remove()
  })

  it('mounts the chrome inside an open shadow root, not the light DOM', () => {
    mountAnnotateHud({ isolate: true })
    const host = document.getElementById(HUD_ID)!
    expect(host.shadowRoot).not.toBeNull()
    expect(host.shadowRoot!.mode).toBe('open')
    // The HUD chrome (the floating button) is in the shadow, not light DOM.
    expect(host.querySelector('[data-llui-fab]')).toBeNull()
    expect(host.shadowRoot!.querySelector('[data-llui-fab]')).not.toBeNull()
  })

  it('does NOT inject a global <style> into the document head', () => {
    mountAnnotateHud({ isolate: true })
    expect(document.getElementById('llui-devmode-annotate-styles')).toBeNull()
    // Styles applied to the shadow (adoptedStyleSheets or a shadow <style>).
    const host = document.getElementById(HUD_ID)!
    const adopted = host.shadowRoot!.adoptedStyleSheets ?? []
    const shadowStyleEl = host.shadowRoot!.querySelector('style')
    expect(adopted.length > 0 || shadowStyleEl !== null).toBe(true)
  })

  it('is idempotent: a second isolated mount returns the same handle', () => {
    const a = mountAnnotateHud({ isolate: true })
    const b = mountAnnotateHud({ isolate: true })
    expect(a).toBe(b)
  })

  it('destroy() removes the host and its shadow subtree', () => {
    const handle = mountAnnotateHud({ isolate: true })
    handle.destroy()
    expect(document.getElementById(HUD_ID)).toBeNull()
  })

  it('the default (no isolate) still mounts in the light DOM', () => {
    mountAnnotateHud()
    const root = document.getElementById(HUD_ID)!
    expect(root.shadowRoot).toBeNull()
    // chrome is directly queryable in light DOM
    expect(root.querySelector('[data-llui-fab]')).not.toBeNull()
  })
})
