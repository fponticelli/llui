/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hudCaptureFilter } from '../src/screenshot.js'

// Finding 3 — the capture must exclude the HUD's own chrome (and the transient
// overlay / picker hosts) so a screenshot shows the host app, and the
// in-progress rect isn't double-drawn (once by the capture, once by the baker).

describe('hudCaptureFilter', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('excludes the HUD root, toast container, and overlay/picker hosts', () => {
    document.body.innerHTML = `
      <div id="llui-devmode-annotate-root"></div>
      <div id="llui-devmode-annotate-toasts"></div>
      <div data-llui-overlay-host="rect"></div>
      <div data-llui-element-picker-host></div>
      <div data-llui-element-picker="outline"></div>
    `
    expect(hudCaptureFilter(document.getElementById('llui-devmode-annotate-root'))).toBe(false)
    expect(hudCaptureFilter(document.getElementById('llui-devmode-annotate-toasts'))).toBe(false)
    expect(hudCaptureFilter(document.querySelector('[data-llui-overlay-host]'))).toBe(false)
    expect(hudCaptureFilter(document.querySelector('[data-llui-element-picker-host]'))).toBe(false)
    expect(hudCaptureFilter(document.querySelector('[data-llui-element-picker]'))).toBe(false)
  })

  it('keeps ordinary host-app elements and non-Element nodes', () => {
    document.body.innerHTML = '<main id="app"><p>hi</p></main>'
    expect(hudCaptureFilter(document.getElementById('app'))).toBe(true)
    expect(hudCaptureFilter(document.querySelector('p'))).toBe(true)
    expect(hudCaptureFilter(document.createTextNode('text'))).toBe(true)
  })
})
