// Direct (in-process) mode resolves `__listComponents` / `__selectComponent`
// against the same global registry the browser-side relay reads. Both sides now
// call @llui/dom's shared resolver; these tests pin the behaviour the relay is
// contractually required to keep exhibiting through it.
import { afterEach, describe, expect, it } from 'vitest'
import type { LluiDebugAPI } from '@llui/dom'
import { WebSocketRelayTransport } from '../src/transports/relay.js'

function api(name: string): LluiDebugAPI {
  return { getState: () => name } as LluiDebugAPI
}

const a = api('a')
const b = api('b')

function relay(): WebSocketRelayTransport {
  // No `start()` — direct mode never binds a socket.
  return new WebSocketRelayTransport({ port: 0 })
}

afterEach(() => {
  globalThis.__lluiComponents = undefined
  globalThis.__lluiDebug = undefined
})

describe('relay direct-mode component registry', () => {
  it('lists registry keys and marks the attached API as active', async () => {
    globalThis.__lluiComponents = { A: a, B: b }
    const t = relay()
    t.connectDirect(a)
    expect(await t.call('__listComponents', [])).toEqual({ components: ['A', 'B'], active: 'A' })
  })

  it('reports an empty list when no component has registered', async () => {
    const t = relay()
    t.connectDirect(a)
    expect(await t.call('__listComponents', [])).toEqual({ components: [], active: null })
  })

  it('selects a component, moving both the relay pointer and __lluiDebug', async () => {
    globalThis.__lluiComponents = { A: a, B: b }
    const t = relay()
    t.connectDirect(a)
    expect(await t.call('__selectComponent', ['B'])).toEqual({ active: 'B' })
    expect(globalThis.__lluiDebug).toBe(b)
    // subsequent method calls route to the newly selected component
    expect(await t.call('getState', [])).toBe('b')
    expect(await t.call('__listComponents', [])).toEqual({ components: ['A', 'B'], active: 'B' })
  })

  it('rejects an unknown component key', async () => {
    globalThis.__lluiComponents = { A: a }
    const t = relay()
    t.connectDirect(a)
    await expect(t.call('__selectComponent', ['nope'])).rejects.toThrow('unknown component: nope')
  })
})
