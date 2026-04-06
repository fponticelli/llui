import { describe, it, expect } from 'vitest'
import { onRenderHtml, createOnRenderHtml } from '../src/on-render-html'
import type { RenderHtmlResult } from '../src/on-render-html'
import { onRenderClient, createOnRenderClient } from '../src/on-render-client'
import { component, div, text } from '@llui/dom'

type State = { greeting: string }

const TestPage = component<State, never, never>({
  name: 'TestPage',
  init: () => [{ greeting: 'hello' }, []],
  update: (s) => [s, []],
  view: () => [div({ class: 'page' }, [text((s: State) => s.greeting)])],
})

/** Extract the HTML string from the result (handles dangerouslySkipEscape format) */
function getHtml(result: RenderHtmlResult): string {
  const doc = result.documentHtml
  return typeof doc === 'string' ? doc : doc._escaped
}

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
    expect(result.pageContext.lluiState).toEqual({ greeting: 'hello' })
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
    expect(result.pageContext.lluiState).toEqual({ greeting: 'hello' })
  })

  it('passes pageContext to document function', async () => {
    const render = createOnRenderHtml({
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
    const render = createOnRenderClient({ onMount: () => { mounted = true } })
    await render({ Page: TestPage, isHydration: false })

    expect(mounted).toBe(true)

    document.body.removeChild(container)
  })

  it('throws when container not found', async () => {
    const render = createOnRenderClient({ container: '#nonexistent' })
    await expect(render({ Page: TestPage })).rejects.toThrow('container "#nonexistent" not found')
  })
})
