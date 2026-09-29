/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'
import { settle, waitUntil } from '../../../scripts/lib/wait-until.mjs'
import { destroyMountedHud } from './support/hud-teardown.js'

const HUD_ID = 'llui-devmode-annotate-root'
const HUD_STATE_KEY = 'llui-devmode-annotate.hud-state'

function seedProse(text: string): void {
  localStorage.setItem(HUD_STATE_KEY, JSON.stringify({ draftProse: text }))
}

function mockFetch(): Array<[string, RequestInit]> {
  const calls: Array<[string, RequestInit]> = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push([url, init])
    return new Response(
      JSON.stringify({ id: '001', filename: '001-human-text-x.md', path: '/x', sessionId: 's' }),
      { status: 201 },
    )
  }) as unknown as typeof fetch
  return calls
}

function getModal(): HTMLElement {
  return document.querySelector(`#${HUD_ID} [data-llui-modal]`) as HTMLElement
}

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})
afterEach(() => {
  destroyMountedHud()
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
})

// Finding 8 — auto-capture-on-error must not clobber an in-progress draft.
describe('auto-capture on error preserves the draft', () => {
  it('appends the error block below a non-empty draft instead of replacing it', async (ctx) => {
    const calls = mockFetch()
    seedProse('KEEP-MY-DRAFT')
    mountAnnotateHud({ subscribeEvents: false })

    // Auto-capture fills the draft synchronously inside the error listener.
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'BOOM-ERROR', error: new Error('BOOM-ERROR') }),
    )

    const root = document.getElementById(HUD_ID)!
    const saveBtn = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save note',
    )!
    saveBtn.click()
    await waitUntil(ctx, 'the save POST', () => calls.length > 0)

    const prose = (JSON.parse(calls[0]![1].body as string) as { body: string }).body
    expect(prose).toContain('KEEP-MY-DRAFT') // the user's draft survived
    expect(prose).toContain('Auto-captured') // the error block was appended
    expect(prose).toContain('BOOM-ERROR')
  })
})

// Finding 13 — the global Escape handler must not fire a close + persist on
// every Escape; only when the modal is open and the event is unhandled.
describe('global Escape guard', () => {
  // This test failed 10 of 10 loaded runs once `retry: 2` came off — and alone,
  // unloaded: the write came from the PREVIOUS test's HUD, whose element the
  // afterEach removed without `destroy()`. See the orphan reclaim in
  // `mountAnnotateHud` and its regression test in `mount-reentrancy.test.ts`.
  it('does not close/persist when the modal is closed', async () => {
    mountAnnotateHud({ subscribeEvents: false })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    // Nothing observable is supposed to happen, so wait out the persist
    // debounce (200 ms) and assert that nothing did.
    await settle(250)
    const persistWrites = setItem.mock.calls.filter((c) => c[0] === HUD_STATE_KEY)
    expect(persistWrites).toHaveLength(0)
    expect(getModal().style.display).not.toBe('block')
  })

  it('does not close when the Escape was already handled (defaultPrevented)', async () => {
    const handle = mountAnnotateHud({ subscribeEvents: false })
    handle.open()
    expect(getModal().style.display).toBe('block')

    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    ev.preventDefault() // an overlay/menu already consumed it
    document.dispatchEvent(ev)
    expect(getModal().style.display).toBe('block') // still open
  })

  it('closes on a fresh Escape when the modal is open', async () => {
    const handle = mountAnnotateHud({ subscribeEvents: false })
    handle.open()
    expect(getModal().style.display).toBe('block')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(getModal().style.display).toBe('none')
  })
})
