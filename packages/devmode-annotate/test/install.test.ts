/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shouldMountHud } from '../src/hud-core.js'
import { installAnnotateHud } from '../src/install.js'
import { destroyMountedHud } from './support/hud-teardown.js'

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
    destroyMountedHud()
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
    const installer = installAnnotateHud()
    const combo = new KeyboardEvent('keydown', {
      key: 'A',
      metaKey: true,
      shiftKey: true,
      cancelable: true,
    })
    document.dispatchEvent(combo)
    expect(combo.defaultPrevented).toBe(true) // the trigger took it
    // Activation is a dynamic import — I/O on a cold module cache, so no fixed
    // tick covers it (this test used to wait one `setTimeout(0)` and passed
    // only because the test above had already warmed the cache; run alone it
    // failed every time). `activate()` is memoized, so this awaits the SAME
    // promise the trigger chained `open()` onto, and that reaction was
    // registered first, so it has run by the time this await resumes.
    await installer.activate()
    const host = document.getElementById('llui-devmode-annotate-root')
    expect(host).not.toBeNull()
    // The installer defaults to shadow-DOM isolation; the chrome lives inside.
    expect(host!.shadowRoot).not.toBeNull()
    const modal = host!.shadowRoot!.querySelector('[data-llui-modal]') as HTMLElement
    expect(modal.style.display).toBe('block')
  })

  it('dispose() removes the trigger so later key presses do nothing', () => {
    const installer = installAnnotateHud()
    installer.dispose()
    const combo = new KeyboardEvent('keydown', {
      key: 'A',
      metaKey: true,
      shiftKey: true,
      cancelable: true,
    })
    document.dispatchEvent(combo)
    // The trigger claims the combo SYNCHRONOUSLY (preventDefault, then starts
    // the import), so this is the whole observable — a wait for the import
    // could only pass vacuously when the import had not finished yet.
    expect(combo.defaultPrevented).toBe(false)
    expect(document.getElementById('llui-devmode-annotate-root')).toBeNull()
  })
})
