import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountApp } from '@llui/dom'
import { init as qrInit } from '../../src/components/qr-code'
import { lazyQrCodeInView, presenceClipboardConfirmation } from './specialized-tools-compositions'
import { qrFixtureMatrix, QR_FIXTURE_VALUE } from './specialized-tools-scenarios'

/**
 * The tested composition examples that make `in-view` and `presence` honestly
 * `styleless` (#266): each is useful composed with a styled product, and adds
 * no surface of its own.
 */

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  disconnected = false
  constructor(readonly callback: ObserverCallback) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(): void {}
  disconnect(): void {
    this.disconnected = true
  }
  fire(isIntersecting: boolean): void {
    this.callback([{ isIntersecting }])
  }
}

describe('styleless composition examples (#266)', () => {
  let dispose: (() => void) | undefined

  afterEach(() => {
    dispose?.()
    dispose = undefined
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    FakeIntersectionObserver.instances = []
  })

  it('in-view mounts the styled QR code only once it scrolls into view, then stops observing', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    const host = document.createElement('div')
    document.body.append(host)
    const handle = mountApp(
      host,
      lazyQrCodeInView(qrInit({ value: QR_FIXTURE_VALUE, matrix: qrFixtureMatrix() })),
    )
    dispose = () => handle.dispose()

    const watcher = host.querySelector('[data-scope="in-view"][data-part="root"]')
    expect(watcher?.getAttribute('data-state')).toBe('hidden')
    expect(host.querySelector('[data-scope="qr-code"]')).toBeNull()

    const observer = FakeIntersectionObserver.instances[0]
    expect(observer).toBeDefined()
    observer!.fire(true)
    handle.flush?.()

    expect(watcher?.getAttribute('data-state')).toBe('visible')
    const svg = host.querySelector('[data-scope="qr-code"][data-part="svg"]')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-label')).toBe(`Share link: ${QR_FIXTURE_VALUE}`)
    expect(host.querySelector('[data-part="foreground"]')?.getAttribute('d')).not.toBe('')
    // `once`: the observer is released after the first entry.
    expect(observer!.disconnected).toBe(true)
    // In-view contributes behaviour only: no class, no style of its own
    // beyond the placeholder height the composition itself chose.
    expect(watcher?.getAttribute('class')).toBeNull()
  })

  it('presence retains the styled confirmation through its exit, then unmounts it', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const handle = mountApp(host, presenceClipboardConfirmation('pnpm add @llui/components'))
    dispose = () => handle.dispose()
    const send = handle.send
    const confirmation = () => host.querySelector('[data-scope="presence"][data-part="root"]')

    expect(confirmation()).toBeNull()

    send({ type: 'clipboard', msg: { type: 'copied' } })
    expect(confirmation()?.getAttribute('data-state')).toBe('opening')
    expect(
      host
        .querySelector('[data-scope="clipboard"][data-part="trigger"]')
        ?.hasAttribute('data-copied'),
    ).toBe(true)

    confirmation()!.dispatchEvent(new Event('animationend'))
    expect(confirmation()?.getAttribute('data-state')).toBe('open')

    send({ type: 'clipboard', msg: { type: 'reset' } })
    // Retained while its exit plays — not cut off mid-fade.
    expect(confirmation()?.getAttribute('data-state')).toBe('closing')

    // A bubbling descendant's animation must not end the exit early.
    const child = document.createElement('span')
    confirmation()!.append(child)
    child.dispatchEvent(new Event('animationend', { bubbles: true }))
    expect(confirmation()?.getAttribute('data-state')).toBe('closing')

    confirmation()!.dispatchEvent(new Event('animationend'))
    expect(confirmation()).toBeNull()
  })
})
