/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shouldMountHud } from '../src/hud-core.js'
import { installAnnotateHud } from '../src/install.js'

describe('shouldMountHud (mount gate)', () => {
  it('mounts under the dev server', () => {
    expect(shouldMountHud({ dev: true })).toBe(true)
    expect(shouldMountHud({ dev: true, allowProduction: false })).toBe(true)
  })
  it('does not mount in production unless explicitly opted in', () => {
    expect(shouldMountHud({ dev: false })).toBe(false)
    expect(shouldMountHud({ dev: false, allowProduction: false })).toBe(false)
  })
  it('mounts in production when the host opts in', () => {
    expect(shouldMountHud({ dev: false, allowProduction: true })).toBe(true)
  })
})

describe('installAnnotateHud (lazy installer)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    document.getElementById('llui-devmode-annotate-root')?.remove()
    document.body.innerHTML = ''
  })

  it('does not mount until activated', () => {
    installAnnotateHud({ trigger: false })
    expect(document.getElementById('llui-devmode-annotate-root')).toBeNull()
  })

  it('activate() lazily mounts and is idempotent', async () => {
    const installer = installAnnotateHud({ trigger: false })
    const a = await installer.activate()
    expect(document.getElementById('llui-devmode-annotate-root')).not.toBeNull()
    const b = await installer.activate()
    expect(a).toBe(b)
  })

  it('the keyboard trigger lazily mounts + opens the HUD (in a shadow root)', async () => {
    installAnnotateHud()
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'A', metaKey: true, shiftKey: true }),
    )
    // activation is async (dynamic import) — wait a microtask turn
    await new Promise((r) => setTimeout(r, 0))
    const host = document.getElementById('llui-devmode-annotate-root')
    expect(host).not.toBeNull()
    // The installer defaults to shadow-DOM isolation; the chrome lives inside.
    expect(host!.shadowRoot).not.toBeNull()
    const modal = host!.shadowRoot!.querySelector('[data-llui-modal]') as HTMLElement
    expect(modal.style.display).toBe('block')
  })

  it('dispose() removes the trigger so later key presses do nothing', async () => {
    const installer = installAnnotateHud()
    installer.dispose()
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'A', metaKey: true, shiftKey: true }),
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(document.getElementById('llui-devmode-annotate-root')).toBeNull()
  })
})
