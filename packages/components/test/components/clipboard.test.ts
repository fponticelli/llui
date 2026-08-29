import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  init,
  update,
  connect,
  copyToClipboard,
  type ClipboardMsg,
  type ClipboardState,
} from '../../src/components/clipboard'
import { rootSignal, signalOf, read } from '../_signal'

describe('clipboard reducer', () => {
  it('initializes empty', () => {
    expect(init()).toEqual({ value: '', copied: false })
  })

  it('setValue updates value and clears copied flag', () => {
    const s0 = { ...init({ value: 'old' }), copied: true }
    const [s] = update(s0, { type: 'setValue', value: 'new' })
    expect(s.value).toBe('new')
    expect(s.copied).toBe(false)
  })

  // #232: `copy` used to fall through to `copied`, so the DEFAULT wiring —
  // connect()'s own trigger dispatches `copy` — claimed success before the
  // write had resolved, and `indicator` (aria-live="polite") announced it.
  it('copy is a request and does NOT set copied', () => {
    const s0 = init({ value: 'hi' })
    const [s] = update(s0, { type: 'copy' })
    expect(s.copied).toBe(false)
    expect(s).toBe(s0)
  })

  it('copied sets the flag, reset clears it', () => {
    const [s] = update(init({ value: 'hi' }), { type: 'copied' })
    expect(s.copied).toBe(true)
    const [s2] = update(s, { type: 'reset' })
    expect(s2.copied).toBe(false)
  })
})

/**
 * The end-to-end shape of #232: the machine wired the way its own docs describe
 * — trigger dispatches `copy`, the consumer performs the write, and only a
 * RESOLVED write dispatches `copied`. A rejected write must leave the flag
 * false AND leave the live region publishing nothing, because those are two
 * different failures: a stale flag is a wrong pixel, an announced `data-copied`
 * is a screen reader telling the user their token is on the clipboard.
 */
describe('clipboard write outcome drives the copied flag (#232)', () => {
  const realClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')

  afterEach(() => {
    if (realClipboard) Object.defineProperty(globalThis.navigator, 'clipboard', realClipboard)
    else delete (globalThis.navigator as { clipboard?: unknown }).clipboard
  })

  function stubClipboard(writeText: (v: string) => Promise<void>): void {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  }

  /** Drive the documented wiring: click the trigger, run the write, feed the
   * outcome back through the reducer. Returns the settled state. */
  async function runCopy(writeText: (v: string) => Promise<void>): Promise<ClipboardState> {
    stubClipboard(writeText)
    let state = init({ value: 'secret-token' })
    const send = (msg: ClipboardMsg): void => {
      ;[state] = update(state, msg)
    }
    const parts = connect(signalOf(state), send)
    parts.trigger.onClick(new MouseEvent('click'))
    await copyToClipboard(state.value).then(
      () => send({ type: 'copied' }),
      () => {},
    )
    return state
  }

  it('a REJECTED write leaves copied false and the live region silent', async () => {
    const state = await runCopy(() => Promise.reject(new Error('NotAllowedError')))
    expect(state.copied).toBe(false)
    const parts = connect(rootSignal(), vi.fn())
    // `indicator` carries aria-live="polite"; `data-copied` is the hook every
    // skin keys the announced text off. Absent means nothing is announced.
    expect(read(parts.indicator['data-copied'], state)).toBeUndefined()
    expect(read(parts.root['data-copied'], state)).toBeUndefined()
  })

  it('a RESOLVED write sets copied and publishes it to the live region', async () => {
    const state = await runCopy(() => Promise.resolve())
    expect(state.copied).toBe(true)
    const parts = connect(rootSignal(), vi.fn())
    expect(read(parts.indicator['data-copied'], state)).toBe('')
  })

  it('copyToClipboard REJECTS when the write is refused, so the failure is observable', async () => {
    stubClipboard(() => Promise.reject(new Error('NotAllowedError')))
    await expect(copyToClipboard('x')).rejects.toThrow('NotAllowedError')
  })
})

describe('clipboard.connect', () => {
  const p = connect(rootSignal(), vi.fn())

  it('trigger onClick sends copy', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'copy' })
  })

  it('onCopy receives the value to write, not an empty string', () => {
    const onCopy = vi.fn()
    const pc = connect(signalOf(init({ value: 'pnpm add @llui/components' })), vi.fn(), { onCopy })
    pc.trigger.onClick(new MouseEvent('click'))
    expect(onCopy).toHaveBeenCalledWith('pnpm add @llui/components')
  })

  it('data-copied reflects state', () => {
    expect(read(p.root['data-copied'], { value: '', copied: true })).toBe('')
    expect(read(p.root['data-copied'], { value: '', copied: false })).toBeUndefined()
  })

  it('indicator has aria-live=polite', () => {
    expect(p.indicator['aria-live']).toBe('polite')
  })

  it('input value tracks state', () => {
    expect(read(p.input.value, { value: 'hello', copied: false })).toBe('hello')
  })
})
