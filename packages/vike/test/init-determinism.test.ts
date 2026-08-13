// Issue #113 — `init()` must be DETERMINISTIC under manifest-only hydration.
//
// The manifest ships no per-layer state: a layer without a data slice is
// re-seeded on the client by calling its own `init()` again. That is only sound
// if `init()` returns the same value on both sides. Nothing said so, and nothing
// checked it — an `init()` reading `Date.now()`, `Math.random()`,
// `crypto.randomUUID()` or a module-level counter rendered one state on the
// server and hydrated a different one, silently.
//
// Two dev-only checks now cover the class:
//   • the server calls `init()` a second time per init-seeded layer and warns
//     when the two disagree (counters, `Math.random()` — anything that diverges
//     within one tick);
//   • the server records a FINGERPRINT of each init-seeded layer's state in the
//     manifest, and the client compares its own re-seeded state against it —
//     which is what catches the time-dependent cases a same-tick double call
//     cannot see.
// Both are gated on the dev build and cost nothing in production.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { browserEnv } from '@llui/dom/ssr'
import { component, div, text } from '@llui/dom'
import { createOnRenderHtml } from '../src/on-render-html.js'
import type { RenderHtmlResult } from '../src/on-render-html.js'
import { createOnRenderClient, _resetChainForTest } from '../src/on-render-client.js'
import { pageSlot } from '../src/page-slot.js'
import { buildManifest, stateFingerprint } from '../src/chain.js'

const env = browserEnv()
const domEnv = () => env

function getHtml(result: RenderHtmlResult): string {
  const doc = result.documentHtml
  return typeof doc === 'string' ? doc : doc._escaped
}

function primeHydration(result: RenderHtmlResult): HTMLElement {
  const html = getHtml(result)
  const match = html.match(/<div id="app">([\s\S]*?)<\/div>\s*<script>/)
  document.body.innerHTML = ''
  const container = document.createElement('div')
  container.id = 'app'
  container.innerHTML = match?.[1] ?? ''
  document.body.appendChild(container)
  ;(window as { __LLUI_STATE__?: unknown }).__LLUI_STATE__ = result.pageContext.lluiState
  return container
}

beforeEach(() => {
  _resetChainForTest()
  document.body.innerHTML = ''
  delete (window as { __LLUI_STATE__?: unknown }).__LLUI_STATE__
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const StablePage = component<{ greeting: string }, never, never>({
  name: 'StablePage',
  init: () => ({ greeting: 'hello' }),
  update: (s) => s,
  view: ({ state }) => [div({ class: 'p' }, [text(state.map((s) => s.greeting))])],
})

describe('a counter-based init() is caught on the server', () => {
  it('warns naming the layer when two calls in one render disagree', async () => {
    let seq = 0
    const CounterPage = component<{ id: number }, never, never>({
      name: 'CounterPage',
      init: () => ({ id: ++seq }),
      update: (s) => s,
      view: ({ state }) => [div({ class: 'p' }, [text(state.map((s) => String(s.id)))])],
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const render = createOnRenderHtml({ domEnv })
    await render({ Page: CounterPage })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/CounterPage/)
    expect(String(warn.mock.calls[0]![0])).toMatch(/init\(\)/)
  })

  it('stays silent for a deterministic init()', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const render = createOnRenderHtml({ domEnv })
    await render({ Page: StablePage })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('a Date.now()-based init() is caught at hydration', () => {
  // The server's double call happens inside one tick, so a clock-reading init()
  // looks perfectly stable there. The divergence only exists ACROSS the
  // server→client boundary, which is exactly what the manifest fingerprint spans.
  const ClockPage = component<{ renderedAt: number }, never, never>({
    name: 'ClockPage',
    init: () => ({ renderedAt: Date.now() }),
    update: (s) => s,
    view: ({ state }) => [div({ class: 'p' }, [text(state.map((s) => String(s.renderedAt)))])],
  })

  it('warns naming the layer when the client re-seeds to different state', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const serverRender = createOnRenderHtml({ domEnv })
    const result = await serverRender({ Page: ClockPage })
    // Same tick on the server — the double-init check cannot see this one.
    expect(warn).not.toHaveBeenCalled()
    primeHydration(result)

    // The browser hydrates some time after the server rendered.
    vi.setSystemTime(new Date('2026-01-01T00:00:05Z'))
    const render = createOnRenderClient({})
    await render({ Page: ClockPage, isHydration: true })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/ClockPage/)
    expect(String(warn.mock.calls[0]![0])).toMatch(/init\(\)/)
  })

  it('stays silent when the client re-seeds to the same state', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const serverRender = createOnRenderHtml({ domEnv })
    const result = await serverRender({ Page: StablePage })
    primeHydration(result)

    const render = createOnRenderClient({})
    await render({ Page: StablePage, isHydration: true })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('each layer is checked against ITS OWN recorded state', () => {
  // A fingerprint is per LAYER: entry `i` must hash layer `i`'s state. With one
  // non-deterministic layer in a two-layer chain, exactly one warning must fire
  // and it must name that layer. Hash the wrong layer's state and the chain
  // reports a divergence on a layer that never had one — spurious noise on every
  // multi-layer app, and a real divergence buried under it.
  const StableShell = component<{ theme: string }, never, never>({
    name: 'StableShell',
    init: () => ({ theme: 'light' }),
    update: (s) => s,
    view: ({ state }) => [div({ class: 's' }, [text(state.map((s) => s.theme)), pageSlot()])],
  })

  const ClockShell = component<{ openedAt: number }, never, never>({
    name: 'ClockShell',
    init: () => ({ openedAt: Date.now() }),
    update: (s) => s,
    view: ({ state }) => [
      div({ class: 's' }, [text(state.map((s) => String(s.openedAt))), pageSlot()]),
    ],
  })

  const ClockPage = component<{ renderedAt: number }, never, never>({
    name: 'ClockPage',
    init: () => ({ renderedAt: Date.now() }),
    update: (s) => s,
    view: ({ state }) => [div({ class: 'p' }, [text(state.map((s) => String(s.renderedAt)))])],
  })

  it('names the inner page when only the page reads the clock', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const serverRender = createOnRenderHtml({ domEnv, Layout: StableShell })
    const result = await serverRender({ Page: ClockPage })
    expect(warn).not.toHaveBeenCalled()
    primeHydration(result)

    vi.setSystemTime(new Date('2026-01-01T00:00:05Z'))
    const render = createOnRenderClient({ Layout: StableShell })
    await render({ Page: ClockPage, isHydration: true })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/ClockPage/)
    expect(String(warn.mock.calls[0]![0])).not.toMatch(/StableShell/)
  })

  it('names the outer layout when only the layout reads the clock', async () => {
    // The direction that catches an index bug: with every entry hashing layer
    // 0's state, the deterministic PAGE compares its own state against the
    // layout's fingerprint and warns about a layer that is perfectly fine.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const serverRender = createOnRenderHtml({ domEnv, Layout: ClockShell })
    const result = await serverRender({ Page: StablePage })
    expect(warn).not.toHaveBeenCalled()
    primeHydration(result)

    vi.setSystemTime(new Date('2026-01-01T00:00:05Z'))
    const render = createOnRenderClient({ Layout: ClockShell })
    await render({ Page: StablePage, isHydration: true })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/ClockShell/)
    expect(String(warn.mock.calls[0]![0])).not.toMatch(/StablePage/)
  })
})

describe('the check is scoped to layers that actually call init()', () => {
  it('records no fingerprint for a data-seeded layer', async () => {
    const initCalls = vi.fn()
    const DataPage = component<{ title: string }, never, never>({
      name: 'DataPage',
      init: () => {
        initCalls()
        return { title: 'default' }
      },
      update: (s) => s,
      view: ({ state }) => [div({ class: 'p' }, [text(state.map((s) => s.title))])],
    })

    const render = createOnRenderHtml({ domEnv })
    const result = await render({ Page: DataPage, data: { title: 'from-data' } })

    // A data-seeded layer never calls init() — not for the render, and not for
    // the determinism probe. There is nothing to be non-deterministic about.
    expect(initCalls).not.toHaveBeenCalled()
    expect(result.pageContext.lluiState.initFingerprints).toEqual([null])
  })
})

describe('the check costs nothing in production', () => {
  it('omits the fingerprints and never calls init() when dev is off', () => {
    const initCalls = vi.fn()
    const Page = {
      name: 'ProdPage',
      init: () => {
        initCalls()
        return { n: 1 }
      },
      update: (s: unknown) => s,
      view: () => [],
    }

    const manifest = buildManifest([Page], [undefined], [{ n: 1 }], false)
    expect(manifest.initFingerprints).toBeUndefined()
    expect(initCalls).not.toHaveBeenCalled()
  })

  it('a production server envelope (no fingerprints) hydrates without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const serverRender = createOnRenderHtml({ domEnv })
    const result = await serverRender({ Page: StablePage })
    primeHydration(result)
    // Strip the dev-only field the way a production server build would.
    const envelope = window.__LLUI_STATE__ as Record<string, unknown>
    delete envelope.initFingerprints

    const render = createOnRenderClient({})
    await expect(render({ Page: StablePage, isHydration: true })).resolves.not.toThrow()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('stateFingerprint', () => {
  it('agrees for equal states and differs for different ones', () => {
    expect(stateFingerprint({ a: 1, b: 'x' })).toBe(stateFingerprint({ a: 1, b: 'x' }))
    expect(stateFingerprint({ a: 1 })).not.toBe(stateFingerprint({ a: 2 }))
  })

  it('declines a state it cannot serialize rather than throwing', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(stateFingerprint(circular)).toBeNull()
  })
})
