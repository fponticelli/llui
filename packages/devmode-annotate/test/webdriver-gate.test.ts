/// <reference lib="dom" />
// The dev HUD opens a persistent EventSource to `/_llui/events?role=hud`
// so LLM-initiated captures land. That stream never closes, which means
// an automated browser's `page.waitForLoadState('networkidle')` can never
// settle — it hangs every Playwright/WebDriver e2e suite in a consumer app
// that mounts the HUD in dev. There is no human to drive the HUD under
// automation and no LLM capture session is expected, so the subscription
// must default OFF when `navigator.webdriver` is true. An explicit
// `subscribeEvents` value always wins (a consumer testing the SSE path
// itself can still force it on).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'

class StubEventSource {
  static instances: StubEventSource[] = []
  listeners: Array<(e: { data: string }) => void> = []
  closed = false
  constructor(public url: string) {
    StubEventSource.instances.push(this)
  }
  addEventListener(_type: 'message', listener: (e: { data: string }) => void): void {
    this.listeners.push(listener)
  }
  close(): void {
    this.closed = true
  }
}

function setWebdriver(value: boolean | undefined): void {
  Object.defineProperty(navigator, 'webdriver', {
    value,
    configurable: true,
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  StubEventSource.instances = []
  ;(globalThis as { EventSource?: unknown }).EventSource = StubEventSource
})

afterEach(() => {
  document.body.innerHTML = ''
  delete (globalThis as { EventSource?: unknown }).EventSource
  setWebdriver(false)
})

describe('mountAnnotateHud — automated-browser SSE gate', () => {
  it('opens the SSE in a normal (non-automated) browser by default', () => {
    setWebdriver(false)
    mountAnnotateHud({ origin: 'http://localhost' })
    expect(StubEventSource.instances).toHaveLength(1)
  })

  it('does NOT open the SSE when navigator.webdriver is true', () => {
    setWebdriver(true)
    mountAnnotateHud({ origin: 'http://localhost' })
    expect(StubEventSource.instances).toHaveLength(0)
  })

  it('respects an explicit subscribeEvents:true even under automation', () => {
    setWebdriver(true)
    mountAnnotateHud({ origin: 'http://localhost', subscribeEvents: true })
    expect(StubEventSource.instances).toHaveLength(1)
  })

  it('respects an explicit subscribeEvents:false in a normal browser', () => {
    setWebdriver(false)
    mountAnnotateHud({ origin: 'http://localhost', subscribeEvents: false })
    expect(StubEventSource.instances).toHaveLength(0)
  })
})
