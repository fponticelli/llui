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

  // Finding 6 — the editor stylesheet must be adopted into the shadow (the
  // light-DOM `import '…/editor.css'` can't cross the boundary). We inject the
  // CSS via the `editorCss` seam so the assertion is deterministic regardless
  // of whether the `?raw` import resolves in the test env.
  it('bundles the markdown-editor stylesheet into the shadow root', () => {
    mountAnnotateHud({
      isolate: true,
      subscribeEvents: false,
      editorCss: '.md-underline-probe { text-decoration: underline }',
    })
    const shadow = document.getElementById(HUD_ID)!.shadowRoot!
    const adopted = shadow.adoptedStyleSheets ?? []
    const styleText =
      Array.from(shadow.querySelectorAll('style'))
        .map((s) => s.textContent ?? '')
        .join('\n') +
      adopted.flatMap((sheet) => Array.from(sheet.cssRules).map((r) => r.cssText)).join('\n')
    expect(styleText).toContain('md-underline-probe')
  })

  it('portals a filter dropdown INTO the shadow root, not the light DOM', () => {
    mountAnnotateHud({ isolate: true, subscribeEvents: false })
    const shadow = document.getElementById(HUD_ID)!.shadowRoot!
    const portal = shadow.querySelector('[data-llui-overlay-portal]')
    expect(portal).not.toBeNull()

    const trigger = shadow.getElementById('llui-browse-kind:trigger')
    expect(trigger).not.toBeNull()
    // Open the dropdown (the signal runtime commits synchronously).
    trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    // The option content is mounted inside the shadow's overlay portal — not
    // orphaned into document.body (which would render unstyled + uncontained).
    const optionInShadow = Array.from(portal!.querySelectorAll('button')).some((b) =>
      (b.textContent ?? '').includes('text'),
    )
    expect(optionInShadow).toBe(true)
    // Nothing leaked into the light DOM.
    const leaked = Array.from(document.body.querySelectorAll('button')).some((b) =>
      (b.textContent ?? '').includes('📝 text'),
    )
    expect(leaked).toBe(false)
  })
})
