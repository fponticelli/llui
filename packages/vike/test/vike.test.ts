import { describe, it, expect, beforeEach } from 'vitest'
import { onRenderHtml, createOnRenderHtml } from '../src/on-render-html'
import type { RenderHtmlResult } from '../src/on-render-html'
import {
  onRenderClient,
  createOnRenderClient,
  fromTransition,
  _resetChainForTest,
} from '../src/on-render-client'
import type { TransitionOptions } from '@llui/dom'
import { component, div, text, browserEnv } from '@llui/dom'

const env = browserEnv()
const domEnv = () => env

type State = { greeting: string }

const TestPage = component<State, never, never>({
  name: 'TestPage',
  init: () => [{ greeting: 'hello' }, []],
  update: (s) => [s, []],
  view: () => [div({ class: 'page' }, [text((s: State) => s.greeting)])],
})

// Distinct second page for nav-lifecycle tests. The chain-diff logic
// treats same-def navs as no-ops (correct: nothing actually changed),
// so exercising real leave/mount/enter requires a *different* Page def
// on the second call.
const OtherPage = component<State, never, never>({
  name: 'OtherPage',
  init: () => [{ greeting: 'hello again' }, []],
  update: (s) => [s, []],
  view: () => [div({ class: 'page' }, [text((s: State) => s.greeting)])],
})

/** Extract the HTML string from the result (handles dangerouslySkipEscape format) */
function getHtml(result: RenderHtmlResult): string {
  const doc = result.documentHtml
  return typeof doc === 'string' ? doc : doc._escaped
}

// Reset module-level chain + document state between every test so tests
// don't leak state. The client render path keeps a live handle chain
// across calls (that's the whole point of persistent layouts); between
// tests we need a fresh slate.
beforeEach(() => {
  _resetChainForTest()
  document.body.innerHTML = ''
  delete (window as Record<string, unknown>).__LLUI_STATE__
})

describe('onRenderHtml', () => {
  it('renders HTML with component content', async () => {
    const result = await onRenderHtml({ Page: TestPage })
    const html = getHtml(result)
    expect(html).toContain('<div id="app">')
    expect(html).toContain('hello')
    expect(html).toContain('__LLUI_STATE__')
  })

  it('serializes initial state into the page', async () => {
    const result = await onRenderHtml({ Page: TestPage })
    const html = getHtml(result)
    expect(html).toContain('"greeting":"hello"')
    // Hydration envelope is chain-aware: layouts array (empty when no
    // Layout configured) plus a named page entry that carries state.
    expect(result.pageContext.lluiState).toEqual({
      layouts: [],
      page: { name: 'TestPage', state: { greeting: 'hello' } },
    })
  })

  it('passes data to init', async () => {
    const WithData = component<{ name: string }, never, never>({
      name: 'WithData',
      init: (data) => [{ name: (data as { name: string })?.name ?? 'default' }, []],
      update: (s) => [s, []],
      view: () => [text((s: { name: string }) => s.name)],
    })

    const result = await onRenderHtml({ Page: WithData, data: { name: 'Franco' } })
    expect(getHtml(result)).toContain('Franco')
  })

  it('includes head content when provided', async () => {
    const result = await onRenderHtml({
      Page: TestPage,
      head: '<title>Test Page</title><meta name="description" content="A test" />',
    })
    const html = getHtml(result)
    expect(html).toContain('<title>Test Page</title>')
    expect(html).toContain('meta name="description"')
  })

  it('returns dangerouslySkipEscape format', async () => {
    const result = await onRenderHtml({ Page: TestPage })
    expect(result.documentHtml).toHaveProperty('_escaped')
  })
})

describe('createOnRenderHtml', () => {
  it('uses custom document template', async () => {
    const render = createOnRenderHtml({
      domEnv,
      document: ({ html, state, head }) =>
        `<!DOCTYPE html><html><head>${head}</head>` +
        `<body><main id="root">${html}</main>` +
        `<script>window.__LLUI_STATE__ = ${state}</script></body></html>`,
    })

    const result = await render({ Page: TestPage })
    const html = getHtml(result)
    expect(html).toContain('<main id="root">')
    expect(html).toContain('hello')
    expect(html).toContain('__LLUI_STATE__')
    expect(result.pageContext.lluiState).toEqual({
      layouts: [],
      page: { name: 'TestPage', state: { greeting: 'hello' } },
    })
  })

  it('passes pageContext to document function', async () => {
    const render = createOnRenderHtml({
      domEnv,
      document: ({ html, state, pageContext }) =>
        `<!DOCTYPE html><html><body>` +
        `<div data-page="${(pageContext as Record<string, unknown>).urlPathname ?? ''}">${html}</div>` +
        `<script>window.__LLUI_STATE__ = ${state}</script></body></html>`,
    })

    const result = await render({
      Page: TestPage,
      urlPathname: '/docs/getting-started',
    } as never)
    expect(getHtml(result)).toContain('data-page="/docs/getting-started"')
  })

  it('injects CSS link via custom template', async () => {
    const render = createOnRenderHtml({
      domEnv,
      document: ({ html, state }) =>
        `<!DOCTYPE html><html><head>` +
        `<link rel="stylesheet" href="/styles.css" />` +
        `</head><body><div id="app">${html}</div>` +
        `<script>window.__LLUI_STATE__ = ${state}</script></body></html>`,
    })

    const result = await render({ Page: TestPage })
    expect(getHtml(result)).toContain('href="/styles.css"')
  })
})

describe('onRenderClient', () => {
  it('mounts fresh when not hydrating', async () => {
    const container = document.createElement('div')
    container.id = 'app'
    document.body.appendChild(container)

    await onRenderClient({ Page: TestPage, isHydration: false })

    expect(container.textContent).toContain('hello')

    document.body.removeChild(container)
  })

  it('hydrates when isHydration is true', async () => {
    const result = await onRenderHtml({ Page: TestPage })
    const html = getHtml(result)
    const match = html.match(/<div id="app">([\s\S]*?)<\/div>/)
    const serverHtml = match?.[1] ?? ''

    const container = document.createElement('div')
    container.id = 'app'
    container.innerHTML = serverHtml
    document.body.appendChild(container)
    ;(window as Record<string, unknown>).__LLUI_STATE__ = { greeting: 'hello' }

    await onRenderClient({ Page: TestPage, isHydration: true })

    expect(container.textContent).toContain('hello')

    document.body.removeChild(container)
    delete (window as Record<string, unknown>).__LLUI_STATE__
  })
})

describe('createOnRenderClient', () => {
  it('uses custom container selector', async () => {
    const container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)

    const render = createOnRenderClient({ container: '#root' })
    await render({ Page: TestPage, isHydration: false })

    expect(container.textContent).toContain('hello')

    document.body.removeChild(container)
  })

  it('calls onMount after mounting', async () => {
    const container = document.createElement('div')
    container.id = 'app'
    document.body.appendChild(container)

    let mounted = false
    const render = createOnRenderClient({
      onMount: () => {
        mounted = true
      },
    })
    await render({ Page: TestPage, isHydration: false })

    expect(mounted).toBe(true)

    document.body.removeChild(container)
  })

  it('throws when container not found', async () => {
    const render = createOnRenderClient({ container: '#nonexistent' })
    await expect(render({ Page: TestPage })).rejects.toThrow('container "#nonexistent" not found')
  })
})

describe('createOnRenderClient — onLeave / onEnter lifecycle', () => {
  beforeEach(() => {
    // Module-level currentHandle is shared across tests; reset it so each
    // test starts with a clean "no previous page" state.
    _resetChainForTest()
    // Remove any leftover container nodes from previous tests
    document.body.innerHTML = ''
  })

  function setup(): HTMLElement {
    const container = document.createElement('div')
    container.id = 'app'
    document.body.appendChild(container)
    return container
  }

  function teardown(container: HTMLElement): void {
    if (container.parentNode) container.parentNode.removeChild(container)
    _resetChainForTest()
  }

  it('does not call onLeave or onEnter on the initial (hydration) render', async () => {
    const container = setup()
    const result = await onRenderHtml({ Page: TestPage })
    const html = getHtml(result)
    const match = html.match(/<div id="app">([\s\S]*?)<\/div>/)
    container.innerHTML = match?.[1] ?? ''
    ;(window as Record<string, unknown>).__LLUI_STATE__ = { greeting: 'hello' }

    let leaveCount = 0
    let enterCount = 0
    const render = createOnRenderClient({
      onLeave: () => {
        leaveCount++
      },
      onEnter: () => {
        enterCount++
      },
    })
    await render({ Page: TestPage, isHydration: true })

    expect(leaveCount).toBe(0)
    expect(enterCount).toBe(0)
    delete (window as Record<string, unknown>).__LLUI_STATE__
    teardown(container)
  })

  it('does not call onLeave on the first fresh mount (no outgoing page)', async () => {
    const container = setup()
    let leaveCount = 0
    let enterCount = 0
    const render = createOnRenderClient({
      onLeave: () => {
        leaveCount++
      },
      onEnter: () => {
        enterCount++
      },
    })
    await render({ Page: TestPage, isHydration: false })

    // First mount: no previous handle → onLeave skipped, onEnter fires
    expect(leaveCount).toBe(0)
    expect(enterCount).toBe(1)
    teardown(container)
  })

  it('calls onLeave before dispose and onEnter after mount on subsequent navs', async () => {
    const container = setup()
    const order: string[] = []
    const render = createOnRenderClient({
      onLeave: (el) => {
        order.push('leave')
        // The outgoing page's DOM must still be present when onLeave runs
        expect(el.textContent).toContain('hello')
      },
      onEnter: (el) => {
        order.push('enter')
        // The new page's DOM must be present when onEnter runs
        expect(el.textContent).toContain('hello')
      },
      onMount: () => {
        order.push('mount')
      },
    })

    await render({ Page: TestPage, isHydration: false })
    // First nav: enter + mount (no outgoing page to leave)
    expect(order).toEqual(['enter', 'mount'])

    order.length = 0
    await render({ Page: OtherPage, isHydration: false })
    // Second nav: leave → enter → mount. OtherPage !== TestPage so the
    // diff picks up a mismatch at depth 0 and does a full re-render.
    expect(order).toEqual(['leave', 'enter', 'mount'])

    teardown(container)
  })

  it('awaits onLeave before tearing down the outgoing page', async () => {
    const container = setup()
    let leaveResolved = false
    let mountFiredAfterLeave = false
    let resolveLeave: () => void = () => {}

    const render = createOnRenderClient({
      onLeave: () =>
        new Promise<void>((resolve) => {
          resolveLeave = () => {
            leaveResolved = true
            resolve()
          }
        }),
      onMount: () => {
        // onMount fires AFTER dispose+mount. If the render progressed past
        // onLeave without the caller resolving it, leaveResolved would be
        // false here and we'd detect the ordering bug.
        if (leaveResolved) mountFiredAfterLeave = true
      },
    })

    // First mount — no previous handle → onLeave not called
    await render({ Page: TestPage, isHydration: false })

    // Second nav to a different page. OtherPage !== TestPage so the
    // chain diff picks up a mismatch and runs the real leave flow.
    // onLeave returns a pending promise; render() is now awaiting
    // inside, so the caller's Promise is still pending.
    const second = render({ Page: OtherPage, isHydration: false })
    // Let a few microtasks run; render should still be stuck on the leave
    await Promise.resolve()
    await Promise.resolve()
    expect(leaveResolved, 'leave promise still pending after microtasks').toBe(false)
    expect(container.textContent, 'outgoing page still present while leave pending').toContain(
      'hello',
    )

    // Resolve the leave promise; dispose+mount now proceeds
    resolveLeave()
    await second
    expect(mountFiredAfterLeave, 'onMount must fire strictly after onLeave resolves').toBe(true)
    expect(container.textContent).toContain('hello')

    teardown(container)
  })
})

describe('fromTransition', () => {
  it('wraps a TransitionOptions with enter+leave hooks into onLeave/onEnter', () => {
    const seen: string[] = []
    const t: TransitionOptions = {
      enter: (nodes) => {
        seen.push(`enter:${nodes.length}`)
      },
      leave: (nodes) => {
        seen.push(`leave:${nodes.length}`)
        return Promise.resolve()
      },
    }
    const adapted = fromTransition(t)
    expect(typeof adapted.onEnter).toBe('function')
    expect(typeof adapted.onLeave).toBe('function')

    const el = document.createElement('div')
    adapted.onEnter!(el)
    const leavePromise = adapted.onLeave!(el)
    expect(seen).toEqual(['enter:1', 'leave:1'])
    expect(leavePromise).toBeInstanceOf(Promise)
  })

  it('returns undefined for missing hooks', () => {
    const enterOnly: TransitionOptions = {
      enter: () => {},
    }
    expect(fromTransition(enterOnly).onEnter).toBeDefined()
    expect(fromTransition(enterOnly).onLeave).toBeUndefined()

    const leaveOnly: TransitionOptions = {
      leave: () => {},
    }
    expect(fromTransition(leaveOnly).onEnter).toBeUndefined()
    expect(fromTransition(leaveOnly).onLeave).toBeDefined()
  })

  it('handles synchronous leave hooks without wrapping them in a promise', () => {
    const t: TransitionOptions = {
      leave: () => {
        /* sync */
      },
    }
    const adapted = fromTransition(t)
    const el = document.createElement('div')
    const result = adapted.onLeave!(el)
    expect(result).toBeUndefined()
  })
})
