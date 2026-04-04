import { describe, it, expect } from 'vitest'
import { onRenderHtml } from '../src/on-render-html'
import { onRenderClient } from '../src/on-render-client'
import { component, div, text } from '@llui/dom'

type State = { greeting: string }

const TestPage = component<State, never, never>({
  name: 'TestPage',
  init: () => [{ greeting: 'hello' }, []],
  update: (s) => [s, []],
  view: () => [div({ class: 'page' }, [text((s: State) => s.greeting)])],
})

describe('onRenderHtml', () => {
  it('renders HTML with component content', async () => {
    const result = await onRenderHtml({ Page: TestPage })
    expect(result.documentHtml).toContain('<div id="app">')
    expect(result.documentHtml).toContain('hello')
    expect(result.documentHtml).toContain('__LLUI_STATE__')
  })

  it('serializes initial state into the page', async () => {
    const result = await onRenderHtml({ Page: TestPage })
    expect(result.documentHtml).toContain('"greeting":"hello"')
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
    expect(result.documentHtml).toContain('Franco')
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
    // Pre-render server HTML
    const result = await onRenderHtml({ Page: TestPage })
    const match = result.documentHtml.match(/<div id="app">([\s\S]*?)<\/div>/)
    const serverHtml = match?.[1] ?? ''

    const container = document.createElement('div')
    container.id = 'app'
    container.innerHTML = serverHtml
    document.body.appendChild(container)

    // Set server state
    ;(window as Record<string, unknown>).__LLUI_STATE__ = { greeting: 'hello' }

    await onRenderClient({ Page: TestPage, isHydration: true })

    expect(container.textContent).toContain('hello')

    document.body.removeChild(container)
    delete (window as Record<string, unknown>).__LLUI_STATE__
  })
})
